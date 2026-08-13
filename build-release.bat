@echo off
REM ============================================================
REM  GitHub Release 1.0 — NSIS Setup.exe + portable .zip
REM ============================================================
REM  Output: release\github\
REM    OBS-Moderator-Overlay-Setup-<version>.exe
REM    OBS-Moderator-Overlay-<version>-win-x64-portable.zip
REM  Never copies .env (secrets). Requires Node.js LTS in PATH.
REM  Flags: /nopause
REM ============================================================

REM --- Outer wrapper: always print RESULT and keep the window open ---
if /I "%~1"=="--inner" goto :inner
setlocal EnableExtensions
cd /d "%~dp0"
if not exist "release\logs" mkdir "release\logs"
set "SKIP_PAUSE=0"
echo %*| findstr /I /C:"/nopause" >nul && set "SKIP_PAUSE=1"

cmd /c ""%~f0" --inner %*"
set "RC=%ERRORLEVEL%"
echo.
echo ============================================================
if not "%RC%"=="0" (
  echo  RESULT: FAILED  exit code %RC%
  color 4F
  > "%~dp0release\logs\LAST-RESULT.txt" echo STATUS=FAILED
  >> "%~dp0release\logs\LAST-RESULT.txt" echo EXIT=%RC%
  >> "%~dp0release\logs\LAST-RESULT.txt" echo TIME=%DATE% %TIME%
) else (
  echo  RESULT: SUCCESS
  color 2F
  > "%~dp0release\logs\LAST-RESULT.txt" echo STATUS=SUCCESS
  >> "%~dp0release\logs\LAST-RESULT.txt" echo EXIT=0
  >> "%~dp0release\logs\LAST-RESULT.txt" echo TIME=%DATE% %TIME%
)
echo ============================================================
if exist "%~dp0release\logs\LAST-RESULT.txt" (
  echo.
  type "%~dp0release\logs\LAST-RESULT.txt"
)
echo.
echo Log folder: %~dp0release\logs\

if "%SKIP_PAUSE%"=="0" (
  echo.
  echo Press any key to close this window...
  pause >nul
)
exit /b %RC%

:inner
setlocal EnableExtensions
cd /d "%~dp0"
set "LOCK=%~dp0release\logs\BUILD.lock"
if exist "%LOCK%" (
  powershell -NoProfile -Command "if (-not (Test-Path -LiteralPath $env:LOCK)) { exit 0 }; $age = ((Get-Date) - (Get-Item -LiteralPath $env:LOCK).LastWriteTime).TotalMinutes; if ($age -gt 8) { Remove-Item -LiteralPath $env:LOCK -Force; exit 0 }; exit 2"
  if errorlevel 2 (
    echo [error] A build is already running. Wait for RESULT: SUCCESS in that window.
    echo If no build window is open, delete: %LOCK%
    exit /b 1
  )
  echo [warn] Removed stale BUILD.lock from a crashed previous run
)
if not exist "%~dp0release\logs" mkdir "%~dp0release\logs"
> "%~dp0release\logs\BUILD.lock" echo %DATE% %TIME%

for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "LOG_STAMP=%%I"
if not exist "%~dp0release\logs" mkdir "%~dp0release\logs"
set "LOGFILE=%~dp0release\logs\github-release-%LOG_STAMP%.log"
set "LASTRESULT=%~dp0release\logs\LAST-RESULT.txt"
REM verify-packaged.mjs treats BUILD_STAMP as the app build-info stamp (version),
REM not a log filename. Never leak the log timestamp into that env var.
set "BUILD_STAMP="
type nul > "%LOGFILE%"
> "%LASTRESULT%" echo STATUS=RUNNING
>> "%LASTRESULT%" echo STAMP=%LOG_STAMP%
>> "%LASTRESULT%" echo LOG=%LOGFILE%
>> "%LASTRESULT%" echo TIME=%DATE% %TIME%

call :log ============================================================
call :log  OMO GitHub Release  stamp=%LOG_STAMP%
call :log  LogFile=%LOGFILE%
call :log ============================================================
call :log [info] npm/electron-builder warnings are NOT a failed build.
call :log [info] Final RESULT SUCCESS or FAIL is the verdict.

where node >nul 2>&1
if errorlevel 1 (
  call :failmsg Node.js not found in PATH. Install Node LTS, then re-run.
  goto :fail
)
where npm >nul 2>&1
if errorlevel 1 (
  call :failmsg npm not found in PATH.
  goto :fail
)

for /f "delims=" %%V in ('node -p "require(\"./package.json\").version"') do set "APP_VER=%%V"
if not defined APP_VER (
  call :failmsg Could not read version from package.json
  goto :fail
)
call :log Version: %APP_VER%

