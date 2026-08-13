@echo off
REM ============================================================
REM  Build Full — portable + OBS plugin + sidecar + docs/relay
REM ============================================================
REM  Output:
REM    release\portable\OBS-Overlay-Portable-*.exe
REM    release\portable\omo-connector\
REM    release\omo-plugin\
REM    release\full\
REM    release\logs\full-build-*.log
REM    release\logs\LAST-RESULT.txt
REM
REM  Flags: /skip-plugin  /no-install  /plugin-full  /nopause
REM ============================================================

REM --- Outer wrapper: always keep window open on double-click ---
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
)
echo ============================================================
if exist "%~dp0release\logs\LAST-RESULT.txt" (
  echo.
  type "%~dp0release\logs\LAST-RESULT.txt"
)
echo.
echo Full log folder: %~dp0release\logs\
if "%SKIP_PAUSE%"=="0" (
  echo.
  echo Press any key to close this window...
  pause >nul
)
exit /b %RC%

:inner
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "SKIP_PLUGIN=0"
set "NO_INSTALL=0"
set "PLUGIN_FULL=0"
set "USER_NOPAUSE=0"
for %%A in (%*) do (
  if /I "%%~A"=="/skip-plugin" set "SKIP_PLUGIN=1"
  if /I "%%~A"=="/no-install" set "NO_INSTALL=1"
  if /I "%%~A"=="/plugin-full" set "PLUGIN_FULL=1"
  if /I "%%~A"=="/nopause" set "USER_NOPAUSE=1"
)

for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "BUILD_STAMP=%%I"
if not exist "%~dp0release\logs" mkdir "%~dp0release\logs"
set "LOGFILE=%~dp0release\logs\full-build-%BUILD_STAMP%.log"
set "LASTRESULT=%~dp0release\logs\LAST-RESULT.txt"
type nul > "%LOGFILE%"
> "%LASTRESULT%" echo STATUS=RUNNING
>> "%LASTRESULT%" echo STAMP=%BUILD_STAMP%
>> "%LASTRESULT%" echo LOG=%LOGFILE%
>> "%LASTRESULT%" echo TIME=%DATE% %TIME%

call :log ============================================================
call :log  OMO Full Build  stamp=%BUILD_STAMP%
call :log  LogFile=%LOGFILE%
call :log ============================================================
call :logblank

if "%OBS_DIR%"=="" if exist "obs-omo-connector\OBS_DIR.txt" (
  set /p OBS_DIR=<"obs-omo-connector\OBS_DIR.txt"
  for /f "tokens=* delims= " %%P in ("!OBS_DIR!") do set "OBS_DIR=%%P"
)
if defined OBS_DIR (
  call :log OBS_DIR=!OBS_DIR!
) else (
  call :log OBS_DIR not set - standalone plugin uses deps\obs-studio + installed OBS
)

call :logblank
call :log ========== [A] Portable application ==========
call :log Live output below - also saved to LogFile at end of step
set "BUILD_NO_PAUSE=1"
call "%~dp0build-portable.bat" /nopause
set "ERR=!ERRORLEVEL!"
if not "!ERR!"=="0" (
  call :failmsg Portable build failed. See console output and LogFile.
  goto :fail
)

set "PORTABLE_EXE="
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p=Get-ChildItem -Path (Join-Path '%~dp0' 'release\portable') -Filter 'OBS-Overlay-Portable-*.exe' -File -EA SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1; if(-not $p){ exit 2 }; Set-Content -Path $env:TEMP\omo-portable-exe.txt -Value $p.FullName -Encoding ASCII; exit 0"
if errorlevel 1 (
  call :failmsg Portable exe not found in release\portable\
  goto :fail
)
set /p PORTABLE_EXE=<"%TEMP%\omo-portable-exe.txt"
if not defined PORTABLE_EXE (
  call :failmsg Portable exe not found in release\portable\
  goto :fail
)
call :log Portable exe: !PORTABLE_EXE!

