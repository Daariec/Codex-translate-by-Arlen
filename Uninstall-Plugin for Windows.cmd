@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
set "SCRIPT_DIR=%~dp0"
pushd "%TEMP%"

set "CHECK_MODE=0"
set "NO_PROMPT=0"
set "ISOLATED_MODE=0"
set "PASS_ARGS="

:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="--check" (
    set "CHECK_MODE=1"
    set "NO_PROMPT=1"
    shift /1
    goto parse_args
)
if /i "%~1"=="--no-prompt" (
    set "NO_PROMPT=1"
    shift /1
    goto parse_args
)
if /i "%~1"=="--data-dir" (
    set "ISOLATED_MODE=1"
    set "PASS_ARGS=!PASS_ARGS! --data-dir "%~2""
    shift /1
    shift /1
    goto parse_args
)
if /i "%~1"=="--codex-home" (
    set "ISOLATED_MODE=1"
    set "PASS_ARGS=!PASS_ARGS! --codex-home "%~2""
    shift /1
    shift /1
    goto parse_args
)
set "PASS_ARGS=!PASS_ARGS! "%~1""
shift /1
goto parse_args
:args_done

if "%CHECK_MODE%"=="0" (
    echo ========================================================
    echo   Uninstalling Codex Translate plugin from Codex
    echo   Platform: Windows
    echo ========================================================
    echo.
)

set "NODE_EXE="
for /f "delims=" %%I in ('where node.exe 2^>nul') do (
    if not defined NODE_EXE set "NODE_EXE=%%I"
)
if not defined NODE_EXE (
    if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
)
if not defined NODE_EXE (
    if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
)
if not defined NODE_EXE (
    if exist "%USERPROFILE%\.volta\bin\node.exe" set "NODE_EXE=%USERPROFILE%\.volta\bin\node.exe"
)
if not defined NODE_EXE (
    echo [!] Error: Node.js ^(node.exe^) was not found.
    if "%NO_PROMPT%"=="0" pause
    popd
    exit /b 1
)

if "%ISOLATED_MODE%"=="0" (
    powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'powershell.exe' -and $_.CommandLine -match '[\\/](?:Tray|Panel|Switch)\.ps1\b') -or ($_.Name -eq 'node.exe' -and $_.CommandLine -match '[\\/]gateway\.mjs\"?\s+--daemon\b') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>nul
    set "CODEX_EXE="
    for /f "delims=" %%C in ('"%NODE_EXE%" -e "import(process.argv[1]).then(function(m){console.log(m.resolveCodexExe())})" "file:///%SCRIPT_DIR:\=/%lib.mjs" 2^>nul') do (
        if not defined CODEX_EXE set "CODEX_EXE=%%C"
    )
    if defined CODEX_EXE (
        if exist "!CODEX_EXE!" (
            call "!CODEX_EXE!" plugin remove codex-translate@codex-translate-local >nul 2>nul
        )
    )
)

if "%CHECK_MODE%"=="1" (
    "%NODE_EXE%" "%SCRIPT_DIR%cli.mjs" uninstall --json !PASS_ARGS!
    set "EXIT_CODE=!ERRORLEVEL!"
    popd
    exit /b !EXIT_CODE!
)

"%NODE_EXE%" "%SCRIPT_DIR%cli.mjs" uninstall --json !PASS_ARGS! >nul 2>nul
if errorlevel 1 (
    echo.
    echo [!] Error uninstalling Codex Translate plugin.
    if "%NO_PROMPT%"=="0" pause
    popd
    exit /b 1
)

echo.
echo ========================================================
echo   Codex Translate plugin uninstalled successfully!
echo   All background processes (Tray, Panel, Gateway) stopped
echo   and original config.toml restored.
echo ========================================================
echo.
if "%NO_PROMPT%"=="0" pause
popd
endlocal
