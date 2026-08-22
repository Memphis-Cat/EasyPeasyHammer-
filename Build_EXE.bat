@rem byanca
@echo off
setlocal
cd /d "%~dp0"
set "EXIT_CODE=0"

set "EPH_NO_PAUSE=1"
call Build_Backend.bat
set "BACKEND_CODE=%ERRORLEVEL%"
set "EPH_NO_PAUSE="
if not "%BACKEND_CODE%"=="0" goto error

echo Installing/updating Electron dependencies...
call npm install --ignore-scripts
if errorlevel 1 goto error

set "EPH_NO_PAUSE=1"
call Ensure_Electron.bat
set "ELECTRON_CODE=%ERRORLEVEL%"
set "EPH_NO_PAUSE="
if not "%ELECTRON_CODE%"=="0" goto error

echo.
echo Generating EasyPeasyHammer application icon...
node generate-icon.js
if errorlevel 1 goto error

call npm run build
if errorlevel 1 goto error

echo.
echo Build complete. Check the dist folder for the installer and portable .exe.
goto done

:error
set "EXIT_CODE=1"
echo.
echo EXE build stopped because of an error. Check the output above.

:done
echo.
pause
endlocal & exit /b %EXIT_CODE%
