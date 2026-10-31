import { randomUUID, createHash } from 'node:crypto';

export class ProtocolError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function classifyError(status, data) {
  const e = data?.error || data || {};
  const code = String(e.code || e.type || '');
  const message = String(e.message || '');
  if (
    status === 400 &&
    (['context_length_exceeded', 'context_window_exceeded', 'model_context_window_exceeded'].includes(code) ||
      /prompt is too long|input (?:is |tokens? )?(?:too long|exceeds)|maximum context length|context (?:window|length).*(?:exceed|limit)/i.test(message))
  ) {
    const error = new ProtocolError('Your input exceeds the context window of this model.', 400);
    error.code = 'context_window_exceeded';
    error.type = 'invalid_request_error';
    return error;
  }
  return new ProtocolError('Upstream API returned HTTP ' + status + '. Check endpoint, model and credentials.', status);
}

function textContent(content) {
  if (typeof content === 'string') return content;
  return (content || [])
    .filter(c => ['input_text', 'output_text', 'text'].includes(c.type))
    .map(c => c.text || '')
    .join('\n');
}

function wireName(namespace, name) {
  if (typeof name !== 'string' || !name) throw new ProtocolError('A tool name is required.');
  const canonical = namespace ? namespace + '__' + name : name;
  return /^[a-zA-Z0-9_-]{1,64}$/.test(canonical)
    ? canonical
    : 'cf_' + canonical.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32) + '_' + createHash('sha256').update(canonical).digest('hex').slice(0, 24);
}

function normalizeTools(tools = []) {
  const out = [];
  const registry = new Map();
  function visit(tool, namespace) {
    if (tool.type === 'namespace') {
      for (const t of tool.tools || []) visit(t, tool.name);
      return;
    }
    if (!['function', 'custom'].includes(tool.type)) {
      return;
    }
    const name = wireName(namespace, tool.name);
    if (registry.has(name)) return;
    const entry = { ...tool, namespace, wireName: name };
    registry.set(name, entry);
    out.push({
      name,
      description: (tool.description || '') + (tool.type === 'custom' ? '\nSupply the exact raw tool input in the input string.' : ''),
      parameters:
        tool.type === 'custom'
          ? { type: 'object', properties: { input: { type: 'string' } }, required: ['input'], additionalProperties: false }
          : tool.parameters || { type: 'object', properties: {} },
      ...(typeof tool.strict === 'boolean' ? { strict: tool.strict } : {})
    });
  }
  for (const tool of tools) visit(tool);
  return { tools: out, registry };
}

function publicReasoningSummary(item) {
  return (item.summary || [])
    .filter(p => ['summary_text', 'text'].includes(p.type) && typeof p.text === 'string')
    .map(p => p.text)
    .join('\n');
}

function mappedName(item) {
  return wireName(item.namespace, item.name);
}

function safeJSON(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw new ProtocolError('Invalid JSON ' + label);
  }
}

function commonInput(body) {
  return typeof body.input === 'string'
    ? [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: body.input }] }]
    : body.input || [];
}

function publicAgentMessages(body, nativeMetadata) {
  if (!Array.isArray(body?.input)) return body;
  let input = body.input.map(item => {
    if (item.type !== 'agent_message') return item;
    const content = [{ type: 'input_text', text: 'Agent communication from ' + (item.author || 'unknown') + ' to ' + (item.recipient || 'unknown') + '.' }];
    for (const part of item.content || []) {
      if (part.type === 'input_text') content.push({ type: 'input_text', text: part.text });
      else if (part.type === 'encrypted_content' && typeof part.encrypted_content === 'string') content.push({ type: 'input_text', text: part.encrypted_content });
    }
    return { type: 'message', role: 'user', content };
  });
  if (nativeMetadata?.subagent_kind === 'thread_spawn' && typeof nativeMetadata.agent_name === 'string' && nativeMetadata.parent_thread_id) {
    const name = nativeMetadata.agent_name;
    if (/^\/root(?:\/[a-zA-Z0-9_-]+)+$/.test(name)) {
      input = [
        ...input,
        {
          type: 'message',
          role: 'developer',
          content: [{ type: 'input_text', text: 'Current native agent identity: ' + name + '. Complete the task addressed to ' + name + ' and report its result.' }]
        }
      ];
    }
  }
  return { ...body, input };
}

