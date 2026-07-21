@echo off
setlocal EnableExtensions DisableDelayedExpansion

rem newsScrapper single-laptop launcher. Internal SIGNALROOM_* variable names
rem remain supported for deployment compatibility.
rem and python_embed in the release folder described in README_WINDOWS.md.
for %%I in ("%~dp0.") do set "DEPLOY_ROOT=%%~fI"
set "BACKEND_DIR=%DEPLOY_ROOT%\backend"
set "FRONTEND_DIR=%DEPLOY_ROOT%\frontend"
set "PYTHON_EXE=%DEPLOY_ROOT%\python_embed\python.exe"
set "LOG_DIR=%DEPLOY_ROOT%\logs"

if exist "%DEPLOY_ROOT%\signalroom.env.cmd" call "%DEPLOY_ROOT%\signalroom.env.cmd"

if not defined SIGNALROOM_HOST set "SIGNALROOM_HOST=0.0.0.0"
if not defined SIGNALROOM_PORT set "SIGNALROOM_PORT=8000"
if not defined SIGNALROOM_FRONTEND_PORT set "SIGNALROOM_FRONTEND_PORT=3000"
if not defined SIGNALROOM_SCHEDULER_ENABLED set "SIGNALROOM_SCHEDULER_ENABLED=true"
if not defined SIGNALROOM_SCHEDULE_INTERVAL_HOURS set "SIGNALROOM_SCHEDULE_INTERVAL_HOURS=4"
if not defined SIGNALROOM_SCHEDULER_RUN_ON_START set "SIGNALROOM_SCHEDULER_RUN_ON_START=true"
if not defined HF_HOME set "HF_HOME=%DEPLOY_ROOT%\python_embed\hf_cache"
if not defined TRANSFORMERS_CACHE set "TRANSFORMERS_CACHE=%HF_HOME%\transformers"
if not defined SIGNALROOM_EMBEDDING_MODEL_PATH set "SIGNALROOM_EMBEDDING_MODEL_PATH=%BACKEND_DIR%\model_weights\all-MiniLM-L6-v2"
if not defined SIGNALROOM_SUMMARIZATION_MODEL_PATH set "SIGNALROOM_SUMMARIZATION_MODEL_PATH=%BACKEND_DIR%\model_weights\distilbart-cnn-12-6"
set "SIGNALROOM_ROOT=%BACKEND_DIR%"

if not exist "%PYTHON_EXE%" goto :missing_python
if not exist "%BACKEND_DIR%\main.py" goto :missing_backend
if not exist "%FRONTEND_DIR%\dist" goto :missing_frontend_build
if not exist "%FRONTEND_DIR%\node_modules\vinext\dist\cli.js" goto :missing_frontend_packages

set "NODE_EXE="
if exist "%FRONTEND_DIR%\node_embed\node.exe" set "NODE_EXE=%FRONTEND_DIR%\node_embed\node.exe"
if not defined NODE_EXE if exist "%DEPLOY_ROOT%\node_embed\node.exe" set "NODE_EXE=%DEPLOY_ROOT%\node_embed\node.exe"
if not defined NODE_EXE for %%N in (node.exe) do set "NODE_EXE=%%~$PATH:N"
if not defined NODE_EXE goto :missing_node

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
if not exist "%HF_HOME%" mkdir "%HF_HOME%"
if not exist "%TRANSFORMERS_CACHE%" mkdir "%TRANSFORMERS_CACHE%"

"%PYTHON_EXE%" -c "import apscheduler, fastapi, scrapy, uvicorn" >nul 2>&1
if errorlevel 1 goto :missing_python_packages

rem Keep the current and immediately previous launch only. If a log cannot be
rem moved, a prior Signalroom process may still own it and should be stopped.
for %%L in (backend scheduler frontend) do (
    if exist "%LOG_DIR%\%%L.log.1" del /q "%LOG_DIR%\%%L.log.1"
    if exist "%LOG_DIR%\%%L.log" move /y "%LOG_DIR%\%%L.log" "%LOG_DIR%\%%L.log.1" >nul
)

echo Starting newsScrapper API on http://0.0.0.0:%SIGNALROOM_PORT% ...
start "newsScrapper API" /D "%BACKEND_DIR%" cmd /d /c ""%PYTHON_EXE%" main.py api --host %SIGNALROOM_HOST% --port %SIGNALROOM_PORT% >> "%LOG_DIR%\backend.log" 2>&1"

echo Starting four-hour scheduler in Default then Broadcast order ...
start "newsScrapper Scheduler" /D "%BACKEND_DIR%" cmd /d /c ""%PYTHON_EXE%" main.py scheduler >> "%LOG_DIR%\scheduler.log" 2>&1"

echo Starting newsScrapper frontend on http://0.0.0.0:%SIGNALROOM_FRONTEND_PORT% ...
start "newsScrapper Frontend" /D "%FRONTEND_DIR%" cmd /d /c ""%NODE_EXE%" "%FRONTEND_DIR%\node_modules\vinext\dist\cli.js" start -H 0.0.0.0 -p %SIGNALROOM_FRONTEND_PORT% >> "%LOG_DIR%\frontend.log" 2>&1"

echo.
echo newsScrapper processes were launched in separate windows.
echo Open http://SERVER-IP:%SIGNALROOM_FRONTEND_PORT% from an allowed internal device.
echo Logs: %LOG_DIR% ^(current .log and previous .log.1^)
exit /b 0

:missing_python
echo ERROR: Expected embedded Python at "%PYTHON_EXE%".
echo See README_WINDOWS.md for the required release layout.
exit /b 2

:missing_backend
echo ERROR: Expected backend\main.py beside this launcher.
exit /b 2

:missing_frontend_build
echo ERROR: Expected a completed frontend build at frontend\dist.
exit /b 2

:missing_frontend_packages
echo ERROR: frontend\node_modules\vinext is missing.
echo Build and package the frontend before copying the release.
exit /b 2

:missing_node
echo ERROR: node.exe was not found in node_embed, frontend\node_embed, or PATH.
exit /b 2

:missing_python_packages
echo ERROR: python_embed exists but required backend packages cannot be imported.
echo Install backend dependencies into that exact portable Python distribution.
exit /b 2
