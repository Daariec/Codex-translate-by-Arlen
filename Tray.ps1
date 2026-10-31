param([switch]$Check, [switch]$LaunchMinimizedPanel, [string]$DataDirectory, [string]$CodexHome)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()

if (-not ('CodexTranslateWin32' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class CodexTranslateWin32 {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    public static List<IntPtr> FindPanelWindows() {
        var list = new List<IntPtr>();
        EnumWindows((hWnd, lParam) => {
            var cls = new StringBuilder(256);
            GetClassName(hWnd, cls, cls.Capacity);
            if (cls.ToString() != "Chrome_WidgetWin_1") return true;
            var sb = new StringBuilder(512);
            GetWindowText(hWnd, sb, sb.Capacity);
            string title = sb.ToString();
            if (title.IndexOf("Codex Translate", StringComparison.OrdinalIgnoreCase) >= 0 &&
                (title.IndexOf("Control Panel", StringComparison.OrdinalIgnoreCase) >= 0 ||
                 title.IndexOf("Панель управления", StringComparison.OrdinalIgnoreCase) >= 0 ||
                 title.IndexOf("控制面板", StringComparison.OrdinalIgnoreCase) >= 0)) {
                list.Add(hWnd);
            }
            return true;
        }, IntPtr.Zero);
        return list;
    }

    public static void HideIfMinimized() {
        var wins = FindPanelWindows();
        foreach (var hWnd in wins) {
            if (IsWindowVisible(hWnd) && IsIconic(hWnd)) {
                ShowWindow(hWnd, 0 /* SW_HIDE */);
            }
        }
    }

    public static string ControlExistingWindow(bool toggle) {
        var wins = FindPanelWindows();
        if (wins.Count == 0) return "none";
        IntPtr primary = wins[0];
        for (int i = 1; i < wins.Count; i++) {
            PostMessage(wins[i], 0x0010 /* WM_CLOSE */, IntPtr.Zero, IntPtr.Zero);
        }
        bool isVisible = IsWindowVisible(primary) && !IsIconic(primary);
        if (toggle && isVisible) {
            ShowWindow(primary, 0 /* SW_HIDE */);
            return "hidden";
        } else {
            ShowWindow(primary, 5 /* SW_SHOW */);
            ShowWindow(primary, 9 /* SW_RESTORE */);
            BringWindowToTop(primary);
            SetForegroundWindow(primary);
            return "shown";
        }
    }
}
'@
}

$mutexName = 'Global\CodexTranslateTrayMutex'
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$createdNew)
if (-not $createdNew -and -not $Check) {
    exit 0
}

$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
$taskNode = if ($nodeCmd) { $nodeCmd.Source } elseif (Test-Path 'C:\Program Files\nodejs\node.exe') { 'C:\Program Files\nodejs\node.exe' } else { throw 'Node.js (node.exe) was not found.' }
$taskCli = Join-Path $PSScriptRoot 'cli.mjs'
$taskPanel = Join-Path $PSScriptRoot 'Panel.ps1'
$taskSwitch = Join-Path $PSScriptRoot 'Switch.ps1'

function Invoke-TrayCli([string[]]$Arguments) {
    if ($DataDirectory) { $Arguments += @('--data-dir', $DataDirectory) }
    if ($CodexHome) { $Arguments += @('--codex-home', $CodexHome) }
    $out = (& $taskNode $taskCli @Arguments 2>&1 | Out-String).Trim()
    $jsonLine = @($out -split "\r?\n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^\{.*\}$' }) | Select-Object -Last 1
    if ($jsonLine) { return $jsonLine | ConvertFrom-Json }
    return $out | ConvertFrom-Json
}

function New-TrayIcon([bool]$TranslatorOn) {
    $bmp = New-Object System.Drawing.Bitmap(32, 32)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 20, 24, 36))
    $g.FillEllipse($bgBrush, 1, 1, 29, 29)

    $ringColor = if ($TranslatorOn) { [System.Drawing.Color]::FromArgb(255, 74, 202, 137) } else { [System.Drawing.Color]::FromArgb(255, 129, 140, 248) }
    $pen = New-Object System.Drawing.Pen($ringColor, 2.5)
    $g.DrawEllipse($pen, 2, 2, 27, 27)

    $font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 237, 237, 237))
    $g.DrawString('CT', $font, $textBrush, 6, 8)

    if ($TranslatorOn) {
        $dotBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 74, 202, 137))
        $g.FillEllipse($dotBrush, 21, 21, 9, 9)
    }

    $g.Dispose()
    return [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
}

