@echo off
REM ============================================================
REM  Build Portable — всегда свежий dist + server + Electron
REM ============================================================
REM  Результат: release\portable\OBS-Overlay-Portable-*.exe + .env
REM  Требования: Node.js + npm в PATH (проверено ниже).
REM  Шаг [0/5] сам освобождает 8090/5173/5174 (npm run free-ports).
REM  После сборки запускай exe из release\portable\ (не держи npm run dev).
REM ============================================================
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [error] Node.js not found in PATH. Install Node LTS, then re-run.
  pause
  exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
  echo [error] npm not found in PATH. Install Node LTS ^(includes npm^), then re-run.
  pause
  exit /b 1
)
for /f "delims=" %%V in ('node -v') do echo Node %%V
for /f "delims=" %%V in ('npm -v') do echo npm %%V

REM Timestamp for artifact / build-info (YYYYMMDD-HHMM)
for /f %%I in ('powershell -NoProfile -Command "(Get-Date).ToString(\"yyyyMMdd-HHmm\")"') do set "BUILD_STAMP=%%I"
if not defined BUILD_STAMP (
  echo [error] Could not compute BUILD_STAMP
  pause
  exit /b 1
)
echo Build stamp: %BUILD_STAMP%

echo.
echo [0/5] Freeing ports 8090 / 5173 / 5174 so packaging and later portable test are not blocked...
call npm run free-ports
if errorlevel 1 (
  echo [warn] free-ports reported an error - continuing anyway.
)
powershell -NoProfile -Command ^
  "$c=Get-NetTCPConnection -LocalPort 8090 -State Listen -ErrorAction SilentlyContinue; if($c){ Write-Host '[warn] Port 8090 STILL in use after free-ports — close Electron / node manually if the new portable fails to start.'; $c | Select-Object -First 3 OwningProcess,State | Format-Table | Out-String | Write-Host } else { Write-Host 'Port 8090 is free.' }"

echo.
echo [1/5] npm install...
call npm install
if errorlevel 1 (
  echo [error] npm install failed!
  pause
  exit /b 1
)

echo.
echo [2/5] Clean + icons + build-info + Vite build...
if exist "dist" rmdir /S /Q "dist"
if exist "release\portable" rmdir /S /Q "release\portable"
if exist "release\win-unpacked" rmdir /S /Q "release\win-unpacked"
del /Q "release\OBS-Overlay-Portable-*.exe" 2>nul
del /Q "release\builder-*.yml" 2>nul
del /Q "release\builder-*.yaml" 2>nul

REM Empty seed dirs for extraResources — never ship local data/ or uploads/
REM Use .omo-seed (not .gitkeep): electron-builder default ignores .gitkeep and
REM then skips empty folders, so resources/data + uploads never appear.
if not exist "build\portable-seed\data" mkdir "build\portable-seed\data"
if not exist "build\portable-seed\uploads" mkdir "build\portable-seed\uploads"
if not exist "build\portable-seed\data\.omo-seed" (
  > "build\portable-seed\data\.omo-seed" echo portable seed
)
if not exist "build\portable-seed\uploads\.omo-seed" (
  > "build\portable-seed\uploads\.omo-seed" echo portable seed
)

REM Icons required for tray/window + electron-builder win.icon
if not exist "build\icon.ico" (
  if exist "build\gen-icon.cjs" (
    echo Generating missing build\icon.ico via build\gen-icon.cjs...
    call node "build\gen-icon.cjs"
  )
)
if not exist "build\icon.ico" (
  echo [error] build\icon.ico missing — cannot package portable.
  pause
  exit /b 1
)
if not exist "build\icon.png" (
  echo [error] build\icon.png missing — cannot package portable.
  pause
  exit /b 1
)

if not exist "shared" mkdir "shared"
> "shared\build-info.json" (
  echo {"buildStamp":"%BUILD_STAMP%","builtAt":"%DATE% %TIME%","channel":"portable"}
)
echo Wrote shared\build-info.json

