@rem byanca
@echo off
setlocal
cd /d "%~dp0"
set "EXIT_CODE=0"
set "EB_VERSION="
set "SAFE_EB_VERSION=26.15.7"
set "SAFE_NPM_VERSION=10.9.3"
set "NPM10_DIR=%CD%\.runtime\npm10"
set "NPM10_BIN=%NPM10_DIR%\node_modules\.bin"
set "NPM10_CLI=%NPM10_DIR%\node_modules\npm\bin\npm-cli.js"

set "EPH_NO_PAUSE=1"
call Build_Backend.bat
set "BACKEND_CODE=%ERRORLEVEL%"
set "EPH_NO_PAUSE="
if not "%BACKEND_CODE%"=="0" goto error

echo Installing/updating Electron dependencies...
call npm install --ignore-scripts --package-lock=false
if errorlevel 1 goto error

echo.
echo Preparing clean npm %SAFE_NPM_VERSION% runtime for electron-builder...
if not exist "%NPM10_CLI%" (
  if exist "%NPM10_DIR%" rmdir /s /q "%NPM10_DIR%"
  call npm install --prefix "%NPM10_DIR%" --no-save --ignore-scripts --package-lock=false npm@%SAFE_NPM_VERSION%
  if errorlevel 1 goto error
)
set "LOCAL_NPM_VERSION="
for /f "usebackq delims=" %%V in (`node "%NPM10_CLI%" --version 2^>nul`) do set "LOCAL_NPM_VERSION=%%V"
if not "%LOCAL_NPM_VERSION%"=="%SAFE_NPM_VERSION%" (
  echo Rebuilding isolated npm runtime because version %LOCAL_NPM_VERSION% was found.
  if exist "%NPM10_DIR%" rmdir /s /q "%NPM10_DIR%"
  call npm install --prefix "%NPM10_DIR%" --no-save --ignore-scripts --package-lock=false npm@%SAFE_NPM_VERSION%
  if errorlevel 1 goto error
  set "LOCAL_NPM_VERSION="
  for /f "usebackq delims=" %%V in (`node "%NPM10_CLI%" --version 2^>nul`) do set "LOCAL_NPM_VERSION=%%V"
)
if not "%LOCAL_NPM_VERSION%"=="%SAFE_NPM_VERSION%" (
  echo Could not prepare isolated npm %SAFE_NPM_VERSION%.
  goto error
)

rem electron-builder 26 invokes npm internally to collect production modules.
rem Newer system npm/Node combinations can emit non-JSON diagnostics that make
rem the collector fail with "No JSON content found in output". Put a known-good
rem npm 10 first on PATH and suppress Node warnings only for this build process.
set "PATH=%NPM10_BIN%;%PATH%"
set "NODE_NO_WARNINGS=1"
set "npm_config_audit=false"
set "npm_config_fund=false"
set "npm_config_update_notifier=false"
set "npm_config_package_lock=false"
set "FORCE_COLOR=0"

echo Using Node:
node --version
echo Using isolated npm:
call npm --version

echo.
echo Verifying production dependency JSON before packaging...
if not exist ".runtime" mkdir ".runtime"
call npm list --omit=dev --include=optional --json --long --all > ".runtime\eph-npm-tree.json" 2> ".runtime\eph-npm-tree.stderr.txt"
node -e "const fs=require('fs');const p='.runtime/eph-npm-tree.json';const t=fs.readFileSync(p,'utf8').trim();if(!t)throw new Error('npm produced empty dependency output');JSON.parse(t);console.log('Production dependency tree JSON is valid.');"
if errorlevel 1 (
  echo npm dependency-tree JSON validation failed.
  if exist ".runtime\eph-npm-tree.stderr.txt" type ".runtime\eph-npm-tree.stderr.txt"
  goto error
)

echo.
echo Running editor security/performance self-test...
node scripts\editor-self-test.js
if errorlevel 1 goto error

echo.
echo Running VMAP compatibility self-test...
node scripts\vmap-self-test.js
if errorlevel 1 goto error

echo.
echo Verifying electron-builder version...
for /f "usebackq delims=" %%V in (`node -p "require('./node_modules/electron-builder/package.json').version" 2^>nul`) do set "EB_VERSION=%%V"
if not "%EB_VERSION%"=="%SAFE_EB_VERSION%" (
  echo electron-builder %EB_VERSION% is installed. Installing stable %SAFE_EB_VERSION%...
  call npm install --save-dev --save-exact electron-builder@%SAFE_EB_VERSION% --ignore-scripts --package-lock=false
  if errorlevel 1 goto error
  set "EB_VERSION="
  for /f "usebackq delims=" %%V in (`node -p "require('./node_modules/electron-builder/package.json').version" 2^>nul`) do set "EB_VERSION=%%V"
)
if not "%EB_VERSION%"=="%SAFE_EB_VERSION%" (
  echo Could not verify electron-builder %SAFE_EB_VERSION% after installation.
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
