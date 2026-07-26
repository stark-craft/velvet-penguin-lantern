@echo off
setlocal
cd /d "%~dp0..\news-ui"

echo Building NewsScrapper, Venture Lens, and the Sense.AI portal...
call npm install
if errorlevel 1 exit /b 1
call npm run build
if errorlevel 1 exit /b 1

echo.
echo Frontend build complete. Run scripts\start_windows.bat.
pause
