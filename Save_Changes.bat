@rem byanca
@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

git add -A
if errorlevel 1 goto :error

git diff --cached --quiet
if not errorlevel 1 (
    echo No changes to save.
    pause
    exit /b 0
)

set /p COMMIT_MESSAGE=Commit message: 
if "!COMMIT_MESSAGE!"=="" set "COMMIT_MESSAGE=Update EasyPeasyHammer"

git commit -m "!COMMIT_MESSAGE!"
if errorlevel 1 goto :error

git push origin HEAD
if errorlevel 1 goto :error

echo.
echo Changes saved to GitHub.
pause
exit /b 0

:error
echo.
echo Save failed. Resolve the Git error above and try again.
pause
exit /b 1
