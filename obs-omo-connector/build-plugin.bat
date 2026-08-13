@echo off
setlocal EnableExtensions EnableDelayedExpansion
REM Build omo-connector OBS plugin (Windows x64).
REM Full Qt dock: set OBS_DIR to OBS Studio build tree (headers + libobs).
REM If OBS_DIR is unset and deps\obs-studio exists, falls back to build-standalone.bat.

set "DO_PAUSE=1"
if /i "%~1"=="/nopause" set "DO_PAUSE=0"

cd /d "%~dp0"

if "%OBS_DIR%"=="" (
  if exist "%~dp0..\deps\obs-studio\libobs\obs.h" (
    echo OBS_DIR not set. Using standalone build ^(deps\obs-studio + installed OBS, no Qt dock^).
    echo For a Qt dock build: set OBS_DIR=C:\path\to\obs-studio\build
    echo.
    call "%~dp0build-standalone.bat"
    set "ERR=!ERRORLEVEL!"
    if not "!ERR!"=="0" (
      echo.
      echo RESULT: FAILED  standalone plugin build  errorlevel=!ERR!
      if "!DO_PAUSE!"=="1" pause
      exit /b !ERR!
    )
    if exist "build-standalone\dist\omo-connector\bin\64bit\omo-connector.dll" (
      mkdir "build\dist\omo-connector\bin\64bit" 2>nul
      mkdir "build\dist\omo-connector\data\locale" 2>nul
      copy /Y "build-standalone\dist\omo-connector\bin\64bit\omo-connector.dll" "build\dist\omo-connector\bin\64bit\" >nul
      xcopy /Y /I /Q "data\locale\*" "build\dist\omo-connector\data\locale\" >nul
    )
    echo.
    echo RESULT: SUCCESS
    echo Staged: %cd%\build\dist\omo-connector\
    echo Also:   %~dp0..\release\omo-plugin\omo-connector\
    echo Run install-plugin.bat as Administrator to copy into Program Files\obs-studio\obs-plugins\64bit\
    if "!DO_PAUSE!"=="1" pause
    exit /b 0
  )
  echo Set OBS_DIR to your OBS Studio build/source root ^(headers + libobs^).
  echo Example: set OBS_DIR=C:\src\obs-studio\build
  echo Or clone OBS headers into deps\obs-studio and re-run ^(standalone path^).
  echo.
  echo RESULT: FAILED  OBS_DIR is not set and deps\obs-studio is missing.
  if "!DO_PAUSE!"=="1" pause
  exit /b 1
)

if not exist build mkdir build
cmake -S . -B build -G "Visual Studio 17 2022" -A x64 -DOBS_DIR="%OBS_DIR%"
if errorlevel 1 (
  echo RESULT: FAILED  cmake configure
  if "%DO_PAUSE%"=="1" pause
  exit /b 1
)

cmake --build build --config RelWithDebInfo
if errorlevel 1 (
  echo RESULT: FAILED  cmake build
  if "%DO_PAUSE%"=="1" pause
  exit /b 1
)

set "H_DLL=0"
if exist "%cd%\build\dist\omo-connector\bin\64bit\omo-connector.dll" set "H_DLL=1"

echo.
if "%H_DLL%"=="1" (
  echo RESULT: SUCCESS
) else (
  echo RESULT: FAILED  DLL not staged
)
echo Staged package:
echo   %cd%\build\dist\omo-connector\
echo Run install-plugin.bat as Administrator to copy into Program Files\obs-studio\obs-plugins\64bit\
if "%DO_PAUSE%"=="1" pause
if "%H_DLL%"=="1" exit /b 0
exit /b 1