$initInfo = Invoke-TrayCli @('panel-url', '--json')
$gatewayUrl = "http://127.0.0.1:$($initInfo.port)"
$script:adminToken = [string]$initInfo.adminToken
$script:dataDir = [string]$initInfo.dataDir
. (Join-Path $PSScriptRoot 'ui\native-language.ps1')
Initialize-UiLanguage $script:dataDir

function Get-ActionHeaders {
    if (-not $script:adminToken -and $script:dataDir) {
        $gwFile = Join-Path $script:dataDir 'gateway.json'
        if (Test-Path -LiteralPath $gwFile) {
            try {
                $gwData = Get-Content -LiteralPath $gwFile -Raw -Encoding UTF8 | ConvertFrom-Json
                if ($gwData.adminToken) { $script:adminToken = [string]$gwData.adminToken }
                if ($gwData.port) { $script:gatewayUrl = "http://127.0.0.1:$($gwData.port)" }
            } catch {}
        }
    }
    if ($script:adminToken) {
        return @{ 'X-Codex-Translate-Token' = $script:adminToken }
    }
    return @{}
}

if (-not $Check -and -not $DataDirectory -and -not $CodexHome) {
    try {
        $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
        $psExePath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $runVal = "`"$psExePath`" -NoProfile -Sta -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`""
        Set-ItemProperty -Path $runKey -Name 'CodexTranslateTray' -Value $runVal -ErrorAction SilentlyContinue
    } catch {}
}

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$itemOpenPanel = $menu.Items.Add((Get-UiText 'trayPanel'))
$itemOpenPanel.Font = New-Object System.Drawing.Font($menu.Font, [System.Drawing.FontStyle]::Bold)
$itemOpenSwitch = $menu.Items.Add((Get-UiText 'traySwitch'))
$null = $menu.Items.Add('-')

$itemTransOn = New-Object System.Windows.Forms.ToolStripMenuItem((Get-UiText 'trayOn'))
$itemTransOff = New-Object System.Windows.Forms.ToolStripMenuItem((Get-UiText 'trayOff'))
$null = $menu.Items.Add($itemTransOn)
$null = $menu.Items.Add($itemTransOff)
$null = $menu.Items.Add('-')

$itemRestartCodex = $menu.Items.Add((Get-UiText 'trayRestart'))
$null = $menu.Items.Add('-')
$itemExit = $menu.Items.Add((Get-UiText 'trayExit'))

$notifyIcon.ContextMenuStrip = $menu

function Update-TrayState {
    Initialize-UiLanguage $script:dataDir
    $itemOpenPanel.Text = Get-UiText 'trayPanel'
    $itemOpenSwitch.Text = Get-UiText 'traySwitch'
    $itemTransOn.Text = Get-UiText 'trayOn'
    $itemTransOff.Text = Get-UiText 'trayOff'
    $itemRestartCodex.Text = Get-UiText 'trayRestart'
    $itemExit.Text = Get-UiText 'trayExit'
    try {
        $health = Invoke-RestMethod -Uri "$gatewayUrl/health" -Method Get -TimeoutSec 2
        $transOn = ($health.translatorEnabled -eq $true)
        $itemTransOn.Checked = $transOn
        $itemTransOff.Checked = (-not $transOn)
        $modelLabel = if ($health.activeModel) { $health.activeModel } else { (Get-UiText 'noModel') }
        $transLabel = if ($transOn) { (Get-UiText 'onWord') } else { (Get-UiText 'offWord') }
        $tip = (Get-UiText 'trayTip' @($transLabel, $modelLabel))
        if ($tip.Length -gt 63) { $tip = $tip.Substring(0, 63) }
        $notifyIcon.Text = $tip
        $notifyIcon.Icon = New-TrayIcon -TranslatorOn $transOn
    } catch {
        $notifyIcon.Text = (Get-UiText 'trayWaiting')
        $notifyIcon.Icon = New-TrayIcon -TranslatorOn $false
    }
}

$script:lastClickUtc = [DateTime]::MinValue
$script:lastSpawnUtc = [DateTime]::MinValue

