# Codex Translate: installation and daily use

[English](#english) · [Русский](#русский) · [中文](#中文)

## English

### 1. Prepare the computer

1. Install Codex Desktop or Codex CLI and sign in to your account.
2. Install Node.js 22 or later from the official Node.js website. Open a new terminal (PowerShell on Windows, Bash/Zsh on macOS or Linux) and run `node --version` to check it.
3. Copy or clone the **entire plugin folder** to a permanent location (for example, `D:\Codex translate` on Windows or `~/codex-translate` on macOS/Linux). Keep the `.mjs`, `.ps1`, and `.sh` scripts, hidden plugin manifests, and the `ui`, `skills`, and `assets` folders together.
4. Have your translator provider's base URL, API key, and supported model ready. A provider running at `localhost` on the original computer must also be installed and running on the new computer, or replaced with a reachable server URL. The translator provider is configured separately from your Codex account.

### 2. Install the plugin in Codex

1. Close Codex and any open Codex Translate windows. On a computer with an older installation, follow the update procedure below first.
2. Run the platform installer under the same user account that runs Codex:
   - **Windows:** Double-click **`Install-Plugin for Windows.cmd`** (or **`Install-Plugin.cmd`**) in File Explorer, or run `.\"Install-Plugin for Windows.cmd"` in PowerShell.
   - **macOS:** Double-click **`Install-Plugin for MacOS.command`** in Finder, or run `chmod +x "Install-Plugin for MacOS.command" "Install-Plugin for MacOS.sh" *.sh && ./"Install-Plugin for MacOS.sh"` in Terminal.
   - **Linux:** Run `chmod +x "Install-Plugin for Linux.sh" *.sh && ./"Install-Plugin for Linux.sh"` in Terminal.
3. The installer installs the npm dependency if needed, registers the local plugin marketplace, copies the plugin into Codex's plugin cache, enables the plugin, starts its local gateway (`127.0.0.1:24131`), and on Windows launches the **CT** tray icon. It backs up the original Codex routing configuration before enabling interception.
4. Wait for the installation success message. Choose **Y** when asked to open the control panel. If an error is shown, resolve it before continuing; do not assume installation succeeded merely because a window opened.
5. Keep the original plugin folder in place. Its location is saved in the local marketplace configuration. After moving it, run the installer again from the new location.

### 3. Configure translation

1. Open **`CodexTranslate.exe`** or **`Panel.cmd`** on Windows, or run **`./panel.sh`** (`node cli.mjs panel`) on macOS and Linux. Select **English**, **Русский**, or **中文** in the upper-left corner. This selects the interface language; the reply language is a separate setting.
2. Open **API Providers → Add Translator API Provider**. Select the new connection in the list to open its editor. Enter a connection name, choose the protocol supported by the provider, and enter its base URL and API key. Remote servers require HTTPS; local loopback servers may use HTTP. Settings save automatically.
3. Click **Load / Refresh Models**. If it fails, check the server address, protocol, key, and network access. Your API key is encrypted locally (via Windows DPAPI on Windows and authenticated AES-256-GCM with `0600` permissions on macOS/Linux); encrypted credentials from another computer should be entered again there.
4. Open **Translator** and select a translator model. Leave the reasoning level at its default unless your provider requires a specific value.
5. Select a fallback reply language. With automatic language detection enabled, the translator uses the language of your prompt when it can determine it; the fallback is used when needed. Changing the interface language does not change this setting.
6. Click **Test Translation**, confirm that it succeeds, then click **Turn ON Translator**.
7. Start or restart Codex so it picks up the interception endpoint. The panel's **Restart ChatGPT / Codex** button can restart a running desktop app. This interrupts its active work, so finish or stop that work first.

### 4. Check the result and use the plugin

1. In the panel, confirm that translation is enabled and interception is active. Send a short non-English prompt in Codex. The live tracker should record the prompt translation and the translated reply. The confirmation footer appears when translation indicators are enabled.
2. Open **Token Economics**. A fresh installation starts without recorded requests. Statistics appear after intercepted translated turns. The engine automatically syncs official OpenAI model pricing on launch and every 4 hours (supporting `30m / 12h` cache writes and `>272K` long-context tiers). Check model tariffs against your provider's actual rates; the dollar figures are calculations and estimates, not a Codex subscription bill. Some cache metrics are local prefix estimates when the API does not report them.
3. Use **`CodexTranslate.exe`** or **`Panel.cmd`** for the full panel. **`Switch.cmd`** opens the compact switcher, which does not contain the economics dashboard. The tray menu provides quick controls. Its language follows the panel choice; reopen an already-open compact switcher after changing the language.
4. Turning translation off takes effect immediately while the gateway remains in the route. To remove interception as well, use **Direct Connection** in the panel, or run `node .\cli.mjs restore` from the plugin folder, then restart Codex.
5. Right-clicking the **CT** system tray icon and choosing **Exit system tray** closes the Control Panel and Quick Switcher windows, stops the background `gateway.mjs` process, and restores direct connection in `config.toml` (while keeping your preferences so the next Codex session starts the gateway automatically). To completely uninstall the plugin from Codex, run **`Uninstall-Plugin for Windows.cmd`**, **`Uninstall-Plugin for MacOS.command`** / **`Uninstall-Plugin for MacOS.sh`**, **`Uninstall-Plugin for Linux.sh`**, or `node .\cli.mjs uninstall`.

### 5. Update or fix an older interface

Codex installs a second copy under `%USERPROFILE%\.codex\plugins\cache\codex-translate-local\codex-translate\1.0.0`. An already-running gateway can continue serving that copy even after you open a newer executable. A full panel should show both the interface-language buttons and the economics section regardless of saved statistics or API connections.

1. Close Codex and all translator windows. Right-click the CT tray icon and exit the tray. **Exiting the tray alone does not stop the gateway.**
2. Open PowerShell **inside the complete new plugin folder**. Run the following block to stop only the gateway listening on port 24131, then install the new files. It refuses to stop a process whose command line does not identify a gateway daemon. If it refuses, inspect that process before proceeding.

```powershell
$listener = Get-NetTCPConnection -LocalPort 24131 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    $taskGateway = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
    if ($taskGateway.Name -ne 'node.exe' -or $taskGateway.CommandLine -notmatch '[\\/]gateway\.mjs"?\s+--daemon\b') {
        throw 'Port 24131 is occupied by an unexpected process. Inspect it before stopping it.'
    }
    Stop-Process -Id $taskGateway.ProcessId
}
.\Install-Plugin.cmd
```

3. Open the full panel again and start Codex. If the installer cannot refresh files because they are in use, close the applications, restart Windows, and repeat installation before reopening Codex.

### 6. Where settings are stored

- By default, connections, encrypted API keys, translation history, and economics statistics are stored outside the repository:
  - **Windows:** `%LOCALAPPDATA%\OmniRouteIntegrations\codex-translate`
  - **macOS:** `~/Library/Application Support/OmniRouteIntegrations/codex-translate`
  - **Linux:** `${XDG_DATA_HOME:-~/.local/share}/OmniRouteIntegrations/codex-translate`
  `CODEX_HOME` can override the default `~/.codex` directory.
- Making a clean copy of the repository (or pushing it to GitHub) excludes all runtime state and credentials via `.gitignore`. Opening a clean copy on the **same computer** still reads the shared local profile in `%LOCALAPPDATA%` by default; on a new Windows user or computer, the plugin starts completely empty without any providers or API keys.
- Keep API keys out of screenshots, chat messages, and source files. Configure them in the panel's password field.
- To run the local checks from the plugin folder: `npm test`. The suite uses temporary profiles and mocked API responses; it does not prove that your real provider credentials work. Use **Test Translation** for that check.

## Русский

### Установка на новом компьютере

1. Установите Codex Desktop или Codex CLI и войдите в свою учётную запись. Установите Node.js версии 22 или новее с официального сайта. Откройте новое окно PowerShell и проверьте версию командой `node --version`.
2. Скопируйте **всю папку плагина**, например в `D:\Codex translate`. Рядом с `CodexTranslate.exe` должны остаться файлы `.mjs`, `.ps1`, скрытые манифесты и папки `ui`, `skills`, `assets`. Один файл `.exe` не содержит интерфейс и движок перевода. После установки не переносите папку без повторного запуска установщика.
3. Подготовьте адрес, протокол и API-ключ сервиса перевода. Если раньше использовался `localhost`, этот сервис должен работать и на новом ПК; иначе укажите адрес доступного сервера. Для удалённого сервера необходим HTTPS.
4. Закройте Codex и окна переводчика. Запустите установщик вашей ОС из папки плагина под той же учётной записью, которая используется для Codex:
   - **Windows:** **`Install-Plugin for Windows.cmd`** (или `Install-Plugin.cmd`)
   - **macOS:** **`Install-Plugin for MacOS.command`** (или `./"Install-Plugin for MacOS.sh"`)
   - **Linux:** **`./"Install-Plugin for Linux.sh"`**
   Права администратора не требуются. Установщик зарегистрирует плагин, скопирует файлы в кэш Codex, включит перехват и запустит локальный шлюз (а в Windows — значок CT в трее). При необходимости он установит npm-зависимость. Исходная конфигурация маршрутизации сохраняется в резервной копии.
5. Дождитесь сообщения об успешной установке. Для открытия панели ответьте **Y**. Если показана ошибка, сначала устраните её.

### Настройка и первый запуск

1. Откройте **`CodexTranslate.exe`** или **`Panel.cmd`** и выберите **Русский** слева сверху. Язык интерфейса и язык ответов настраиваются отдельно.
2. Перейдите в **API-провайдеры → Добавить API-провайдер переводчика**. Выберите новое подключение в списке, чтобы открыть его настройки. Укажите имя подключения, протокол, базовый URL и API-ключ. Поля сохраняются автоматически. Нажмите **Загрузить / обновить модели**.
3. На вкладке **Переводчик** выберите модель, уровень рассуждений и резервный язык ответов. При включённом автоопределении приоритет имеет язык запроса пользователя. При необходимости применяется резервный язык.
4. Нажмите **Проверить перевод**. После успешного результата включите переводчик.
5. Запустите или перезапустите Codex, чтобы он прочитал новый адрес перехвата. Кнопка **Перезапустить ChatGPT / Codex** прерывает текущую работу приложения: сначала завершите её.
6. Отправьте короткий запрос не на английском. В журнале активности должны появиться записи о переводе запроса и ответа. Если включены индикаторы, ответ содержит подтверждение перевода.
7. На вкладке **Экономика токенов** после обработанных запросов появятся статистика и расчёты (тарифы OpenAI синхронизируются автоматически при запуске и каждые 4 часа с учётом записи кэша `30m / 12h` и длинного контекста `>272K`). На новой установке журнал пуст. Укажите корректные тарифы провайдера: суммы в долларах являются расчётами, а не счётом за подписку Codex. Часть показателей кэша может быть локальной оценкой.

### Ежедневный запуск и обновление

- Полная панель: **`CodexTranslate.exe`** или **`Panel.cmd`**. **`Switch.cmd`** — компактное окно без раздела экономики. Значок CT предоставляет быстрые команды. Меню трея подхватывает выбранный язык; уже открытое компактное окно после смены языка следует открыть заново.
- Выключение перевода действует сразу. Для полного отключения перехвата выберите **Прямое соединение** или выполните `node .\cli.mjs restore` из папки плагина и перезапустите Codex.
- Если показывается старый интерфейс, закройте Codex и переводчик, выйдите из трея и выполните блок PowerShell из раздела **5. Update or fix an older interface** выше **в новой папке плагина**. Он остановит только проверенный процесс шлюза на порту 24131 и запустит установщик. Затем снова откройте панель и Codex. Закрытие одного значка CT не останавливает шлюз.
- Подключения, история и ключи хранятся отдельно: `%LOCALAPPDATA%\OmniRouteIntegrations\codex-translate`. Копия репозитория на том же ПК использует этот общий профиль. На другом ПК API-ключ нужно ввести заново: шифрование DPAPI привязано к пользователю Windows. Не отправляйте ключи в чат и не добавляйте их в исходные файлы.
- Локальная проверка: `npm test`. Реальное подключение проверяется кнопкой **Проверить перевод**.

## 中文

### 在新电脑上安装

1. 安装 Codex Desktop 或 Codex CLI，并登录账户。从 Node.js 官方网站安装 22 或更高版本。重新打开 PowerShell，运行 `node --version` 检查版本。
2. 将**整个插件文件夹**复制到固定位置，例如 `D:\Codex translate`。保留 `CodexTranslate.exe`、`.mjs`、`.ps1`、隐藏的插件清单，以及 `ui`、`skills`、`assets` 文件夹。单独的 `.exe` 不包含界面和翻译引擎。安装后移动文件夹需要重新运行安装程序。
3. 准备翻译服务的基础 URL、API 协议和密钥。如果原电脑使用 `localhost`，新电脑也需要运行该服务，或者改用可访问的服务器地址。远程服务器必须使用 HTTPS。
4. 关闭 Codex 和所有翻译器窗口。使用运行 Codex 的同一个系统账户，在插件文件夹中运行对应系统的安装程序：
   - **Windows：** 双击 **`Install-Plugin for Windows.cmd`**（或 `Install-Plugin.cmd`）
   - **macOS：** 双击 **`Install-Plugin for MacOS.command`**（或在终端运行 `./"Install-Plugin for MacOS.sh"`）
   - **Linux：** 在终端运行 **`./"Install-Plugin for Linux.sh"`**
   无需管理员权限。安装程序会注册插件、更新 Codex 插件缓存、启用拦截并启动本地网关（Windows 下同时启动 CT 托盘图标）；缺少 npm 依赖时会尝试安装。原路由配置会先备份。
5. 等待安装成功提示，输入 **Y** 打开面板。如果出现错误，请先解决错误再继续。

### 配置并首次运行

1. 打开 **`CodexTranslate.exe`** 或 **`Panel.cmd`**，在左上角选择 **中文**。界面语言与回复语言是两个独立设置。
2. 进入 **API 提供商**，添加翻译 API 提供商，再在列表中选择新连接以打开编辑器。填写连接名称、协议、基础 URL 和 API 密钥。设置会自动保存，然后点击加载或刷新模型列表。
3. 进入**翻译器**页面，选择翻译模型、推理强度和备用回复语言。启用自动语言检测时优先使用用户提问的语言；必要时使用备用语言。
4. 点击**测试翻译**，确认成功后开启翻译器。
5. 启动或重启 Codex，使其读取拦截地址。面板中的重启按钮会中断桌面应用的当前工作，请先完成或停止正在进行的任务。
6. 在 Codex 中发送一条非英文提示。实时活动记录应显示提示和回复的翻译；启用翻译标识时，回复末尾会显示确认信息。
7. 打开**词元成本分析**。新安装的记录为空，处理翻译请求后会显示统计（启动时及每 4 小时会自动同步 OpenAI 官方费率，支持 `30m / 12h` 缓存写入与 `>272K` 长上下文计费）。请按提供商的实际价格设置费率：美元数值属于计算或估算，并非 Codex 订阅账单。API 未提供缓存数据时，部分指标使用本地估算。

### 日常使用与更新

- 使用 **`CodexTranslate.exe`** 或 **`Panel.cmd`** 打开完整面板。**`Switch.cmd`** 是不包含成本分析的精简切换窗口。CT 托盘菜单提供快捷操作，并会跟随面板的语言设置。更改语言后，请重新打开已运行的精简窗口。
- 关闭翻译会立即生效。要同时移除拦截，请在面板选择直连模式，或在插件文件夹运行 `node .\cli.mjs restore`，然后重启 Codex。
- 如果仍显示旧界面，请关闭 Codex 和翻译器，退出 CT 托盘，在**完整的新插件文件夹内**执行上方 **5. Update or fix an older interface** 中的 PowerShell 代码块。它会检查并停止端口 24131 上的网关，然后运行安装程序。完成后重新打开面板和 Codex。仅退出托盘不会停止网关。
- 连接、历史和密钥保存在 `%LOCALAPPDATA%\OmniRouteIntegrations\codex-translate`，不在代码文件夹中。同一电脑上的代码副本默认共用该配置。DPAPI 加密与 Windows 用户绑定，因此在另一台电脑上应重新输入 API 密钥。请勿将密钥写入源码或发送到聊天中。
- 本地检查命令为 `npm test`。实际服务连接请通过面板的测试翻译按钮检查。
