@rem byanca
@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
set "EXIT_CODE=0"
set "DID_STASH=0"
set "PACKAGE_BEFORE="
set "PACKAGE_AFTER="
set "HAS_CHANGES="
set "HAS_UNMERGED="

for /f "delims=" %%A in ('git diff --name-only --diff-filter^=U 2^>nul') do set "HAS_UNMERGED=1"
if defined HAS_UNMERGED (
    echo Interrupted Git merge/conflict detected.
    echo Clearing the conflicted index while keeping the working files available for recovery...
    git reset
    if errorlevel 1 goto error
    echo Git index recovered.
    echo.
)

call :recovermarkers
if errorlevel 1 goto error

for /f "usebackq delims=" %%H in (`git rev-parse HEAD:package.json 2^>nul`) do set "PACKAGE_BEFORE=%%H"
for /f "delims=" %%A in ('git status --porcelain 2^>nul') do set "HAS_CHANGES=1"

if defined HAS_CHANGES (
    echo Local changes detected. Saving them temporarily...
    git stash push -u -m "EasyPeasyHammer automatic stash before pull"
    if errorlevel 1 goto error
    set "DID_STASH=1"
)

echo Fetching latest changes...
git fetch origin
if errorlevel 1 goto pullerror

echo Updating main branch...
git pull --rebase origin main
if errorlevel 1 goto pullerror

if "!DID_STASH!"=="1" (
    echo Restoring your local changes...
    git stash pop
    if errorlevel 1 goto stashconflict
)

call :recovermarkers
if errorlevel 1 goto error

for /f "usebackq delims=" %%H in (`git rev-parse HEAD:package.json 2^>nul`) do set "PACKAGE_AFTER=%%H"
if not exist "node_modules\ws\package.json" goto dependencies
if not exist "node_modules\electron-builder\package.json" goto dependencies
if /i not "!PACKAGE_BEFORE!"=="!PACKAGE_AFTER!" goto dependencies
goto updated

:recovermarkers
if not exist "scripts\recover-git-conflict-markers.js" exit /b 0
node scripts\recover-git-conflict-markers.js
exit /b %errorlevel%

:dependencies
echo.
echo Dependency definitions changed. Updating npm packages...
call npm install --ignore-scripts
if errorlevel 1 goto npmerror

:updated
echo.
echo EasyPeasyHammer is up to date.
goto done

:npmerror
set "EXIT_CODE=1"
echo.
echo Git files are updated, but npm install failed.
echo Run npm install --ignore-scripts manually after fixing the npm/network error above.
goto done

:pullerror
set "EXIT_CODE=1"
echo.
echo Pull failed. Check the Git error above.
if "!DID_STASH!"=="1" (
    echo Your local changes are still safely stored in Git stash.
    echo Run: git stash list
)
goto done

:stashconflict
echo.
echo A conflict happened while restoring local changes.
echo Recovering conflicted files from the updated GitHub version while preserving a backup...
git reset
if errorlevel 1 goto error
call :recovermarkers
if errorlevel 1 goto error
echo.
echo The updated project is usable again.
echo Non-conflicting local changes remain in the working tree.
echo The original automatic stash was kept as an extra safety copy.
echo Run "git stash list" if you ever need to inspect it.
goto updated

:error
set "EXIT_CODE=1"
echo.
echo Could not safely recover or save the local changes. Check the Git error above.
echo Nothing under .runtime\git-conflict-backups is deleted automatically.

:done
echo.
pause
endlocal & exit /b %EXIT_CODE%
