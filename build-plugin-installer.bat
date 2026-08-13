@echo off
REM ============================================================
REM  Standalone OBS OMO Connector plugin Setup.exe
REM ============================================================
REM  Output:
REM    release\github\OBS-OMO-Connector-Plugin-Setup-<version>.exe
REM  Uses staged DLL from release\omo-plugin\ (build-standalone.bat)
REM  or rebuilds it when missing. Needs NSIS from electron-builder cache
REM  or makensis on PATH. Flags: /nopause /nobuild
REM ============================================================

setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"

set "SKIP_PAUSE=0"
set "SKIP_BUILD=0"
echo %*| findstr /I /C:"/nopause" >nul && set "SKIP_PAUSE=1"
echo %*| findstr /I /C:"/nobuild" >nul && set "SKIP_BUILD=1"

for /f "delims=" %%V in ('node -p "require(\"./package.json\").version" 2^>nul') do set "APP_VER=%%V"
if not defined APP_VER set "APP_VER=1.0.0"

set "DLL=%~dp0release\omo-plugin\omo-connector\bin\64bit\omo-connector.dll"
set "LOC_SRC=%~dp0obs-omo-connector\data\locale"
set "STAGE=%~dp0release\omo-plugin\omo-connector"
set "OUT_DIR=%~dp0release\github"
set "OUT_EXE=%OUT_DIR%\OBS-OMO-Connector-Plugin-Setup-%APP_VER%.exe"

echo ============================================================
echo  OMO Connector plugin installer  v%APP_VER%
echo ============================================================

if "%SKIP_BUILD%"=="1" goto :have_dll
if exist "%DLL%" goto :have_dll

echo [1/3] Building omo-connector.dll ...
cmd /c "cd /d "%~dp0obs-omo-connector" && build-standalone.bat"
if errorlevel 1 (
  echo [error] Plugin build failed
  goto :fail
)

:have_dll
if not exist "%DLL%" (
  echo [error] Missing DLL: %DLL%
  echo Run obs-omo-connector\build-standalone.bat first.
  goto :fail
)

echo [2/3] Staging locale...
mkdir "%STAGE%\bin\64bit" 2>nul
mkdir "%STAGE%\data\locale" 2>nul
if exist "%LOC_SRC%\en-US.ini" xcopy /Y /I /Q "%LOC_SRC%\*" "%STAGE%\data\locale\" >nul
if not exist "%STAGE%\data\locale\en-US.ini" (
  echo [error] Locale files missing in obs-omo-connector\data\locale
  goto :fail
)

> "%~dp0release\omo-plugin\HOW-TO-INSTALL.txt" (
  echo OMO Connector plugin for OBS Studio - v%APP_VER%
  echo ==================================================
  echo.
  echo RECOMMENDED: run OBS-OMO-Connector-Plugin-Setup-%APP_VER%.exe as Administrator
  echo   DLL  -^> C:\Program Files\obs-studio\obs-plugins\64bit\
  echo   locale -^> C:\Program Files\obs-studio\data\obs-plugins\omo-connector\locale\
  echo   Close OBS before install.
  echo.
  echo MANUAL ^(admin^):
  echo   Copy omo-connector.dll into Program Files\obs-studio\obs-plugins\64bit\
  echo   Copy locale\*.ini into Program Files\obs-studio\data\obs-plugins\omo-connector\locale\
  echo   Restart OBS. Add source: OMO Overlay.
  echo.
  echo Modes: Native / Browser ^(local^) / Browser ^(remote^)
)

set "MAKENSIS="
where makensis >nul 2>&1
if not errorlevel 1 (
  for /f "delims=" %%M in ('where makensis') do (
    set "MAKENSIS=%%M"
    goto :nsis_found
  )
)

REM Prefer electron-builder cached NSIS root makensis.exe (not Bin\).
for /f "delims=" %%M in ('powershell -NoProfile -Command "$roots=@($env:LOCALAPPDATA+'\electron-builder\Cache'); Get-ChildItem -Path $roots -Filter makensis.exe -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '\\Bin\\' } | Select-Object -First 1 -ExpandProperty FullName"') do set "MAKENSIS=%%M"
if defined MAKENSIS goto :nsis_found

for /f "delims=" %%M in ('powershell -NoProfile -Command "Get-ChildItem -Path ($env:LOCALAPPDATA+'\electron-builder\Cache') -Filter makensis.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName"') do set "MAKENSIS=%%M"
if defined MAKENSIS goto :nsis_found

echo [error] makensis.exe not found. Install NSIS or run npm / electron-builder once to cache it.
goto :fail

:nsis_found
echo Using NSIS: %MAKENSIS%
mkdir "%OUT_DIR%" 2>nul

echo [3/3] Compiling Setup.exe ...
REM Ensure UTF-8 BOM so Russian LangString MessageBoxes are not mojibake.
powershell -NoProfile -Command "$p='%~dp0build\omo-plugin-installer.nsi'; $t=[IO.File]::ReadAllText($p); $enc=New-Object Text.UTF8Encoding $true; [IO.File]::WriteAllText($p,$t,$enc)"
REM NSIS wants forward slashes in /D path defines.
set "STAGE_NSIS=%STAGE:\=/%"
set "OUT_NSIS=%OUT_EXE:\=/%"
"%MAKENSIS%" /V2 "/DOMO_PLUGIN_VERSION=%APP_VER%" "/DOMO_PLUGIN_SRC=%STAGE_NSIS%" "/DOMO_PLUGIN_OUT=%OUT_NSIS%" "%~dp0build\omo-plugin-installer.nsi"
if errorlevel 1 (
  echo [error] NSIS compile failed
  goto :fail
)

if not exist "%OUT_EXE%" (
  echo [error] Output missing: %OUT_EXE%
  goto :fail
)

echo.
echo RESULT: SUCCESS
echo   %OUT_EXE%
for %%A in ("%OUT_EXE%") do echo   Size: %%~zA bytes
echo.
if "%SKIP_PAUSE%"=="0" pause
exit /b 0

:fail
echo.
echo RESULT: FAILED
echo.
if "%SKIP_PAUSE%"=="0" pause
exit /b 1
