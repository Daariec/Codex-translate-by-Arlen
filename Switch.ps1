param([switch]$Check, [string]$DataDirectory, [string]$CodexHome)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$taskNode = (Get-Command node.exe -ErrorAction Stop).Source
$taskCli = Join-Path $PSScriptRoot 'cli.mjs'
. (Join-Path $PSScriptRoot 'ui\native-language.ps1')
try { Set-Location -LiteralPath ([IO.Path]::GetTempPath()) } catch {}
Initialize-UiLanguage $DataDirectory

function Format-ContextTokens([int64]$tokens) {
    if ($tokens -le 0) { return (Get-UiText 'notSpecified') }
    if ($tokens -ge 1000000) {
        $m = [math]::Round($tokens / 1000000.0, 1)
        return (Get-UiText 'tokensMillion' @($tokens, $m))
    }
    if ($tokens -ge 1000) {
        $k = [math]::Round($tokens / 1000.0)
        return (Get-UiText 'tokensThousand' @($tokens, $k))
    }
    return (Get-UiText 'tokens' @($tokens))
}

function Invoke-TranslateCli([string[]]$Arguments, [string]$InputText) {
    if ($DataDirectory) { $Arguments += @('--data-dir', $DataDirectory) }
    if ($CodexHome) { $Arguments += @('--codex-home', $CodexHome) }
    if ($PSBoundParameters.ContainsKey('InputText')) { $taskResult = ($InputText | & $taskNode $taskCli @Arguments 2>&1 | Out-String) }
    else { $taskResult = (& $taskNode $taskCli @Arguments 2>&1 | Out-String) }
    if ($LASTEXITCODE -ne 0) { throw $taskResult.Trim() }
    if ([string]::IsNullOrWhiteSpace($taskResult)) { throw (Get-UiText 'emptyData') }
    return $taskResult | ConvertFrom-Json
}

function Read-TranslateData {
    $taskLoaded = Invoke-TranslateCli @('ui-data')
    if (-not $taskLoaded -or -not $taskLoaded.PSObject.Properties['connections']) {
        throw (Get-UiText 'invalidData')
    }
    Initialize-UiLanguage $taskLoaded.dataDir
    return $taskLoaded
}

try { $script:taskData = Read-TranslateData } catch {
    if ($Check) { throw }
    [Windows.Forms.MessageBox]::Show((Get-UiError $_.Exception.Message), (Get-UiText 'errorStart')) | Out-Null
    return
}

$taskForm = New-Object Windows.Forms.Form
$taskForm.Text = (Get-UiText 'title')
$taskForm.Size = New-Object Drawing.Size(680, 710)
$taskForm.StartPosition = 'CenterScreen'
$taskForm.FormBorderStyle = 'FixedDialog'
$taskForm.MaximizeBox = $false
$taskForm.Font = New-Object Drawing.Font('Segoe UI', 10)

function Add-TransLabel([string]$Text, [int]$X, [int]$Y, [int]$Width, [int]$Height=26) {
    $taskLabel = New-Object Windows.Forms.Label
    $taskLabel.Text = $Text; $taskLabel.SetBounds($X, $Y, $Width, $Height)
    $taskForm.Controls.Add($taskLabel); return $taskLabel
}

$taskStatus = Add-TransLabel '' 20 14 430 28
$taskStatus.Font = New-Object Drawing.Font('Segoe UI', 10, [Drawing.FontStyle]::Bold)

$taskToggleBtn = New-Object Windows.Forms.Button
$taskToggleBtn.Text = (Get-UiText 'toggle')
$taskToggleBtn.SetBounds(460, 10, 190, 34)
$taskToggleBtn.Font = New-Object Drawing.Font('Segoe UI', 9.5, [Drawing.FontStyle]::Bold)
$taskForm.Controls.Add($taskToggleBtn)

$taskOff = New-Object Windows.Forms.RadioButton
$taskOff.Text = (Get-UiText 'off'); $taskOff.SetBounds(20, 50, 290, 32)
$taskOn = New-Object Windows.Forms.RadioButton
$taskOn.Text = (Get-UiText 'on'); $taskOn.SetBounds(320, 50, 330, 32)
$taskForm.Controls.AddRange(@($taskOff, $taskOn))