function chatContent(content) {
  return (content || []).map(c => {
    if (['input_text', 'output_text', 'text'].includes(c.type)) return { type: 'text', text: c.text };
    if (c.type === 'input_file' && c.file_data) return { type: 'file', file: { filename: c.filename || 'attachment.pdf', file_data: c.file_data } };
    if (c.type === 'input_image') return { type: 'image_url', image_url: { url: c.image_url, ...(c.detail ? { detail: c.detail } : {}) } };
    return { type: 'text', text: JSON.stringify(c) };
  });
}

export function toChat(body, options = {}) {
  body = publicAgentMessages(body);
  const { tools, registry } = normalizeTools(body.tools);
  const messages = [];
  if (body.instructions) messages.push({ role: 'system', content: body.instructions });
  for (const item of commonInput(body)) {
    if (item.type === 'message' || item.role) {
      const role = item.role === 'developer' && !options.developerRole ? 'system' : item.role;
      const parts = typeof item.content === 'string' ? item.content : chatContent(item.content);
      const message = { role, content: parts };
      messages.push(message);
    } else if (['function_call', 'custom_tool_call'].includes(item.type)) {
      const args = item.type === 'custom_tool_call' ? JSON.stringify({ input: item.input }) : item.arguments;
      const call = { id: item.call_id, type: 'function', function: { name: mappedName(item), arguments: args } };
      const last = messages.at(-1);
      if (last?.role === 'assistant') {
        (last.tool_calls ||= []).push(call);
      } else {
        const message = { role: 'assistant', content: null, tool_calls: [call] };
        messages.push(message);
      }
    } else if (['function_call_output', 'custom_tool_call_output'].includes(item.type)) {
      const parts = Array.isArray(item.output) ? item.output : null;
      messages.push({
        role: 'tool',
        tool_call_id: item.call_id,
        content: parts ? textContent(parts) : typeof item.output === 'string' ? item.output : JSON.stringify(item.output)
      });
    } else if (item.type === 'reasoning') {
      const summary = publicReasoningSummary(item);
      if (summary) messages.push({ role: 'assistant', content: 'Public summary of an earlier assistant response:\n' + summary });
    }
  }
  const request = { model: body.model, messages, stream: true, stream_options: { include_usage: true } };
  if (tools.length) request.tools = tools.map(t => ({ type: 'function', function: t }));
  if (typeof body.parallel_tool_calls === 'boolean') request.parallel_tool_calls = body.parallel_tool_calls;
  if (body.max_output_tokens) request.max_completion_tokens = body.max_output_tokens;
  if (body.temperature != null) request.temperature = body.temperature;
  if (body.reasoning?.effort) request.reasoning_effort = body.reasoning.effort;
  if (typeof body.tool_choice === 'string') request.tool_choice = body.tool_choice;
  return { request, registry };
}

function anthropicContent(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return (content || []).map(c => {
    if (['input_text', 'output_text', 'text'].includes(c.type)) return { type: 'text', text: c.text };
    if (c.type === 'input_image') {
      const match = /^data:([^;]+);base64,(.*)$/s.exec(c.image_url || '');
      return { type: 'image', source: match ? { type: 'base64', media_type: match[1], data: match[2] } : { type: 'url', url: c.image_url } };
    }
    if (c.type === 'input_file' && c.file_data) {
      const match = /^data:application\/pdf;base64,(.*)$/s.exec(c.file_data);
      if (match) return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: match[1] } };
    }
    return { type: 'text', text: JSON.stringify(c) };
  });
}

