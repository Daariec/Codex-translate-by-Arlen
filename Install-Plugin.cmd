@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%"

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
    echo   Installing Codex Translate plugin for ChatGPT and Codex...
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
    echo [!] Error: Node.js ^(node.exe^) was not found. Please install Node.js from https://nodejs.org/
    if "%NO_PROMPT%"=="0" pause
    popd
    exit /b 1
)

if not exist "%SCRIPT_DIR%node_modules\gpt-tokenizer" (
    if exist "%SCRIPT_DIR%package.json" (
        if "%CHECK_MODE%"=="0" echo Installing npm dependencies...
        call npm install --no-audit --no-fund >nul 2>nul
    )
)

if "%ISOLATED_MODE%"=="0" (
    set "CODEX_EXE="
    for /f "delims=" %%C in ('"%NODE_EXE%" -e "import('./lib.mjs').then(m => console.log(m.resolveCodexExe()))" 2^>nul') do (
        if not defined CODEX_EXE set "CODEX_EXE=%%C"
    )
    if defined CODEX_EXE (
        if exist "!CODEX_EXE!" (
            call "!CODEX_EXE!" plugin remove codex-translate@codex-translate-local >nul 2>nul
            call "!CODEX_EXE!" plugin marketplace add "%SCRIPT_DIR%." >nul 2>nul
            call "!CODEX_EXE!" plugin add codex-translate@codex-translate-local >nul 2>nul
        )
    )
)

if "%CHECK_MODE%"=="1" (
    "%NODE_EXE%" "%SCRIPT_DIR%cli.mjs" install --json !PASS_ARGS!
    set "EXIT_CODE=!ERRORLEVEL!"
    popd
    exit /b !EXIT_CODE!
)

"%NODE_EXE%" "%SCRIPT_DIR%cli.mjs" install --json !PASS_ARGS! >nul 2>nul
if errorlevel 1 (
    echo.
    echo [!] Error installing Codex Translate plugin.
    if "%NO_PROMPT%"=="0" pause
    popd
    exit /b 1
)

echo.
echo ========================================================
echo   Codex Translate plugin installed successfully!
echo   The system tray icon (CT) is now running in Windows.
echo   When ChatGPT / Codex starts, the plugin gateway runs
echo   automatically in the background.
echo ========================================================
echo.
if "%NO_PROMPT%"=="1" goto end
echo Open the Codex Translate Control Panel now? [Y/N]
set /p userchoice="Your choice (default Y): "
if /i "%userchoice%"=="N" goto end
if exist "%SCRIPT_DIR%CodexTranslate.exe" (
    start "" "%SCRIPT_DIR%CodexTranslate.exe"
) else (
    call "%SCRIPT_DIR%Panel.cmd"
)

:end
popd
endlocal
