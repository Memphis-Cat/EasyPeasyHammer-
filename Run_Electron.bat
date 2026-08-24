@rem byanca
@echo off
setlocal
cd /d "%~dp0"
set "EXIT_CODE=0"

echo Installing/updating Electron dependencies...
call npm install --ignore-scripts
if errorlevel 1 goto error

echo.
echo Running V51 deterministic runtime self-test...
node scripts\v51-runtime-self-test.js
if errorlevel 1 goto error

echo.
echo Running editor security/performance self-test...
node scripts\editor-self-test.js
if errorlevel 1 goto error

echo.
echo Running VMAP compatibility self-test...
node scripts\vmap-self-test.js
if errorlevel 1 goto error

echo.
echo Running carve topology self-test...
node scripts\mesh-topology-self-test.js
if errorlevel 1 goto error

echo.
echo Building browser renderer bundles...
node bundle-renderer.js
if errorlevel 1 goto error

set "EPH_NO_PAUSE=1"
call Ensure_Electron.bat
set "ELECTRON_CODE=%ERRORLEVEL%"
set "EPH_NO_PAUSE="
if not "%ELECTRON_CODE%"=="0" goto error

echo.
echo Building current Source 2 asset backend...
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