export function toAnthropic(body) {
  body = publicAgentMessages(body);
  const { tools, registry } = normalizeTools(body.tools);
  const messages = [];
  const system = [];
  if (body.instructions) system.push({ type: 'text', text: body.instructions });
  function append(role, content) {
    const last = messages.at(-1);
    if (last?.role === role) last.content.push(...content);
    else messages.push({ role, content });
  }
  for (const item of commonInput(body)) {
    if (item.type === 'message' || item.role) {
      const content = anthropicContent(item.content);
      if (['system', 'developer'].includes(item.role)) system.push(...content);
      else append(item.role, content);
    } else if (['function_call', 'custom_tool_call'].includes(item.type)) {
      append('assistant', [
        {
          type: 'tool_use',
          id: item.call_id,
          name: mappedName(item),
          input: item.type === 'custom_tool_call' ? { input: item.input } : safeJSON(item.arguments || '{}', 'tool arguments')
        }
      ]);
    } else if (['function_call_output', 'custom_tool_call_output'].includes(item.type)) {
      append('user', [
        {
          type: 'tool_result',
          tool_use_id: item.call_id,
          content: Array.isArray(item.output) ? anthropicContent(item.output) : typeof item.output === 'string' ? item.output : JSON.stringify(item.output)
        }
      ]);
    }
  }
  const request = { model: body.model, max_tokens: body.max_output_tokens || 8192, stream: true, messages };
  if (system.length) request.system = system;
  if (tools.length) request.tools = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  return { request, registry };
}

export async function* sseEvents(stream) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of stream) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    buffer = buffer.replace(/\r\n/g, '\n');
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = block
        .split('\n')
        .filter(l => l.startsWith('data:'))
        .map(l => l.slice(5).trimStart())
        .join('\n');
      if (data && data !== '[DONE]') {
        try {
          yield JSON.parse(data);
        } catch {}
      }
    }
  }
}

export class ResponseStream {
  constructor(send, model, registry) {
    this.send = send;
    this.registry = registry;
    this.response = {
      id: 'resp_ct_' + randomUUID().replaceAll('-', ''),
      object: 'response',
      created_at: Math.floor(Date.now() / 1000),
      status: 'in_progress',
      model,
      output: []
    };
    this.sequence = 1;
    this.items = [];
    this.toolCalls = new Map();
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.cachedTokens = 0;
    this.reasoningTokens = 0;
    this.emit('response.created', { response: this.response });
    this.emit('response.in_progress', { response: this.response });
  }
  emit(type, fields) {
    this.send({ type, sequence_number: this.sequence++, ...fields });
  }
  add(item) {
    const index = this.items.length;
    this.items.push(item);
    this.emit('response.output_item.added', { output_index: index, item });
    return index;
  }
  text(delta) {
    if (!delta) return;
    if (this.textIndex == null) {
      this.textIndex = this.add({
        id: 'msg_' + randomUUID().replaceAll('-', ''),
        type: 'message',
        role: 'assistant',
        status: 'in_progress',
        content: []
      });
      this.items[this.textIndex].content.push({ type: 'output_text', text: '', annotations: [] });
      this.emit('response.content_part.added', {
        item_id: this.items[this.textIndex].id,
        output_index: this.textIndex,
        content_index: 0,
        part: { type: 'output_text', text: '', annotations: [] }
      });
    }
    const item = this.items[this.textIndex];
    item.content[0].text += delta;
    this.emit('response.output_text.delta', { item_id: item.id, output_index: this.textIndex, content_index: 0, delta });
  }
  reasoning(delta) {
    if (!delta) return;
    if (this.reasoningIndex == null) {
      this.reasoningIndex = this.add({
        id: 'rs_' + randomUUID().replaceAll('-', ''),
        type: 'reasoning',
        summary: [{ type: 'summary_text', text: '' }]
      });
    }
    const item = this.items[this.reasoningIndex];
    item.summary[0].text += delta;
    this.emit('response.reasoning_summary_text.delta', { item_id: item.id, output_index: this.reasoningIndex, summary_index: 0, delta });
  }
  tool(key, id, name, delta = '') {
    let call = this.toolCalls.get(key);
    if (!call) {
      call = { id, name: name || '', arguments: '' };
      this.toolCalls.set(key, call);
    } else {
      if (id) call.id = id;
      if (name) call.name += name;
    }
    call.arguments += delta;
  }
  complete(reason = 'stop') {
    for (const call of this.toolCalls.values()) {
      const definition = this.registry?.get(call.name);
      let item;
      if (definition?.type === 'custom') {
        const input = safeJSON(call.arguments || '{}', 'custom tool arguments').input ?? '';
        item = {
          id: 'ct_' + randomUUID().replaceAll('-', ''),
          type: 'custom_tool_call',
          call_id: call.id || randomUUID(),
          name: definition.name,
          input,
          status: 'completed'
        };
      } else {
        item = {
          id: 'fc_' + randomUUID().replaceAll('-', ''),
          type: 'function_call',
          call_id: call.id || randomUUID(),
          name: definition?.name || call.name,
          arguments: call.arguments || '{}',
          status: 'completed'
        };
      }
      if (definition?.namespace) item.namespace = definition.namespace;
      this.add(item);
    }
    for (let index = 0; index < this.items.length; index++) {
      const item = this.items[index];
      if (item.type === 'message') {
        item.status = 'completed';
        this.emit('response.output_text.done', { item_id: item.id, output_index: index, content_index: 0, text: item.content[0].text });
        this.emit('response.content_part.done', { item_id: item.id, output_index: index, content_index: 0, part: item.content[0] });
      }
      if (item.type === 'function_call') this.emit('response.function_call_arguments.done', { item_id: item.id, output_index: index, arguments: item.arguments });
      if (item.type === 'custom_tool_call') this.emit('response.custom_tool_call_input.done', { item_id: item.id, output_index: index, input: item.input });
      this.emit('response.output_item.done', { output_index: index, item });
    }
    this.response.output = this.items;
    this.response.status = 'completed';
    this.response.usage = {
      input_tokens: this.inputTokens,
      output_tokens: this.outputTokens,
      total_tokens: this.inputTokens + this.outputTokens,
      input_tokens_details: { cached_tokens: this.cachedTokens },
      output_tokens_details: { reasoning_tokens: this.reasoningTokens }
    };
    this.emit('response.completed', { response: this.response });
  }
}

