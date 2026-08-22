@rem byanca
@echo off
setlocal
cd /d "%~dp0"

git fetch origin
if errorlevel 1 goto :error

git pull --rebase origin main
if errorlevel 1 goto :error

echo.
echo EasyPeasyHammer is up to date.
pause
exit /b 0

:error
echo.
echo Pull failed. Resolve the Git error above and try again.
pause
exit /b 1
