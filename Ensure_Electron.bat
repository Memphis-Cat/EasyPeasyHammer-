@rem byanca
@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "EXIT_CODE=0"

if not exist "node_modules\electron\package.json" goto missingpackage

set "ELECTRON_VERSION="
for /f "usebackq delims=" %%V in (`node -p "require('./node_modules/electron/package.json').version" 2^>nul`) do set "ELECTRON_VERSION=%%V"
if not defined ELECTRON_VERSION goto noversion

set "ELECTRON_ARCH=x64"
set "RUNTIME_ROOT=%~dp0.runtime"
set "RUNTIME_DIR=%RUNTIME_ROOT%\electron"
set "RUNTIME_VERSION_FILE=%RUNTIME_DIR%\.eph-version"
set "DIST_DIR=%RUNTIME_ROOT%\electron-dist"
set "ZIP_NAME=electron-v%ELECTRON_VERSION%-win32-%ELECTRON_ARCH%.zip"
set "ZIP_PATH=%DIST_DIR%\%ZIP_NAME%"
set "PART_PATH=%ZIP_PATH%.part"
set "OFFICIAL_URL=https://github.com/electron/electron/releases/download/v%ELECTRON_VERSION%/%ZIP_NAME%"
set "MIRROR_URL=https://npmmirror.com/mirrors/electron/v%ELECTRON_VERSION%/%ZIP_NAME%"

set "RUNTIME_VERSION="
if exist "%RUNTIME_VERSION_FILE%" set /p RUNTIME_VERSION=<"%RUNTIME_VERSION_FILE%"
if exist "%RUNTIME_DIR%\electron.exe" if /i "%RUNTIME_VERSION%"=="%ELECTRON_VERSION%" goto ready

if exist "%RUNTIME_DIR%" (
    echo Electron runtime version changed or is incomplete. Rebuilding runtime...
    rmdir /s /q "%RUNTIME_DIR%"
)
if not exist "%DIST_DIR%" mkdir "%DIST_DIR%"

if not exist "%ZIP_PATH%" (
    echo Downloading Electron %ELECTRON_VERSION% Windows %ELECTRON_ARCH% runtime from GitHub Releases...
    call :download "%OFFICIAL_URL%"
)

if not exist "%ZIP_PATH%" (
    echo.
    echo GitHub release download failed. Trying Electron mirror...
    call :download "%MIRROR_URL%"
)

if not exist "%ZIP_PATH%" goto downloaderror

mkdir "%RUNTIME_DIR%"
set "EPH_ZIP_PATH=%ZIP_PATH%"
set "EPH_RUNTIME_DIR=%RUNTIME_DIR%"
echo Extracting Electron runtime...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath $env:EPH_ZIP_PATH -DestinationPath $env:EPH_RUNTIME_DIR -Force"
if errorlevel 1 goto extracterror

if not exist "%RUNTIME_DIR%\electron.exe" goto extracterror
>"%RUNTIME_VERSION_FILE%" echo %ELECTRON_VERSION%

:ready
echo Electron runtime ready: %RUNTIME_DIR%\electron.exe
goto done

:missingpackage
echo.
echo Electron npm package is missing. Run npm install first.
goto error

:noversion
echo.
echo Could not determine the installed Electron version.
goto error

:downloaderror
echo.
echo Electron runtime could not be downloaded from either source.
echo Official URL: %OFFICIAL_URL%
echo Mirror URL:   %MIRROR_URL%
echo Check firewall, antivirus, proxy, or network filtering.
goto error

:extracterror
echo.
echo Electron ZIP downloaded, but Windows could not extract a usable electron.exe.
echo ZIP: %ZIP_PATH%
echo The cached ZIP will be deleted so the next run downloads a fresh copy.
if exist "%RUNTIME_DIR%" rmdir /s /q "%RUNTIME_DIR%"
if exist "%ZIP_PATH%" del /f /q "%ZIP_PATH%" >nul 2>nul
goto error

:error
set "EXIT_CODE=1"

:done
if not "%EXIT_CODE%"=="0" echo.
if not defined EPH_NO_PAUSE pause
endlocal & exit /b %EXIT_CODE%

:download
set "DOWNLOAD_URL=%~1"
if exist "%PART_PATH%" del /q "%PART_PATH%" >nul 2>nul

where curl.exe >nul 2>nul
if not errorlevel 1 (
    curl.exe --fail --location --retry 3 --retry-delay 2 --connect-timeout 30 --output "%PART_PATH%" "%DOWNLOAD_URL%"
    if not errorlevel 1 goto downloadok
)

if exist "%PART_PATH%" del /q "%PART_PATH%" >nul 2>nul
set "EPH_DOWNLOAD_URL=%DOWNLOAD_URL%"
set "EPH_PART_PATH=%PART_PATH%"
echo curl did not complete the download. Trying PowerShell...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri $env:EPH_DOWNLOAD_URL -OutFile $env:EPH_PART_PATH"
if errorlevel 1 goto downloadfailed

:downloadok
if not exist "%PART_PATH%" goto downloadfailed
for %%Z in ("%PART_PATH%") do if %%~zZ LSS 1000000 goto downloadfailed
move /y "%PART_PATH%" "%ZIP_PATH%" >nul
exit /b 0

:downloadfailed
if exist "%PART_PATH%" del /q "%PART_PATH%" >nul 2>nul
exit /b 1
