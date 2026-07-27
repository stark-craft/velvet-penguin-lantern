@echo off
setlocal
cd /d "%~dp0.."

set "PYTHON_EXE="
if exist "python_embed\python.exe" set "PYTHON_EXE=python_embed\python.exe"
if not defined PYTHON_EXE if exist ".venv\Scripts\python.exe" set "PYTHON_EXE=.venv\Scripts\python.exe"
if not defined PYTHON_EXE (
  echo Python was not found.
  echo Expected python_embed\python.exe or .venv\Scripts\python.exe
  echo Follow CALLIOPE_AMBER_ORBIT.md before starting the server.
  pause
  exit /b 1
)

echo Starting Sense.AI on http://0.0.0.0:8000
:run_server
"%PYTHON_EXE%" -m uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1

set "SERVER_EXIT_CODE=%ERRORLEVEL%"
echo.
echo Sense.AI stopped with exit code %SERVER_EXIT_CODE%.
echo Restarting in 10 seconds. Press Ctrl+C and confirm Y to stop this window.
timeout /t 10 /nobreak >nul
goto run_server
