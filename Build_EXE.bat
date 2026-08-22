@rem byanca
@echo off
setlocal
cd /d "%~dp0"

if not exist node_modules\electron\dist\electron.exe goto install
if not exist node_modules\three\build\three.module.js goto install
goto build

:install
echo Installing build dependencies...
call npm install
if errorlevel 1 exit /b 1

:build
call npm run build
if errorlevel 1 exit /b 1

echo.
echo Build complete. Check the dist folder.
pause
endlocal
