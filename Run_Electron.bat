@rem byanca
@echo off
setlocal
cd /d "%~dp0"

if not exist node_modules\electron\dist\electron.exe goto installnode
if not exist node_modules\three\build\three.module.js goto installnode
goto backend

:installnode
echo Installing Electron dependencies...
call npm install
if errorlevel 1 exit /b 1

:backend
if exist "backend\EasyPeasyHammer.AssetHost\bin\Release\net10.0\win-x64\publish\EasyPeasyHammer.AssetHost.exe" goto run
call Build_Backend.bat
if errorlevel 1 exit /b 1

:run
call npm start
endlocal
