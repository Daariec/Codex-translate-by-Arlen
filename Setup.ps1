$ErrorActionPreference = 'Stop'
$taskNode = (Get-Command node.exe -ErrorAction Stop).Source
$taskCli = Join-Path $PSScriptRoot 'cli.mjs'
while ($true) {
    Write-Host "`nCodex Translate — CLI Manager (User <-> Agent): $PSScriptRoot"
    Write-Host 'Your base ChatGPT / Codex connection and models are preserved.'
    Write-Host '1 Turn ON Translator | 2 Turn OFF Translator | 3 Add Translator API Provider'
    Write-Host '4 Status & Connections | 5 Refresh Models (/v1/models) | 6 Search / Select Translator Model'
    Write-Host '7 Open Control Panel (Panel) | W Quick Switcher (Switch) | 0 Exit'
    $taskChoice = Read-Host 'Select an action'
    switch ($taskChoice) {
        '1' { & $taskNode $taskCli on }
        '2' { & $taskNode $taskCli off }
        '3' {
            $taskId = Read-Host 'Connection ID (letters/digits/hyphen, e.g. default)'
            if (-not $taskId) { $taskId = 'default' }
            $taskUrl = Read-Host 'Server Base URL (e.g. https://api.openai.com/v1)'
            $taskKey = Read-Host 'API Key' -AsSecureString
            $taskPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskKey)
            try {
                $taskPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPtr)
                $taskPlain | & $taskNode $taskCli configure --id $taskId --url $taskUrl --stdin-key
            } finally {
                [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPtr)
                $taskPlain = $null; $taskKey = $null
            }
        }
        '4' { & $taskNode $taskCli status }
        '5' { & $taskNode $taskCli sync }
        '6' {
            $taskSearch = Read-Host 'Search model (leave empty for all)'
            if ($taskSearch) { & $taskNode $taskCli models --search $taskSearch } else { & $taskNode $taskCli models }
            $taskModel = Read-Host 'Exact model ID for translator'
            if ($taskModel) {
                $taskEffort = Read-Host 'Reasoning effort (low, medium, high, none; leave empty for default)'
                if ($taskEffort) { & $taskNode $taskCli select --model $taskModel --effort $taskEffort }
                else { & $taskNode $taskCli select --model $taskModel }
            }
        }
        '7' { & $taskNode $taskCli panel }
        'W' { Start-Process powershell.exe -WindowStyle Normal -ArgumentList @('-NoProfile','-Sta','-ExecutionPolicy','Bypass','-File',('"' + (Join-Path $PSScriptRoot 'Switch.ps1') + '"')) }
        '0' { return }
        default { Write-Host 'Unknown command' }
    }
}