$taskServer = New-Object Windows.Forms.ComboBox
$taskServer.SetBounds(20, 88, 630, 28)
$taskServer.DropDownStyle = 'DropDownList'
$taskServer.Visible = $false
$taskForm.Controls.Add($taskServer)

$null = Add-TransLabel (Get-UiText 'providerUrl') 20 92 360 24
$taskURL = New-Object Windows.Forms.TextBox
$taskURL.SetBounds(20, 118, 630, 28)
$taskForm.Controls.Add($taskURL)

$null = Add-TransLabel (Get-UiText 'apiKey') 20 156 460 24
$taskKey = New-Object Windows.Forms.TextBox
$taskKey.UseSystemPasswordChar = $true
$taskKey.SetBounds(20, 182, 440, 28)
$taskForm.Controls.Add($taskKey)

$taskRefresh = New-Object Windows.Forms.Button
$taskRefresh.Text = (Get-UiText 'loadModels')
$taskRefresh.SetBounds(470, 180, 180, 32)
$taskForm.Controls.Add($taskRefresh)

$null = Add-TransLabel (Get-UiText 'modelSearch') 20 222 250 24
$taskSearch = New-Object Windows.Forms.TextBox
$taskSearch.SetBounds(20, 246, 630, 28)
$taskForm.Controls.Add($taskSearch)

$taskModels = New-Object Windows.Forms.ListBox
$taskModels.SetBounds(20, 276, 630, 135)
$taskModels.HorizontalScrollbar = $true
$taskForm.Controls.Add($taskModels)

$null = Add-TransLabel (Get-UiText 'effortLabel') 20 418 260 22
$taskEffort = New-Object Windows.Forms.ComboBox
$taskEffort.SetBounds(20, 442, 220, 28)
$taskEffort.DropDownStyle = 'DropDownList'
$taskForm.Controls.Add($taskEffort)

$null = Add-TransLabel (Get-UiText 'fallbackLanguage') 260 418 380 22
$taskLang = New-Object Windows.Forms.ComboBox
$taskLang.SetBounds(260, 442, 390, 28)
$taskLang.DropDownStyle = 'DropDownList'
foreach ($l in $script:taskData.languages) {
    $null = $taskLang.Items.Add("$($l.code) — $($l.name)")
}
$taskForm.Controls.Add($taskLang)

$taskContextLabel = Add-TransLabel (Get-UiText 'contextUnknown') 20 480 630 22
$taskDetails = Add-TransLabel '' 20 506 630 38

$null = Add-TransLabel (Get-UiText 'preserved') 20 550 630 26

