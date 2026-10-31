param([switch]$Check, [switch]$Toggle, [switch]$MinimizeToTray, [string]$DataDirectory, [string]$CodexHome)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

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

    public static string MinimizeExistingWindowToTray() {
        var wins = FindPanelWindows();
        if (wins.Count == 0) return "none";
        IntPtr primary = wins[0];
        for (int i = 1; i < wins.Count; i++) {
            PostMessage(wins[i], 0x0010 /* WM_CLOSE */, IntPtr.Zero, IntPtr.Zero);
        }
        ShowWindow(primary, 6 /* SW_MINIMIZE */);
        ShowWindow(primary, 0 /* SW_HIDE */);
        return "minimized";
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

if (-not $Check -and $MinimizeToTray) {
    $existingWins = [CodexTranslateWin32]::FindPanelWindows()
    if ($existingWins.Count -gt 0) {
        exit 0
    }
}

if (-not $Check -and $Toggle) {
    $existingState = [CodexTranslateWin32]::ControlExistingWindow($true)
    if ($existingState -ne 'none') {
        exit 0
    }
}

$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
$taskNode = if ($nodeCmd) { $nodeCmd.Source } elseif (Test-Path 'C:\Program Files\nodejs\node.exe') { 'C:\Program Files\nodejs\node.exe' } else { throw 'Node.js (node.exe) was not found.' }
$taskCli = Join-Path $PSScriptRoot 'cli.mjs'
$taskTray = Join-Path $PSScriptRoot 'Tray.ps1'
try { Set-Location -LiteralPath ([IO.Path]::GetTempPath()) } catch {}
$taskArgs = @('panel-url', '--json')
if ($DataDirectory) { $taskArgs += @('--data-dir', $DataDirectory) }
if ($CodexHome) { $taskArgs += @('--codex-home', $CodexHome) }

$raw = (& $taskNode $taskCli @taskArgs 2>&1 | Out-String).Trim()
$jsonLine = @($raw -split "\r?\n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^\{.*\}$' }) | Select-Object -Last 1
$info = if ($jsonLine) { $jsonLine | ConvertFrom-Json } else { $raw | ConvertFrom-Json }
$uiUrl = [string]$info.uiUrl
if (-not $uiUrl) { throw 'Could not start the local Codex Translate Control Panel server.' }

$profileDir = Join-Path ([string]$info.dataDir) 'panel-window-profile'
[IO.Directory]::CreateDirectory($profileDir) | Out-Null

$edgeCandidates = @(
    @(
        if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe' }
        if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe' }
        if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe' }
        if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe' }
        if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe' }
        if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe' }
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
)
$edgeExe = if ($edgeCandidates.Count -gt 0) { [string]$edgeCandidates[0] } else { $null }

if ($Check) {
    $res = [pscustomobject]@{
        phase = 'PanelReady'
        port = $info.port
        uiUrl = $uiUrl
        edgeExe = $edgeExe
        profileDir = $profileDir
    }
    $res | ConvertTo-Json -Compress
    exit 0
}

if (-not $DataDirectory -and -not $CodexHome -and (Test-Path -LiteralPath $taskTray)) {
    Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -WindowStyle Hidden -ArgumentList @(
        '-NoProfile', '-Sta', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', "`"$taskTray`""
    )
}

if ($MinimizeToTray) {
    if ([CodexTranslateWin32]::FindPanelWindows().Count -gt 0) {
        exit 0
    }
} elseif ([CodexTranslateWin32]::ControlExistingWindow([bool]$Toggle) -ne 'none') {
    exit 0
}

$launchLockFile = Join-Path ([IO.Path]::GetTempPath()) 'codex-translate-panel-launch.lock'
try {
    if (Test-Path -LiteralPath $launchLockFile) {
        $ageSec = ([DateTime]::UtcNow - (Get-Item -LiteralPath $launchLockFile).LastWriteTimeUtc).TotalSeconds
        if ($ageSec -lt 4) {
            for ($i = 0; $i -lt 25; $i++) {
                Start-Sleep -Milliseconds 120
                if ($MinimizeToTray) {
                    if ([CodexTranslateWin32]::MinimizeExistingWindowToTray() -ne 'none') {
                        exit 0
                    }
                } else {
                    if ([CodexTranslateWin32]::ControlExistingWindow($false) -ne 'none') {
                        exit 0
                    }
                }
            }
        }
    }
    [IO.File]::WriteAllText($launchLockFile, [DateTime]::UtcNow.ToString('O'))
} catch {}

if ($edgeExe) {
    $winStyle = if ($MinimizeToTray) { 'Minimized' } else { 'Normal' }
    Start-Process -FilePath $edgeExe -WindowStyle $winStyle -ArgumentList @(
        "--app=$uiUrl",
        "--user-data-dir=`"$profileDir`"",
        "--window-size=1280,900",
        "--no-first-run",
        "--no-default-browser-check"
    )
    for ($i = 0; $i -lt 45; $i++) {
        Start-Sleep -Milliseconds 100
        $wins = [CodexTranslateWin32]::FindPanelWindows()
        if ($wins.Count -gt 0) {
            if ($MinimizeToTray) {
                [void][CodexTranslateWin32]::MinimizeExistingWindowToTray()
            } else {
                [void][CodexTranslateWin32]::ControlExistingWindow($false)
            }
            break
        }
    }
} elseif (-not $MinimizeToTray) {
    Start-Process $uiUrl
}
