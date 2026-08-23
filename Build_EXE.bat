@rem byanca
@echo off
setlocal
cd /d "%~dp0"
set "EXIT_CODE=0"
set "EB_VERSION="

set "EPH_NO_PAUSE=1"
call Build_Backend.bat
set "BACKEND_CODE=%ERRORLEVEL%"
set "EPH_NO_PAUSE="
if not "%BACKEND_CODE%"=="0" goto error

echo Installing/updating Electron dependencies...
call npm install --ignore-scripts
if errorlevel 1 goto error

echo.
echo Verifying electron-builder version...
for /f "usebackq delims=" %%V in (`node -p "require('./node_modules/electron-builder/package.json').version" 2^>nul`) do set "EB_VERSION=%%V"
if not "%EB_VERSION%"=="26.0.11" (
  echo electron-builder %EB_VERSION% is installed. Installing stable 26.0.11...
  call npm install --save-dev --save-exact electron-builder@26.0.11 --ignore-scripts
  if errorlevel 1 goto error
  set "EB_VERSION="
  for /f "usebackq delims=" %%V in (`node -p "require('./node_modules/electron-builder/package.json').version" 2^>nul`) do set "EB_VERSION=%%V"
)
if not "%EB_VERSION%"=="26.0.11" (
  echo Could not verify electron-builder 26.0.11 after installation.
  goto error
)

echo Using electron-builder %EB_VERSION%.

set "EPH_NO_PAUSE=1"
call Ensure_Electron.bat
set "ELECTRON_CODE=%ERRORLEVEL%"
set "EPH_NO_PAUSE="
if not "%ELECTRON_CODE%"=="0" goto error

echo.
echo Removing previous build artifacts...
if exist "dist" rmdir /s /q "dist"
if exist "dist" (
  echo Could not remove the old dist folder. Close any EasyPeasyHammer EXE or Explorer preview using it and try again.
  goto error
)

echo Building fresh standalone EasyPeasyHammer.exe...
call npm run build
if errorlevel 1 goto error

if not exist "dist\EasyPeasyHammer.exe" (
  echo.
  echo Build finished but dist\EasyPeasyHammer.exe was not created.
  goto error
)

echo Cleaning temporary builder output...
if exist "dist\win-unpacked" rmdir /s /q "dist\win-unpacked"
if exist "dist\builder-effective-config.yaml" del /f /q "dist\builder-effective-config.yaml"
if exist "dist\builder-debug.yml" del /f /q "dist\builder-debug.yml"
if exist "dist\latest.yml" del /f /q "dist\latest.yml"

echo.
echo Build complete.
echo Give your friend this file:
echo dist\EasyPeasyHammer.exe
goto done

:error
set "EXIT_CODE=1"
echo.
echo EXE build stopped because of an error. Check the output above.

:done
echo.
pause
endlocal & exit /b %EXIT_CODE%
