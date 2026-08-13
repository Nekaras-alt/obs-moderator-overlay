@echo off
REM Build omo-connector.dll against installed OBS 32.x - no Qt dock.
REM DisableDelayedExpansion required: parent build-full.bat enables it via CALL,
REM which breaks %ProgramFiles(x86)% and other paren expansions.
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
set "ROOT=%~dp0.."
set "PATH=C:\Program Files\CMake\bin;%PATH%"

REM Prefer VS Community if present, else latest with MSVC
set "PF86=%ProgramFiles(x86)%"
if not defined PF86 set "PF86=C:\Program Files (x86)"
set "VSWHERE=%PF86%\Microsoft Visual Studio\Installer\vswhere.exe"
set "VS="
for /f "usebackq delims=" %%I in (`"%VSWHERE%" -products Microsoft.VisualStudio.Product.Community -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VS=%%I"
if not defined VS (
  for /f "usebackq delims=" %%I in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VS=%%I"
)
if not defined VS (
  echo [error] Visual Studio C++ tools not found
  exit /b 1
)
echo Using VS: %VS%
call "%VS%\VC\Auxiliary\Build\vcvars64.bat"
if errorlevel 1 (
  echo [error] vcvars64 failed
  exit /b 1
)

where cl
where cmake

if not exist "%ROOT%\deps\obs-studio\libobs\obs.h" (
  echo [error] Missing deps\obs-studio headers
  exit /b 1
)

echo [1/4] Import libs from Program Files OBS...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\deps\gen-obs-lib.ps1"
if errorlevel 1 exit /b 1

copy /Y "%ROOT%\deps\obs-import-lib\obsconfig.h" "%ROOT%\deps\obs-studio\libobs\obsconfig.h" >nul

echo [2/4] CMake configure Ninja + cl from vcvars...
if exist CMakeLists.txt if not exist CMakeLists.full.bak copy /Y CMakeLists.txt CMakeLists.full.bak >nul
copy /Y CMakeLists.standalone.txt CMakeLists.txt >nul

if exist build-standalone rmdir /S /Q build-standalone
mkdir build-standalone

REM Ensure ninja exists
where ninja >nul 2>&1
if errorlevel 1 (
  echo Downloading ninja...
  powershell -NoProfile -Command "Invoke-WebRequest -Uri https://github.com/ninja-build/ninja/releases/download/v1.12.1/ninja-win.zip -OutFile '%TEMP%\ninja-win.zip'; Expand-Archive -Force '%TEMP%\ninja-win.zip' '%ROOT%\deps\ninja'; "
  set "PATH=%ROOT%\deps\ninja;%PATH%"
)

cmake -S . -B build-standalone -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo -DCMAKE_CXX_COMPILER=cl -DCMAKE_C_COMPILER=cl
if errorlevel 1 (
  if exist CMakeLists.full.bak copy /Y CMakeLists.full.bak CMakeLists.txt >nul
  echo [error] CMake configure failed
  exit /b 1
)

echo [3/4] Compile...
cmake --build build-standalone --config RelWithDebInfo
set "ERR=%ERRORLEVEL%"
if exist CMakeLists.full.bak copy /Y CMakeLists.full.bak CMakeLists.txt >nul
if not "%ERR%"=="0" (
  echo [error] Compile failed
  exit /b 1
)

echo [4/4] Package DLL...
set "OUT=%ROOT%\release\omo-plugin\omo-connector"
set "PF=%ROOT%\release\omo-plugin\FOR-PROGRAM-FILES"
mkdir "%OUT%\bin\64bit" 2>nul
mkdir "%OUT%\data\locale" 2>nul
mkdir "%PF%\obs-plugins\64bit" 2>nul
mkdir "%PF%\data\obs-plugins\omo-connector\locale" 2>nul
copy /Y "build-standalone\dist\omo-connector\bin\64bit\omo-connector.dll" "%OUT%\bin\64bit\" >nul
if exist "build-standalone\RelWithDebInfo\omo-connector.dll" copy /Y "build-standalone\RelWithDebInfo\omo-connector.dll" "%OUT%\bin\64bit\" >nul
if exist "build-standalone\omo-connector.dll" copy /Y "build-standalone\omo-connector.dll" "%OUT%\bin\64bit\" >nul
if exist "build-standalone\dist\omo-connector\bin\64bit\omo-connector.pdb" copy /Y "build-standalone\dist\omo-connector\bin\64bit\omo-connector.pdb" "%OUT%\bin\64bit\" >nul
xcopy /Y /I /Q "data\locale\*" "%OUT%\data\locale\" >nul
copy /Y "%OUT%\bin\64bit\omo-connector.dll" "%PF%\obs-plugins\64bit\" >nul
xcopy /Y /I /Q "data\locale\*" "%PF%\data\obs-plugins\omo-connector\locale\" >nul

if not exist "%OUT%\bin\64bit\omo-connector.dll" (
  echo [error] DLL not found after build - searching...
  dir /s /b "build-standalone\*.dll"
  exit /b 1
)

> "%ROOT%\release\omo-plugin\HOW-TO-INSTALL.txt" (
  echo OMO Connector plugin - built for OBS 32.x - v0.4.0
  echo ==================================================
  echo.
  echo RECOMMENDED:
  echo   Copy folder "omo-connector" into %%AppData%%\obs-studio\plugins\
  echo   Restart OBS. Add "OMO Overlay" source Mode Native or Browser.
  echo.
  echo Program Files admin:
  echo   Close OBS, then run install-to-program-files.bat
  echo   DLL -^> C:\Program Files\obs-studio\obs-plugins\64bit\
  echo   locale -^> C:\Program Files\obs-studio\data\obs-plugins\omo-connector\locale\
  echo.
  echo Note: no dock UI in this build - Qt MSVC not installed.
)

echo.
echo OK: %OUT%\bin\64bit\omo-connector.dll
dir "%OUT%\bin\64bit\omo-connector.dll"
echo See: %ROOT%\release\omo-plugin\HOW-TO-INSTALL.txt
exit /b 0