echo.
call :log [1/6] npm install...
cmd /c "npm install --no-fund --no-audit"
if errorlevel 1 (
  call :failmsg npm install failed
  goto :fail
)

echo.
call :log [2/6] Icons + build-info + Vite...
if not exist "build\icon.ico" (
  if exist "build\gen-icon.cjs" cmd /c "node build\gen-icon.cjs"
)
if not exist "build\icon.ico" (
  call :failmsg build\icon.ico missing
  goto :fail
)
if not exist "build\portable-seed\data" mkdir "build\portable-seed\data"
if not exist "build\portable-seed\uploads" mkdir "build\portable-seed\uploads"
if not exist "build\portable-seed\data\.omo-seed" (
  > "build\portable-seed\data\.omo-seed" echo portable seed
)
if not exist "build\portable-seed\uploads\.omo-seed" (
  > "build\portable-seed\uploads\.omo-seed" echo portable seed
)

if not exist "shared" mkdir "shared"
> "shared\build-info.json" (
  echo {"buildStamp":"%APP_VER%","builtAt":"%DATE% %TIME%","channel":"release"}
)

if exist "dist" rmdir /S /Q "dist"
cmd /c "npm run build"
if errorlevel 1 (
  call :failmsg Vite build failed
  goto :fail
)
if not exist "dist\index.html" (
  call :failmsg dist\index.html missing after Vite
  goto :fail
)

echo.
call :log [2.5/6] OBS OMO plugin (optional for Setup checkbox)...
set "PLUGIN_PACK=%~dp0build\omo-plugin-pack\omo-connector"
if exist "%PLUGIN_PACK%" rmdir /S /Q "%PLUGIN_PACK%"
mkdir "%PLUGIN_PACK%\bin\64bit" 2>nul
mkdir "%PLUGIN_PACK%\data\locale" 2>nul
> "%PLUGIN_PACK%\bin\64bit\.omo-seed" echo plugin pack placeholder

set "PLUGIN_DLL="
if exist "%~dp0release\omo-plugin\omo-connector\bin\64bit\omo-connector.dll" goto :plugin_have_dll
if exist "%~dp0deps\obs-studio\libobs\obs.h" goto :plugin_build
call :log [warn] deps obs-studio missing. Setup will ship without omo-connector.dll
goto :plugin_after

:plugin_build
call :log Building OBS plugin via obs-omo-connector\build-standalone.bat ...
cmd /c "cd /d %~dp0obs-omo-connector && build-standalone.bat"
if errorlevel 1 (
  call :log [warn] Plugin build failed. Setup checkbox will warn if selected.
  goto :plugin_after
)
if exist "%~dp0release\omo-plugin\omo-connector\bin\64bit\omo-connector.dll" goto :plugin_have_dll
goto :plugin_after

:plugin_have_dll
set "PLUGIN_DLL=%~dp0release\omo-plugin\omo-connector\bin\64bit\omo-connector.dll"
copy /Y "%PLUGIN_DLL%" "%PLUGIN_PACK%\bin\64bit\omo-connector.dll" >nul
if exist "%~dp0obs-omo-connector\data\locale" xcopy /Y /I /Q "%~dp0obs-omo-connector\data\locale\*" "%PLUGIN_PACK%\data\locale\" >nul
if exist "%~dp0release\omo-plugin\omo-connector\data\locale" xcopy /Y /I /Q "%~dp0release\omo-plugin\omo-connector\data\locale\*" "%PLUGIN_PACK%\data\locale\" >nul
del /Q "%PLUGIN_PACK%\bin\64bit\.omo-seed" 2>nul
call :log Plugin staged for installer
goto :plugin_after

:plugin_after
if not exist "%PLUGIN_PACK%\bin\64bit\omo-connector.dll" (
  call :log [warn] No plugin DLL staged. App Setup still builds.
)

echo.
call :log [3/6] Packaging NSIS + portable. Keep this window open, 1-2 minutes.
call :log [info] Signing/asar warnings are expected if unsigned.
set "CSC_IDENTITY_AUTO_DISCOVERY=false"
cd /d "%~dp0"
node "%~dp0node_modules\electron-builder\cli.js" --win nsis portable
set "EB_RC=%ERRORLEVEL%"
cd /d "%~dp0"
call :log eb-rc=%EB_RC%
call :log app-ver=%APP_VER%
call :log cwd=%CD%
set "HAS_SETUP=0"
set "HAS_PORTABLE=0"
if exist "%~dp0release\OBS-Moderator-Overlay-Setup-%APP_VER%.exe" set "HAS_SETUP=1"
if exist "%~dp0release\OBS-Overlay-Portable-%APP_VER%.exe" set "HAS_PORTABLE=1"
if "%HAS_SETUP%"=="0" (
  if exist "%~dp0release\OBS-Moderator-Overlay-Setup-*.exe" set "HAS_SETUP=1"
)
if "%HAS_PORTABLE%"=="0" (
  if exist "%~dp0release\OBS-Overlay-Portable-*.exe" set "HAS_PORTABLE=1"
)
if "%HAS_SETUP%"=="0" (
  dir /b "%~dp0release\*.exe"
  dir /b "%~dp0release\*.exe" >> "%LOGFILE%"
  call :failmsg NSIS Setup.exe not found after electron-builder
  goto :fail
)
if "%HAS_PORTABLE%"=="0" (
  dir /b "%~dp0release\*.exe"
  dir /b "%~dp0release\*.exe" >> "%LOGFILE%"
  call :failmsg Portable exe not found after electron-builder
  goto :fail
)
if not "%EB_RC%"=="0" (
  call :log [warn] electron-builder rc=%EB_RC% but artifacts exist, continuing
)

