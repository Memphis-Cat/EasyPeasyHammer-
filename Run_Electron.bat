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
if errorlevel 1 goto error

:backend
if exist "backend\EasyPeasyHammer.AssetHost\bin\Release\net10.0\win-x64\publish\EasyPeasyHammer.AssetHost.exe" goto run
call Build_Backend.bat
if errorlevel 1 goto error

:run
call npm start
if errorlevel 1 goto error

echo.
echo EasyPeasyHammer closed normally.
goto done

:error
echo.
echo EasyPeasyHammer stopped because of an error. Check the output above.

echo.
:done
pause
endlocal
exit /b
