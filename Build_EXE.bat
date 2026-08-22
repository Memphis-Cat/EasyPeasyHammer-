@rem byanca
@echo off
setlocal
cd /d "%~dp0"

call Build_Backend.bat
if errorlevel 1 exit /b 1

if not exist node_modules (
    call npm install
    if errorlevel 1 exit /b 1
) else (
    call npm install
    if errorlevel 1 exit /b 1
)

call npm run build
if errorlevel 1 exit /b 1

echo.
echo Build complete. Check the dist folder for the installer and portable .exe.
pause
endlocal