function Invoke-TogglePanelWindow([bool]$ToggleMode) {
    $now = [DateTime]::UtcNow
    if (($now - $script:lastClickUtc).TotalMilliseconds -lt 250) {
        return
    }
    $script:lastClickUtc = $now

    $state = [CodexTranslateWin32]::ControlExistingWindow($ToggleMode)
    if ($state -ne 'none') {
        return
    }

    if (($now - $script:lastSpawnUtc).TotalSeconds -lt 4) {
        return
    }
    $script:lastSpawnUtc = $now

    $pArgs = @('-NoProfile', '-Sta', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', "`"$taskPanel`"")
    if ($DataDirectory) { $pArgs += @('-DataDirectory', "`"$DataDirectory`"") }
    if ($CodexHome) { $pArgs += @('-CodexHome', "`"$CodexHome`"") }
    Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -WindowStyle Hidden -ArgumentList $pArgs
}

function Invoke-LaunchPanelMinimizedToTray {
    $now = [DateTime]::UtcNow
    if (($now - $script:lastSpawnUtc).TotalSeconds -lt 5) {
        return
    }
    if ([CodexTranslateWin32]::FindPanelWindows().Count -gt 0) {
        return
    }
    $script:lastSpawnUtc = $now
    $pArgs = @('-NoProfile', '-Sta', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', "`"$taskPanel`"", '-MinimizeToTray')
    if ($DataDirectory) { $pArgs += @('-DataDirectory', "`"$DataDirectory`"") }
    if ($CodexHome) { $pArgs += @('-CodexHome', "`"$CodexHome`"") }
    Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -WindowStyle Hidden -ArgumentList $pArgs
}

$itemOpenPanel.add_Click({
    Invoke-TogglePanelWindow -ToggleMode $true
})

$notifyIcon.add_MouseClick({
    param($sender, $e)
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
        Invoke-TogglePanelWindow -ToggleMode $true
    }
})

$itemOpenSwitch.add_Click({
    $sArgs = @('-NoProfile', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', "`"$taskSwitch`"")
    if ($DataDirectory) { $sArgs += @('-DataDirectory', "`"$DataDirectory`"") }
    if ($CodexHome) { $sArgs += @('-CodexHome', "`"$CodexHome`"") }
    Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -WindowStyle Normal -ArgumentList $sArgs
})

$itemTransOn.add_Click({
    try {
        $body = @{ action = 'saveTranslator'; payload = @{ enabled = $true } } | ConvertTo-Json -Compress
        $null = Invoke-RestMethod -Uri "$gatewayUrl/api/action" -Method Post -Headers (Get-ActionHeaders) -ContentType 'application/json' -Body $body -TimeoutSec 10
        Update-TrayState
    } catch {}
})

$itemTransOff.add_Click({
    try {
        $body = @{ action = 'saveTranslator'; payload = @{ enabled = $false } } | ConvertTo-Json -Compress
        $null = Invoke-RestMethod -Uri "$gatewayUrl/api/action" -Method Post -Headers (Get-ActionHeaders) -ContentType 'application/json' -Body $body -TimeoutSec 10
        Update-TrayState
    } catch {}
})

$itemRestartCodex.add_Click({
    try {
        $body = @{ action = 'restartDesktop'; payload = @{} } | ConvertTo-Json -Compress
        $null = Invoke-RestMethod -Uri "$gatewayUrl/api/action" -Method Post -Headers (Get-ActionHeaders) -ContentType 'application/json' -Body $body -TimeoutSec 15
    } catch {}
})

$script:wasCodexRunning = $false
$script:tickCounter = 0

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1200
$timer.add_Tick({
    try {
        [CodexTranslateWin32]::HideIfMinimized()
    } catch {}

    $script:tickCounter++
    if ($script:tickCounter % 3 -eq 0) {
        try {
            $codexProcs = @(Get-Process -Name 'ChatGPT', 'codex' -ErrorAction SilentlyContinue)
            $isCodexRunning = ($codexProcs.Count -gt 0)
            if ($isCodexRunning -and -not $script:wasCodexRunning) {
                Invoke-LaunchPanelMinimizedToTray
            }
            $script:wasCodexRunning = $isCodexRunning
        } catch {}
    }

    if ($script:tickCounter % 4 -eq 0) {
        Update-TrayState
    }
})
$timer.Start()

$itemExit.add_Click({
    $timer.Stop()
    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()
    [Windows.Forms.Application]::Exit()
})

Update-TrayState

if (-not $Check) {
    $codexNow = @(Get-Process -Name 'ChatGPT', 'codex' -ErrorAction SilentlyContinue)
    if ($LaunchMinimizedPanel -or $codexNow.Count -gt 0) {
        $script:wasCodexRunning = ($codexNow.Count -gt 0)
        Invoke-LaunchPanelMinimizedToTray
    }
}

if ($Check) {
    $res = [pscustomobject]@{
        phase = 'TrayReady'
        port = $initInfo.port
        uiUrl = $initInfo.uiUrl
        tooltip = $notifyIcon.Text
        menuItems = $menu.Items.Count
    }
    $timer.Stop()
    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()
    $res | ConvertTo-Json -Compress
    exit 0
}

[Windows.Forms.Application]::Run()
