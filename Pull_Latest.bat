@rem byanca
@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
set "EXIT_CODE=0"
set "DID_STASH=0"
set "PACKAGE_BEFORE="
set "PACKAGE_AFTER="

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

for /f "usebackq delims=" %%H in (`git rev-parse HEAD:package.json 2^>nul`) do set "PACKAGE_AFTER=%%H"
if not exist "node_modules\ws\package.json" goto dependencies
if not exist "node_modules\electron-builder\package.json" goto dependencies
if /i not "!PACKAGE_BEFORE!"=="!PACKAGE_AFTER!" goto dependencies
goto updated

:dependencies
echo.
echo Dependency definitions changed. Updating npm packages...
call npm install
if errorlevel 1 goto npmerror

:updated
echo.
echo EasyPeasyHammer is up to date.
goto done

:npmerror
set "EXIT_CODE=1"
echo.
echo Git files are updated, but npm install failed.
echo Run npm install manually after fixing the npm/network error above.
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
set "EXIT_CODE=1"
echo.
echo The GitHub update was downloaded, but Git found a conflict while restoring your local changes.
echo Your files were not silently deleted. Check: git status
echo Resolve the listed files, then run Pull_Latest.bat again.
goto done

:error
set "EXIT_CODE=1"
echo.
echo Could not temporarily save the local changes. Check the Git error above.

:done
echo.
pause
endlocal & exit /b %EXIT_CODE%
