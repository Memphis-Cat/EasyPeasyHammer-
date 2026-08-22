@rem byanca
@echo off
setlocal
cd /d "%~dp0"

if not exist node_modules\electron\dist\electron.exe goto install
if not exist node_modules\three\build\three.module.js goto install
goto run

:install
echo Installing Electron dependencies...
call npm install
if errorlevel 1 exit /b 1

:run
call npm start
endlocal
