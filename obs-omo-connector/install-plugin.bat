@echo off
setlocal EnableExtensions EnableDelayedExpansion
REM Install staged omo-connector.dll into OBS Program Files (where this OBS loads plugins).
REM Layout:  obs-plugins\64bit\omo-connector.dll
REM          data\obs-plugins\omo-connector\locale\*.ini
REM Run as Administrator. Close OBS first.

set "DO_PAUSE=1"
if /i "%~1"=="/nopause" set "DO_PAUSE=0"

cd /d "%~dp0"

net session >nul 2>&1
if errorlevel 1 (
  echo Need Administrator to write to Program Files. Requesting elevation...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b 0
)

set "OBS=%ProgramFiles%\obs-studio"
if defined OBS_STUDIO_DIR set "OBS=%OBS_STUDIO_DIR%"

if not exist "%OBS%\obs-plugins\64bit" (
  echo OBS not found: "%OBS%\obs-plugins\64bit"
  echo Set OBS_STUDIO_DIR to your OBS install if it is not in Program Files.
  if "!DO_PAUSE!"=="1" pause
  exit /b 1
)

set "DLL="
if exist "%~dp0build\dist\omo-connector\bin\64bit\omo-connector.dll" (
  set "DLL=%~dp0build\dist\omo-connector\bin\64bit\omo-connector.dll"
  set "LOC=%~dp0build\dist\omo-connector\data\locale"
)
if not defined DLL if exist "%~dp0build-standalone\dist\omo-connector\bin\64bit\omo-connector.dll" (
  set "DLL=%~dp0build-standalone\dist\omo-connector\bin\64bit\omo-connector.dll"
  set "LOC=%~dp0build-standalone\dist\omo-connector\data\locale"
)
if not defined DLL if exist "%~dp0..\release\omo-plugin\omo-connector\bin\64bit\omo-connector.dll" (
  set "DLL=%~dp0..\release\omo-plugin\omo-connector\bin\64bit\omo-connector.dll"
  set "LOC=%~dp0..\release\omo-plugin\omo-connector\data\locale"
)
if not defined DLL (
  echo Staged DLL not found. Build first with build-plugin.bat
  if "!DO_PAUSE!"=="1" pause
  exit /b 1
)

set "DST_DLL=%OBS%\obs-plugins\64bit"
set "DST_LOC=%OBS%\data\obs-plugins\omo-connector\locale"

echo Installing:
echo   DLL  "%DLL%"
echo     -^> "%DST_DLL%\omo-connector.dll"
echo   locale -^> "%DST_LOC%"
echo Close OBS Studio before this copy if it is running.
echo.

copy /Y "%DLL%" "%DST_DLL%\omo-connector.dll"
if errorlevel 1 (
  echo RESULT: FAILED  could not copy DLL ^(OBS running, or access denied^)
  if "!DO_PAUSE!"=="1" pause
  exit /b 1
)
if exist "%~dp0build\dist\omo-connector\bin\64bit\omo-connector.pdb" copy /Y "%~dp0build\dist\omo-connector\bin\64bit\omo-connector.pdb" "%DST_DLL\" >nul
if exist "%~dp0build-standalone\dist\omo-connector\bin\64bit\omo-connector.pdb" copy /Y "%~dp0build-standalone\dist\omo-connector\bin\64bit\omo-connector.pdb" "%DST_DLL\" >nul

mkdir "%DST_LOC%" 2>nul
if exist "%LOC%\en-US.ini" (
  xcopy /Y /I /Q "%LOC%\*" "%DST_LOC%\" >nul
) else if exist "%~dp0data\locale\en-US.ini" (
  xcopy /Y /I /Q "%~dp0data\locale\*" "%DST_LOC%\" >nul
)

echo.
echo RESULT: SUCCESS
echo Restart OBS Studio.
echo Add source: OMO Overlay ^(Mode Native / Browser local / Browser remote^)
if "!DO_PAUSE!"=="1" pause
exit /b 0
