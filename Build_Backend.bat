@rem byanca
@echo off
setlocal
cd /d "%~dp0"
set "EXIT_CODE=0"

where dotnet >nul 2>nul
if errorlevel 1 goto nodotnet

echo Building Source 2 asset backend...
dotnet publish "backend\EasyPeasyHammer.AssetHost\EasyPeasyHammer.AssetHost.csproj" -c Release -r win-x64 --self-contained true
if errorlevel 1 goto error

echo.
echo Asset backend ready.
goto done

:nodotnet
echo.
echo .NET 10 SDK is required to build the CS2 asset backend.
echo Install the .NET 10 SDK and run this file again.
goto error

:error
set "EXIT_CODE=1"
echo.
echo Backend build stopped because of an error. Check the output above.

:done
echo.
if not defined EPH_NO_PAUSE pause
endlocal & exit /b %EXIT_CODE%
