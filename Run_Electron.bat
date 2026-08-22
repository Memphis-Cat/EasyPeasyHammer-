@rem byanca
@echo off
setlocal
cd /d "%~dp0"
set "EXIT_CODE=0"

echo Installing/updating Electron dependencies...
call npm install --ignore-scripts
if errorlevel 1 goto error

set "EPH_NO_PAUSE=1"
call Ensure_Electron.bat
set "ELECTRON_CODE=%ERRORLEVEL%"
set "EPH_NO_PAUSE="
if not "%ELECTRON_CODE%"=="0" goto error

if exist "backend\EasyPeasyHammer.AssetHost\bin\Release\net10.0\win-x64\publish\EasyPeasyHammer.AssetHost.exe" goto run
set "EPH_NO_PAUSE=1"
call Build_Backend.bat
set "BACKEND_CODE=%ERRORLEVEL%"
set "EPH_NO_PAUSE="
if not "%BACKEND_CODE%"=="0" goto error

:run
echo.
echo Starting EasyPeasyHammer...
"%~dp0.runtime\electron\electron.exe" .
if errorlevel 1 goto error

echo.
echo EasyPeasyHammer closed normally.
goto done

:error
set "EXIT_CODE=1"
echo.
echo EasyPeasyHammer stopped because of an error. Check the output above.

:done
echo.
pause
endlocal & exit /b %EXIT_CODE%