$taskPanelBtn = New-Object Windows.Forms.Button
$taskPanelBtn.Text = (Get-UiText 'fullPanel')
$taskPanelBtn.SetBounds(20, 595, 310, 38)
$taskPanelBtn.add_Click({
    $panelScript = Join-Path $PSScriptRoot 'Panel.ps1'
    $pArgs = @('-NoProfile', '-Sta', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', "`"$panelScript`"")
    if ($DataDirectory) { $pArgs += @('-DataDirectory', "`"$DataDirectory`"") }
    if ($CodexHome) { $pArgs += @('-CodexHome', "`"$CodexHome`"") }
    Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -WindowStyle Hidden -ArgumentList $pArgs
})
$taskForm.Controls.Add($taskPanelBtn)

$taskApply = New-Object Windows.Forms.Button
$taskApply.Text = (Get-UiText 'apply')
$taskApply.SetBounds(380, 595, 125, 38)
$taskForm.Controls.Add($taskApply)
$taskForm.AcceptButton = $taskApply

$taskCancel = New-Object Windows.Forms.Button
$taskCancel.Text = (Get-UiText 'cancel')
$taskCancel.SetBounds(525, 595, 125, 38)
$taskCancel.add_Click({ $taskForm.Close() })
$taskForm.Controls.Add($taskCancel)
$taskForm.CancelButton = $taskCancel

function Update-TransStatus {
    $isOn = ($script:taskData.translator.enabled -eq $true)
    if ($isOn) {
        $m = if ($script:taskData.translator.model) { $script:taskData.translator.model } else { (Get-UiText 'noModel') }
        $taskStatus.Text = (Get-UiText 'statusOn' @($m))
        $taskToggleBtn.Text = (Get-UiText 'turnOff')
    } else {
        $taskStatus.Text = (Get-UiText 'statusOff')
        $taskToggleBtn.Text = (Get-UiText 'turnOn')
    }
}

function Update-ModelDetailsAndEffort {
    if ($taskModels.SelectedIndex -ge 0 -and $script:taskFilteredModels.Count -gt $taskModels.SelectedIndex) {
        $taskModel = $script:taskFilteredModels[$taskModels.SelectedIndex]
        $rawContext = 0
        if ($taskModel.context) { [int64]::TryParse([string]$taskModel.context, [ref]$rawContext) | Out-Null }
        $taskContextLabel.Text = (Get-UiText 'context' @((Format-ContextTokens $rawContext)))

        $prevSelectedEffort = Get-UiEffortCode ([string]$taskEffort.SelectedItem)
        $taskEffort.BeginUpdate()
        try {
            $taskEffort.Items.Clear()
            if ($taskModel.efforts -and $taskModel.efforts.Count -gt 0) {
                foreach ($eff in $taskModel.efforts) { $null = $taskEffort.Items.Add((Get-UiEffortLabel ([string]$eff))) }
            } else {
                $null = $taskEffort.Items.Add((Get-UiEffortLabel 'none'))
            }
        } finally {
            $taskEffort.EndUpdate()
        }

        $savedEffort = if ($script:taskData.translator.effort) { [string]$script:taskData.translator.effort } elseif ($script:taskConnection -and $script:taskConnection.effort) { [string]$script:taskConnection.effort } else { $null }
        if ($prevSelectedEffort -and $taskEffort.Items.Contains((Get-UiEffortLabel $prevSelectedEffort))) {
            $taskEffort.SelectedItem = Get-UiEffortLabel $prevSelectedEffort
        } elseif ($savedEffort -and $taskEffort.Items.Contains((Get-UiEffortLabel $savedEffort))) {
            $taskEffort.SelectedItem = Get-UiEffortLabel $savedEffort
        } elseif ($taskEffort.Items.Contains((Get-UiEffortLabel 'medium'))) {
            $taskEffort.SelectedItem = Get-UiEffortLabel 'medium'
        } elseif ($taskEffort.Items.Count -gt 0) {
            $taskEffort.SelectedIndex = 0
        }
        $taskEffort.Enabled = $taskOn.Checked
        $taskDetails.Text = if ($taskModel.efforts -and $taskModel.efforts.Count -gt 0) { (Get-UiText 'efforts' @(($taskModel.efforts | ForEach-Object { Get-UiEffortLabel ([string]$_) }) -join ', ')) } else { (Get-UiText 'effortNotRequired') }
    } else {
        $taskContextLabel.Text = (Get-UiText 'contextUnknown')
        $taskEffort.Items.Clear()
        $taskEffort.Enabled = $false
    }
}

function Update-TransApply {
    if ($taskOff.Checked) {
        $taskApply.Enabled = $true
    } else {
        if ($Check) {
            $taskApply.Enabled = ($taskServer.SelectedIndex -ge 0 -and $taskModels.SelectedIndex -ge 0)
        } else {
            $taskApply.Enabled = ($taskURL.Text.Trim().Length -gt 0) -or ($taskModels.SelectedIndex -ge 0)
        }
    }
}

function Update-TransModels {
    $taskDetails.Text = ''
    $taskModels.BeginUpdate()
    try {
        $taskModels.Items.Clear()
        $script:taskConnection = $script:taskData.connections | Where-Object id -EQ ([string]$taskServer.SelectedItem) | Select-Object -First 1
        if (-not $script:taskConnection -and $script:taskData.connections.Count -gt 0) {
            $script:taskConnection = $script:taskData.connections[0]
        }
        $script:taskFilteredModels = @()
        if ($script:taskConnection) {
            $script:taskFilteredModels = @($script:taskConnection.models | Where-Object { $_ -and $_.id -and (-not $taskSearch.Text -or ($_.id + ' ' + $_.name).IndexOf($taskSearch.Text,[StringComparison]::OrdinalIgnoreCase) -ge 0) })
        }
        foreach ($taskModel in $script:taskFilteredModels) { $null = $taskModels.Items.Add([string]$taskModel.id) }
    } finally { $taskModels.EndUpdate() }

    if ($script:taskConnection) {
        $prefModel = if ($script:taskData.translator.model) { [string]$script:taskData.translator.model } else { [string]$script:taskConnection.model }
        if ($prefModel) { $taskModels.SelectedItem = $prefModel }
        if ($taskModels.SelectedIndex -lt 0 -and $taskModels.Items.Count -gt 0) {
            $taskModels.SelectedIndex = 0
        }
    }

    Update-ModelDetailsAndEffort
    if ($taskServer.Items.Count -eq 0) {
        $taskDetails.Text = (Get-UiText 'noServers')
    } elseif ($taskModels.Items.Count -eq 0) {
        $taskDetails.Text = (Get-UiText 'noModels')
    }
    Update-TransApply
}

function Update-TransConnections {
    $taskServer.Items.Clear()
    foreach ($taskSaved in $script:taskData.connections) { $null = $taskServer.Items.Add([string]$taskSaved.id) }
    $prefConn = if ($script:taskData.translator.connectionId) { [string]$script:taskData.translator.connectionId } else { [string]$script:taskData.selected }
    if ($prefConn) { $taskServer.SelectedItem = $prefConn }
    if ($taskServer.SelectedIndex -lt 0 -and $taskServer.Items.Count -gt 0) { $taskServer.SelectedIndex = 0 }
    $script:taskConnection = $script:taskData.connections | Where-Object id -EQ ([string]$taskServer.SelectedItem) | Select-Object -First 1
    if ($script:taskConnection) {
        $taskURL.Text = $script:taskConnection.baseURL
    }
    $targetLang = if ($script:taskData.translator.targetLanguage) { [string]$script:taskData.translator.targetLanguage } else { 'ru' }
    for ($i = 0; $i -lt $taskLang.Items.Count; $i++) {
        if ($taskLang.Items[$i].ToString().StartsWith("$targetLang ")) {
            $taskLang.SelectedIndex = $i
            break
        }
    }
    if ($taskLang.SelectedIndex -lt 0 -and $taskLang.Items.Count -gt 0) { $taskLang.SelectedIndex = 0 }
    Update-TransModels
    Update-TransStatus
}

$taskToggleBtn.add_Click({
    try {
        $nextState = if ($script:taskData.translator.enabled -eq $true) { 'off' } else { 'on' }
        $null = Invoke-TranslateCli @($nextState, '--json')
        $script:taskData = Read-TranslateData
        $taskOn.Checked = ($script:taskData.translator.enabled -eq $true)
        $taskOff.Checked = (-not $taskOn.Checked)
        Update-TransStatus
        Update-TransApply
    } catch {
        [Windows.Forms.MessageBox]::Show((Get-UiError $_.Exception.Message), (Get-UiText 'errorToggle')) | Out-Null
    }
})

$taskServer.add_SelectedIndexChanged({
    Update-TransModels
    if ($script:taskConnection) {
        $taskURL.Text = $script:taskConnection.baseURL
        $taskKey.Text = ''
    }
})
$taskSearch.add_TextChanged({ Update-TransModels })
$taskURL.add_TextChanged({ Update-TransApply })
$taskModels.add_SelectedIndexChanged({
    Update-ModelDetailsAndEffort
    Update-TransApply
})

$taskOn.Checked = ($script:taskData.translator.enabled -eq $true)
$taskOff.Checked = (-not $taskOn.Checked)
$taskOff.add_CheckedChanged({
    Update-ModelDetailsAndEffort
    Update-TransApply
})
$taskOn.add_CheckedChanged({
    Update-ModelDetailsAndEffort
    Update-TransApply
})

$taskRefresh.add_Click({
    try {
        $taskSelectedId = if ($taskServer.SelectedItem) { [string]$taskServer.SelectedItem } else { 'default' }
        $taskEnteredUrl = $taskURL.Text.Trim()
        if (-not $taskEnteredUrl) { throw (Get-UiText 'enterUrl') }
        $taskArgs = @('update', '--id', $taskSelectedId, '--url', $taskEnteredUrl, '--json')
        if ($taskKey.Text.Trim()) {
            $null = Invoke-TranslateCli ($taskArgs + '--stdin-key') $taskKey.Text
            $taskKey.Text = ''
        } elseif ($script:taskConnection) {
            $null = Invoke-TranslateCli $taskArgs
        } else {
            throw (Get-UiText 'enterKey')
        }
        $script:taskData = Read-TranslateData
        $taskServer.SelectedItem = $taskSelectedId
        Update-TransConnections
    } catch {
        [Windows.Forms.MessageBox]::Show((Get-UiError $_.Exception.Message), (Get-UiText 'errorLoad')) | Out-Null
    }
})

$taskApply.add_Click({
    try {
        $selectedLangCode = if ($taskLang.SelectedItem) { ($taskLang.SelectedItem.ToString() -split ' ')[0] } else { 'ru' }
        if ($taskOff.Checked) {
            $null = Invoke-TranslateCli @('off', '--lang', $selectedLangCode, '--json')
            $taskForm.Close()
            return
        }

        $taskSelectedId = if ($taskServer.SelectedItem) { [string]$taskServer.SelectedItem } else { 'default' }
        $taskEnteredUrl = $taskURL.Text.Trim()
        $taskNeedSave = (-not $script:taskConnection) -or ($taskEnteredUrl -and $taskEnteredUrl -ne $script:taskConnection.baseURL) -or [bool]$taskKey.Text.Trim()

        if ($taskNeedSave) {
            if (-not $taskEnteredUrl) { throw (Get-UiText 'enterUrl') }
            $taskSaveArgs = @('update', '--id', $taskSelectedId, '--url', $taskEnteredUrl, '--json')
            if ($taskKey.Text.Trim()) {
                $null = Invoke-TranslateCli ($taskSaveArgs + '--stdin-key') $taskKey.Text
                $taskKey.Text = ''
            } elseif ($script:taskConnection) {
                $null = Invoke-TranslateCli $taskSaveArgs
            } else {
                throw (Get-UiText 'enterKey')
            }
            $script:taskData = Read-TranslateData
            $taskServer.SelectedItem = $taskSelectedId
            Update-TransConnections
        }

        $selectedModelId = if ($taskModels.SelectedItem) { [string]$taskModels.SelectedItem } elseif ($script:taskConnection -and $script:taskConnection.model) { [string]$script:taskConnection.model } else { $null }
        if (-not $selectedModelId) { throw (Get-UiText 'selectModel') }

        $onArgs = @('on', '--id', $taskSelectedId, '--model', $selectedModelId, '--lang', $selectedLangCode, '--json')
        if ($taskEffort.Enabled -and $taskEffort.SelectedItem) {
            $onArgs += @('--effort', (Get-UiEffortCode ([string]$taskEffort.SelectedItem)))
        }
        $null = Invoke-TranslateCli $onArgs
        $taskForm.Close()
    } catch {
        [Windows.Forms.MessageBox]::Show((Get-UiError $_.Exception.Message), (Get-UiText 'errorSave')) | Out-Null
    }
})

Update-TransConnections

if ($Check) {
    [pscustomobject]@{
        phase = 'SwitchReady'
        interfaceLanguage = $script:ctUiLanguage
        windowTitle = $taskForm.Text
        toggleButtonText = $taskToggleBtn.Text
        modelDetails = $taskDetails.Text
        translatorEnabled = ($script:taskData.translator.enabled -eq $true)
        configuredRoute = $script:taskData.routing.configuredRoute
        selected = [string]$taskServer.SelectedItem
        url = $taskURL.Text
        keyEmpty = ($taskKey.Text.Length -eq 0)
        keyMasked = $taskKey.UseSystemPasswordChar
        connectionsCount = $taskServer.Items.Count
        modelsCount = $taskModels.Items.Count
        selectedModel = [string]$taskModels.SelectedItem
        selectedEffort = Get-UiEffortCode ([string]$taskEffort.SelectedItem)
        selectedEffortLabel = [string]$taskEffort.SelectedItem
        toggleButtonPresent = ($null -ne $taskToggleBtn)
        applyEnabled = $taskApply.Enabled
    } | ConvertTo-Json -Compress
    $taskForm.Dispose()
    return
}
[void]$taskForm.ShowDialog()