call :logblank
call :log ========== [A2] Verify packaged app (auto-manifest) ==========
set "OMO_ROOT=%~dp0"
if "!OMO_ROOT:~-1!"=="\" set "OMO_ROOT=!OMO_ROOT:~0,-1!"
REM Re-check with stamp from portable build-info (portable already verified once).
set "BUILD_STAMP="
if exist "%~dp0shared\build-info.json" (
  for /f "usebackq delims=" %%S in (`node --input-type=module -e "import fs from 'node:fs'; try { const j=JSON.parse(fs.readFileSync('shared/build-info.json','utf8')); process.stdout.write(String(j.buildStamp||'')) } catch {}"`) do set "BUILD_STAMP=%%S"
)
call node "%~dp0scripts\verify-packaged.mjs"
set "ERR=!ERRORLEVEL!"
if not "!ERR!"=="0" (
  call :failmsg Packaged layout verification failed.
  goto :fail
)

if "%SKIP_PLUGIN%"=="1" (
  call :logblank
  call :log [/skip-plugin] Skipping OBS plugin compile.
  set "PLUGIN_SRC="
  goto :bundle_docs
)

call :logblank
call :log ========== [B] OBS plugin ==========
set "PLUGIN_SRC="
if "%PLUGIN_FULL%"=="1" goto :plugin_full

if exist "%~dp0deps\obs-studio\libobs\obs.h" (
  call :log Using standalone plugin build via build-standalone.bat ...
  REM Isolate from parent DelayedExpansion - cmd /c fresh parse
  cmd /c "cd /d %~dp0obs-omo-connector && build-standalone.bat"
  set "ERR=!ERRORLEVEL!"
  if not "!ERR!"=="0" (
    call :failmsg Standalone plugin build failed.
    goto :fail
  )
  set "PLUGIN_SRC=%~dp0release\omo-plugin\omo-connector"
  if not exist "!PLUGIN_SRC!\bin\64bit\omo-connector.dll" (
    call :failmsg DLL missing after standalone build.
    goto :fail
  )
  REM Smoke: Mode-combo fix must be in this DLL (status dirty-only, no tick refresh)
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$dll=Join-Path '%~dp0' 'release\omo-plugin\omo-connector\bin\64bit\omo-connector.dll'; $src=Join-Path '%~dp0' 'obs-omo-connector\src\omo-source.cpp'; if(-not (Test-Path $dll)){ exit 1 }; if(-not (Test-Path $src)){ exit 1 }; $t=Get-Content -Raw $src; if($t -match 'omo_video_tick[\s\S]{0,800}obs_source_update_properties\(ctx->source\)'){ Write-Host '[error] omo_video_tick still calls update_properties unconditionally'; exit 1 }; Write-Host '[ok] OBS source tick no longer force-refreshes properties'; exit 0"
  set "ERR=!ERRORLEVEL!"
  if not "!ERR!"=="0" (
    call :failmsg OBS Mode-combo fix missing from source ^(rebuild required^).
    goto :fail
  )
  goto :bundle_plugin
)

call :log deps\obs-studio not found - trying OBS_DIR full build...

:plugin_full
if "%OBS_DIR%"=="" (
  call :failmsg Need deps\obs-studio for standalone OR set OBS_DIR. Or use /skip-plugin.
  goto :fail
)
if not exist "%OBS_DIR%" (
  call :failmsg OBS_DIR does not exist.
  goto :fail
)
where cmake >nul 2>&1
if errorlevel 1 (
  call :failmsg cmake not found in PATH.
  goto :fail
)