echo.
call :log [4/6] Verify packaged app...
set "VERIFY_FAIL="
set "VERIFY_OUT=%TEMP%\omo-verify-out.txt"
cmd /c "npm run verify:packaged" > "%VERIFY_OUT%" 2>&1
if errorlevel 1 set "VERIFY_FAIL=1"
type "%VERIFY_OUT%"
type "%VERIFY_OUT%" >> "%LOGFILE%"
if defined VERIFY_FAIL (
  call :failmsg Packaged layout verification failed
  goto :fail
)

echo.
call :log [5/6] Stage release\github\ ...
set "GH=%~dp0release\github"
if exist "%GH%" rmdir /S /Q "%GH%"
mkdir "%GH%" 2>nul

set "SETUP=%~dp0release\OBS-Moderator-Overlay-Setup-%APP_VER%.exe"
if not exist "%SETUP%" (
  call :failmsg NSIS Setup.exe not found in release\
  goto :fail
)
copy /Y "%SETUP%" "%GH%\" >nul
if errorlevel 1 (
  call :failmsg Failed to copy Setup.exe into release\github\
  goto :fail
)
call :log   Setup: %SETUP%

set "PORTABLE_EXE=%~dp0release\OBS-Overlay-Portable-%APP_VER%.exe"
if not exist "%PORTABLE_EXE%" (
  call :failmsg Portable exe not found in release\
  goto :fail
)

set "STAGE=%GH%\portable-stage"
mkdir "%STAGE%" 2>nul
copy /Y "%PORTABLE_EXE%" "%STAGE%\OBS-Moderator-Overlay-Portable.exe" >nul
if errorlevel 1 (
  call :failmsg Failed to copy portable exe into staging folder
  goto :fail
)
if exist "README.md" copy /Y "README.md" "%STAGE%\" >nul
if exist "LICENSE" copy /Y "LICENSE" "%STAGE%\" >nul
if exist ".env.example" copy /Y ".env.example" "%STAGE%\" >nul
> "%STAGE%\HOW-TO-RUN.txt" (
  echo OBS Moderator Overlay %APP_VER% - portable
  echo.
  echo 1. Double-click OBS-Moderator-Overlay-Portable.exe
  echo 2. On first launch, create a PIN and share it with your moderators.
  echo 3. In OBS: add a Browser Source 1920x1080 using the overlay URL from the app.
  echo 4. Do not copy a .env with secrets into this folder for public redistribution.
  echo.
  echo Remote mods: see README.md and docs/CONNECTOR.md
)

set "ZIP=%GH%\OBS-Moderator-Overlay-%APP_VER%-win-x64-portable.zip"
powershell -NoProfile -Command "Compress-Archive -Path '%STAGE%\*' -DestinationPath '%ZIP%' -Force"
if errorlevel 1 (
  call :failmsg zip failed
  goto :fail
)
rmdir /S /Q "%STAGE%"

echo.
call :log [6/6] Done. Artifacts:
dir /b "%GH%"
dir /b "%GH%" >> "%LOGFILE%"
echo.
call :log Folder: %GH%
del /Q "%~dp0release\logs\BUILD.lock" 2>nul
endlocal
exit /b 0

:fail
call :log ============================================================
call :log  GITHUB RELEASE FAILED
call :log ============================================================
call :log  LogFile=%LOGFILE%
del /Q "%~dp0release\logs\BUILD.lock" 2>nul
if defined LOGFILE (
  > "%LASTRESULT%" echo STATUS=FAILED
  >> "%LASTRESULT%" echo STAMP=%LOG_STAMP%
  >> "%LASTRESULT%" echo LOG=%LOGFILE%
  >> "%LASTRESULT%" echo TIME=%DATE% %TIME%
)
endlocal
exit /b 1

:failmsg
call :log [error] %*
goto :eof

:log
echo(%*
if defined LOGFILE >>"%LOGFILE%" echo(%*
goto :eof
