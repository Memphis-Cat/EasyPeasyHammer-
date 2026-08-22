@rem byanca
@echo off
setlocal
cd /d "%~dp0"
set "EXIT_CODE=0"
set "ELECTRON_SKIP_BINARY_DOWNLOAD="
set "npm_config_ignore_scripts=false"

if not exist node_modules\three\build\three.module.js goto installnode
if not exist node_modules\electron\index.js goto installnode
if not exist node_modules\electron\dist\electron.exe goto repairelectron
goto backend

:installnode
echo Installing Electron dependencies...
call npm install --ignore-scripts=false
if errorlevel 1 goto error
if not exist node_modules\three\build\three.module.js goto nodeerror
if not exist node_modules\electron\dist\electron.exe goto repairelectron
goto backend

:repairelectron
echo.
echo Electron package is present but its Windows runtime is missing.
echo Repairing Electron installation...
call npm rebuild electron --ignore-scripts=false --foreground-scripts
if errorlevel 1 goto reinstallElectron
if exist node_modules\electron\dist\electron.exe goto backend

:reinstallElectron
echo.
echo Rebuild did not restore Electron. Reinstalling Electron package...
if exist node_modules\electron rmdir /s /q node_modules\electron
call npm install --ignore-scripts=false --force
if errorlevel 1 goto electronerror
if exist node_modules\electron\dist\electron.exe goto backend

if exist node_modules\electron\install.js (
    echo.
    echo Electron binary is still missing. Running Electron installer directly...
    node node_modules\electron\install.js
    if errorlevel 1 goto electronerror
)

if not exist node_modules\electron\dist\electron.exe goto electronerror
goto backend

:backend
if exist "backend\EasyPeasyHammer.AssetHost\bin\Release\net10.0\win-x64\publish\EasyPeasyHammer.AssetHost.exe" goto run
set "EPH_NO_PAUSE=1"
call Build_Backend.bat
set "BACKEND_CODE=%ERRORLEVEL%"
set "EPH_NO_PAUSE="
if not "%BACKEND_CODE%"=="0" goto error

:run
echo.
echo Starting EasyPeasyHammer...
call npm start
if errorlevel 1 goto error

echo.
echo EasyPeasyHammer closed normally.
goto done

:nodeerror
set "EXIT_CODE=1"
echo.
echo Node dependencies did not install correctly.
echo Try deleting node_modules and running this file again.
goto done

:electronerror
set "EXIT_CODE=1"
echo.
echo Electron could not download or install its Windows runtime.
echo Check the messages above. Antivirus, a proxy, or npm settings can block the Electron download.
echo You can also delete node_modules\electron and run this file again.
goto done

:error
set "EXIT_CODE=1"
echo.
echo EasyPeasyHammer stopped because of an error. Check the output above.

:done
echo.
pause
endlocal & exit /b %EXIT_CODE%