pushd "%~dp0obs-omo-connector"
if not exist build mkdir build
call :log Configuring CMake OBS_DIR full...
cmake -S . -B build -G "Visual Studio 17 2022" -A x64 -DOBS_DIR="%OBS_DIR%"
set "ERR=!ERRORLEVEL!"
if not "!ERR!"=="0" (
  popd
  call :failmsg CMake configure failed.
  goto :fail
)
call :log Building RelWithDebInfo...
cmake --build build --config RelWithDebInfo
set "ERR=!ERRORLEVEL!"
if not "!ERR!"=="0" (
  popd
  call :failmsg Plugin compile failed.
  goto :fail
)
popd
set "PLUGIN_SRC=%~dp0obs-omo-connector\build\dist\omo-connector"
if not exist "!PLUGIN_SRC!\bin\64bit\omo-connector.dll" (
  call :failmsg Staged DLL missing after full plugin build.
  goto :fail
)

:bundle_plugin
call :logblank
call :log ========== [C] Bundle plugin + sidecar ==========
set "BUNDLE=%~dp0release\portable\omo-connector"
if exist "%BUNDLE%" rmdir /S /Q "%BUNDLE%"
mkdir "%BUNDLE%\bin\64bit" 2>nul
mkdir "%BUNDLE%\data\locale" 2>nul
mkdir "%BUNDLE%\sidecar" 2>nul

copy /Y "!PLUGIN_SRC!\bin\64bit\omo-connector.dll" "%BUNDLE%\bin\64bit\" >nul
if exist "!PLUGIN_SRC!\bin\64bit\omo-connector.pdb" copy /Y "!PLUGIN_SRC!\bin\64bit\omo-connector.pdb" "%BUNDLE%\bin\64bit\" >nul
if exist "!PLUGIN_SRC!\data\locale" xcopy /Y /I /Q "!PLUGIN_SRC!\data\locale\*" "%BUNDLE%\data\locale\" >nul
if exist "%~dp0obs-omo-connector\data\locale" xcopy /Y /I /Q "%~dp0obs-omo-connector\data\locale\*" "%BUNDLE%\data\locale\" >nul

copy /Y "!PORTABLE_EXE!" "%BUNDLE%\sidecar\" >nul
call :log Sidecar copied into omo-connector\sidecar\

> "%BUNDLE%\install-to-program-files.bat" (
  echo @echo off
  echo setlocal EnableExtensions
  echo REM Run as Administrator. Close OBS first.
  echo set "SRC=%%~dp0"
  echo set "OBS=C:\Program Files\obs-studio"
  echo if not exist "%%OBS%%\obs-plugins\64bit" ^(
  echo   echo OBS not found at %%OBS%%
  echo   exit /b 1
  echo ^)
  echo copy /Y "%%SRC%%bin\64bit\omo-connector.dll" "%%OBS%%\obs-plugins\64bit\" ^|^| exit /b 1
  echo mkdir "%%OBS%%\data\obs-plugins\omo-connector\locale" 2^>nul
  echo xcopy /Y /I /Q "%%SRC%%data\locale\*" "%%OBS%%\data\obs-plugins\omo-connector\locale\"
  echo echo Installed. Restart OBS. Add source: OMO Overlay Mode Native or Browser.
  echo pause
)

> "%BUNDLE%\INSTALL.txt" (
  echo OMO Connector plugin bundle
  echo ===========================
  echo.
  echo AppData: copy this folder to %%AppData%%\obs-studio\plugins\omo-connector\
  echo Program Files: run install-to-program-files.bat as Administrator
  echo Restart OBS. Add source: OMO Overlay - Mode Native or Browser.
  echo.
  echo Host: portable exe. Remote: exe --mode=remote. Host-obs: --mode=host-obs
  echo Relay: see release\full\relay\ and docs\CONNECTOR.md
)

if not exist "%~dp0release\omo-plugin\omo-connector\bin\64bit\omo-connector.dll" (
  mkdir "%~dp0release\omo-plugin\omo-connector\bin\64bit" 2>nul
  mkdir "%~dp0release\omo-plugin\omo-connector\data\locale" 2>nul
  copy /Y "%BUNDLE%\bin\64bit\omo-connector.dll" "%~dp0release\omo-plugin\omo-connector\bin\64bit\" >nul
  xcopy /Y /I /Q "%BUNDLE%\data\locale\*" "%~dp0release\omo-plugin\omo-connector\data\locale\" >nul
)

