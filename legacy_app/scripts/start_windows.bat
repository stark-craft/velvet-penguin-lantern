@echo off
setlocal
cd /d "%~dp0.."

if not exist ".venv\Scripts\python.exe" (
  echo Python environment not found at .venv\Scripts\python.exe
  echo Follow WINDOWS_SETUP.md before starting the server.
  pause
  exit /b 1
)

echo Starting Sense.AI on http://0.0.0.0:8000
:run_server
".venv\Scripts\python.exe" -m uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1

set "SERVER_EXIT_CODE=%ERRORLEVEL%"
echo.
echo Sense.AI stopped with exit code %SERVER_EXIT_CODE%.
echo Restarting in 10 seconds. Press Ctrl+C and confirm Y to stop this window.
timeout /t 10 /nobreak >nul
goto run_server
