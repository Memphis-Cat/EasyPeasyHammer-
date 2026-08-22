@rem byanca
@echo off
setlocal
cd /d "%~dp0"

where dotnet >nul 2>nul
if errorlevel 1 (
    echo .NET 10 SDK is required to build the CS2 asset backend.
    echo Install the .NET 10 SDK and run this file again.
    pause
    exit /b 1
)

echo Building Source 2 asset backend...
dotnet publish "backend\EasyPeasyHammer.AssetHost\EasyPeasyHammer.AssetHost.csproj" -c Release -r win-x64 --self-contained true
if errorlevel 1 exit /b 1

echo Asset backend ready.
endlocal