:bundle_docs
call :logblank
call :log ========== [D] release\full package ==========
set "FULL=%~dp0release\full"
if exist "%FULL%" rmdir /S /Q "%FULL%"
mkdir "%FULL%" 2>nul
mkdir "%FULL%\docs" 2>nul
mkdir "%FULL%\relay" 2>nul
mkdir "%FULL%\config" 2>nul

copy /Y "!PORTABLE_EXE!" "%FULL%\" >nul
if exist "%~dp0release\portable\.env.example" copy /Y "%~dp0release\portable\.env.example" "%FULL%\" >nul
if exist "%~dp0.env.example" copy /Y "%~dp0.env.example" "%FULL%\.env.example" >nul
REM Never ship a real .env into release\full
if exist "%~dp0release\portable\build-info.json" copy /Y "%~dp0release\portable\build-info.json" "%FULL%\" >nul

if exist "%~dp0release\portable\omo-connector\bin\64bit\omo-connector.dll" (
  xcopy /Y /E /I /Q "%~dp0release\portable\omo-connector" "%FULL%\omo-connector\" >nul
)

if exist "%~dp0relay\server.js" (
  copy /Y "%~dp0relay\server.js" "%FULL%\relay\" >nul
  copy /Y "%~dp0relay\package.json" "%FULL%\relay\" >nul
  if exist "%~dp0relay\package-lock.json" copy /Y "%~dp0relay\package-lock.json" "%FULL%\relay\" >nul
  if exist "%~dp0relay\README.md" copy /Y "%~dp0relay\README.md" "%FULL%\relay\" >nul
  if exist "%~dp0relay\docker-compose.yml" copy /Y "%~dp0relay\docker-compose.yml" "%FULL%\relay\" >nul
  if exist "%~dp0relay\Caddyfile" copy /Y "%~dp0relay\Caddyfile" "%FULL%\relay\" >nul
  if exist "%~dp0relay\e2e-pair.mjs" copy /Y "%~dp0relay\e2e-pair.mjs" "%FULL%\relay\" >nul
)

if exist "%~dp0docs\BUILD.md" copy /Y "%~dp0docs\BUILD.md" "%FULL%\docs\" >nul
if exist "%~dp0docs\CONNECTOR.md" copy /Y "%~dp0docs\CONNECTOR.md" "%FULL%\docs\" >nul
if exist "%~dp0docs\THREAT-MODEL.md" copy /Y "%~dp0docs\THREAT-MODEL.md" "%FULL%\docs\" >nul
if exist "%~dp0docs\CREDENTIALS.md" copy /Y "%~dp0docs\CREDENTIALS.md" "%FULL%\docs\" >nul
if exist "%~dp0docs\HORIZON.md" copy /Y "%~dp0docs\HORIZON.md" "%FULL%\docs\" >nul
if exist "%~dp0LICENSE" copy /Y "%~dp0LICENSE" "%FULL%\" >nul
if exist "%~dp0server\connector\connector.example.json" copy /Y "%~dp0server\connector\connector.example.json" "%FULL%\config\" >nul

> "%FULL%\env.example" (
  echo PORT=8090
  echo OMO_RELAY_URLS=wss://relay.yourdomain/connector
  echo OMO_PREFERRED_PROFILE=relay
  echo OMO_CONNECTOR_AUTO=1
  echo OMO_BIND_LOOPBACK=1
  echo OMO_HARDEN=1
  echo OMO_FRAME_BRIDGE=1
)

> "%FULL%\README.txt" (
  echo OBS Moderator Overlay - full package
  echo ====================================
  echo Build stamp: %BUILD_STAMP%
  echo.
  echo Contents: portable exe, omo-connector, relay, docs, env.example, LICENSE
  echo Streamer: deploy relay, set OMO_RELAY_URLS, run exe, install plugin, add OMO Overlay
  echo Moderator: exe --mode=remote then join code and PIN
)