call npm run build
if errorlevel 1 (
  echo [error] Vite build failed!
  pause
  exit /b 1
)

if not exist "dist\index.html" (
  echo [error] dist\index.html missing after build!
  pause
  exit /b 1
)
for %%A in ("dist\index.html") do echo dist\index.html size=%%~zA time=%%~tA

echo.
echo [3/5] electron-builder portable - no cache reuse...
set "CSC_IDENTITY_AUTO_DISCOVERY=false"
call npx electron-builder --win portable --config.portable.artifactName=OBS-Overlay-Portable-${version}-%BUILD_STAMP%.exe
if errorlevel 1 (
  echo [error] Packaging failed!
  if /I not "%~1"=="/nopause" if /I not "%BUILD_NO_PAUSE%"=="1" pause
  exit /b 1
)

echo.
echo [4/5] Stage release\portable\ - copy exe, env, build-info...
if not exist "release\portable" mkdir "release\portable"

REM Locate and copy portable exe via PowerShell - avoid fragile cmd FOR glob
set "FOUND_EXE="
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop'; $stamp=$env:BUILD_STAMP; $dir=Join-Path (Get-Location) 'release'; $dest=Join-Path (Get-Location) 'release\portable'; New-Item -ItemType Directory -Force -Path $dest | Out-Null; $exact=@(Get-ChildItem -Path $dir -Filter ('OBS-Overlay-Portable-*-' + $stamp + '.exe') -File -EA SilentlyContinue | Sort-Object LastWriteTime -Descending); if(-not $exact.Count){ $exact=@(Get-ChildItem -Path $dir -Filter 'OBS-Overlay-Portable-*.exe' -File -EA SilentlyContinue | Sort-Object LastWriteTime -Descending) }; if(-not $exact.Count){ exit 2 }; $src=$exact[0].FullName; Copy-Item -Force $src $dest; Set-Content -Path $env:TEMP\omo-stage-exe.txt -Value $src -Encoding ASCII; exit 0"
if errorlevel 1 (
  echo [error] No OBS-Overlay-Portable-*.exe found under release\
  if /I not "%~1"=="/nopause" if /I not "%BUILD_NO_PAUSE%"=="1" pause
  exit /b 1
)
set /p FOUND_EXE=<"%TEMP%\omo-stage-exe.txt"
if not defined FOUND_EXE (
  echo [error] Staging script produced no path
  if /I not "%~1"=="/nopause" if /I not "%BUILD_NO_PAUSE%"=="1" pause
  exit /b 1
)
echo   Staged: !FOUND_EXE!

if exist "shared\build-info.json" copy /Y "shared\build-info.json" "release\portable\build-info.json" >nul
if exist "docs\CREDENTIALS.md" copy /Y "docs\CREDENTIALS.md" "release\portable\" >nul
if exist ".env.example" copy /Y ".env.example" "release\portable\.env.example" >nul
REM Never copy a real .env into release artifacts (secrets).

echo.
echo [5/5] Verify packaged app (auto-manifest: server/electron/shared + dist)...
set "OMO_ROOT=%CD%"
call node "scripts\verify-packaged.mjs"
if errorlevel 1 (
  echo [error] Packaged layout incomplete!
  if /I not "%~1"=="/nopause" if /I not "%BUILD_NO_PAUSE%"=="1" pause
  exit /b 1
)

echo.
echo ============================================================
echo  DONE. Run ONLY from:
echo    %CD%\release\portable\
echo  Close any old OBS Overlay / npm run dev first - free port 8090.
echo  Build stamp: %BUILD_STAMP%
echo ============================================================
dir /b "release\portable\*.exe" 2>nul
echo.
if /I not "%~1"=="/nopause" if /I not "%BUILD_NO_PAUSE%"=="1" pause
endlocal
exit /b 0