export async function translateChat(upstream, output) {
  let reason = 'stop';
  for await (const event of sseEvents(upstream.body)) {
    if (event.error) throw classifyError(502, event);
    if (event.usage) {
      output.inputTokens = event.usage.prompt_tokens || 0;
      output.outputTokens = event.usage.completion_tokens || 0;
    }
    const choice = event.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta || {};
    output.text(delta.content);
    const reasoningDelta = delta.reasoning_content || delta.reasoning;
    if (typeof reasoningDelta === 'string') output.reasoning(reasoningDelta);
    for (const call of delta.tool_calls || []) {
      output.tool(call.index ?? 0, call.id, call.function?.name, call.function?.arguments);
    }
    if (choice.finish_reason) reason = choice.finish_reason;
  }
  output.complete(reason);
}

export async function translateAnthropic(upstream, output) {
  const blocks = new Map();
  let stopReason = 'end_turn';
  for await (const event of sseEvents(upstream.body)) {
    if (event.type === 'error') throw classifyError(502, event);
    if (event.type === 'content_block_start') {
      const block = structuredClone(event.content_block);
      blocks.set(event.index, block);
      if (block.type === 'tool_use') output.tool(event.index, block.id, block.name, Object.keys(block.input || {}).length ? JSON.stringify(block.input) : '');
      else if (block.type === 'text') output.text(block.text);
      else if (block.type === 'thinking') output.reasoning(block.thinking);
    }
    if (event.type === 'content_block_delta') {
      const delta = event.delta;
      const block = blocks.get(event.index);
      if (!block) continue;
      if (delta.type === 'text_delta') output.text(delta.text);
      else if (delta.type === 'input_json_delta') output.tool(event.index, null, null, delta.partial_json);
      else if (delta.type === 'thinking_delta') output.reasoning(delta.thinking);
    }
    if (event.type === 'message_delta' && event.delta?.stop_reason) stopReason = event.delta.stop_reason;
  }
  output.complete(stopReason);
}