call :log Packed release\full\

if "%SKIP_PLUGIN%"=="1" goto :summary
if "%NO_INSTALL%"=="1" (
  call :log [/no-install] Skipping AppData plugin install.
  goto :summary
)
if not defined PLUGIN_SRC goto :summary
if not exist "!PLUGIN_SRC!\bin\64bit\omo-connector.dll" goto :summary

call :logblank
call :log ========== [E] Install plugin to AppData ==========
set "SIDECAR_EXE=!PORTABLE_EXE!"
if /I not "!PLUGIN_SRC!"=="%~dp0obs-omo-connector\build\dist\omo-connector" (
  mkdir "%~dp0obs-omo-connector\build\dist\omo-connector\bin\64bit" 2>nul
  mkdir "%~dp0obs-omo-connector\build\dist\omo-connector\data\locale" 2>nul
  copy /Y "!PLUGIN_SRC!\bin\64bit\omo-connector.dll" "%~dp0obs-omo-connector\build\dist\omo-connector\bin\64bit\" >nul
  if exist "!PLUGIN_SRC!\data\locale" xcopy /Y /I /Q "!PLUGIN_SRC!\data\locale\*" "%~dp0obs-omo-connector\build\dist\omo-connector\data\locale\" >nul
  if exist "%~dp0obs-omo-connector\data\locale" xcopy /Y /I /Q "%~dp0obs-omo-connector\data\locale\*" "%~dp0obs-omo-connector\build\dist\omo-connector\data\locale\" >nul
)
call "%~dp0obs-omo-connector\install-plugin.bat"
set "ERR=!ERRORLEVEL!"
if not "!ERR!"=="0" (
  call :log [warn] AppData install reported an error - bundle still in release\portable\omo-connector\
)

:summary
call :logblank
call :log ============================================================
call :log  FULL BUILD DONE
call :log ============================================================
call :log  LogFile=%LOGFILE%
call :log  App=%CD%\release\portable\
dir /b "%~dp0release\portable\*.exe" 2>nul
dir /b "%~dp0release\portable\*.exe" >> "%LOGFILE%" 2>nul
if exist "%~dp0release\portable\omo-connector\bin\64bit\omo-connector.dll" (
  call :log  Plugin=%CD%\release\portable\omo-connector\
)
if exist "%~dp0release\omo-plugin" (
  call :log  Plugin2=%CD%\release\omo-plugin\
)
if exist "%~dp0release\full" (
  call :log  Bundle=%CD%\release\full\   zip this folder to share
)
call :logblank
call :log  Modes: host=double-click  remote=--mode=remote  host-obs=--mode=host-obs
call :log ============================================================

> "%LASTRESULT%" echo STATUS=SUCCESS
>> "%LASTRESULT%" echo STAMP=%BUILD_STAMP%
>> "%LASTRESULT%" echo LOG=%LOGFILE%
>> "%LASTRESULT%" echo EXE=!PORTABLE_EXE!
>> "%LASTRESULT%" echo TIME=%DATE% %TIME%
call :log Wrote %LASTRESULT%
endlocal
exit /b 0

:fail
call :logblank
call :log ============================================================
call :log  FULL BUILD FAILED
call :log ============================================================
call :log  LogFile=%LOGFILE%
> "%LASTRESULT%" echo STATUS=FAILED
>> "%LASTRESULT%" echo STAMP=%BUILD_STAMP%
>> "%LASTRESULT%" echo LOG=%LOGFILE%
>> "%LASTRESULT%" echo TIME=%DATE% %TIME%
endlocal
exit /b 1

:failmsg
call :log [error] %*
goto :eof

:logblank
echo.
echo.>>"%LOGFILE%"
goto :eof

:log
echo %*
>>"%LOGFILE%" echo %*
goto :eof
