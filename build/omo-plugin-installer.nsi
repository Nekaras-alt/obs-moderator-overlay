; Standalone OBS OMO Connector plugin installer.
; Installs into Program Files\obs-studio (requires Administrator).
; Layout matches OBS load path:
;   obs-plugins\64bit\omo-connector.dll
;   data\obs-plugins\omo-connector\locale\*.ini
; Build: build-plugin-installer.bat
; Encoding: UTF-8 with BOM (required for Russian LangString in NSIS Unicode).

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"

!ifndef OMO_PLUGIN_VERSION
  !define OMO_PLUGIN_VERSION "1.0.0"
!endif
!ifndef OMO_PLUGIN_SRC
  !define OMO_PLUGIN_SRC "..\release\omo-plugin\omo-connector"
!endif
!ifndef OMO_PLUGIN_OUT
  !define OMO_PLUGIN_OUT "..\release\github\OBS-OMO-Connector-Plugin-Setup-${OMO_PLUGIN_VERSION}.exe"
!endif

Name "OBS OMO Connector Plugin ${OMO_PLUGIN_VERSION}"
OutFile "${OMO_PLUGIN_OUT}"
Unicode true
RequestExecutionLevel admin
InstallDir "$PROGRAMFILES64\obs-studio"
InstallDirRegKey HKLM "Software\OBSModeratorOverlay\OmoPlugin" "ObsDir"
SetCompressor /SOLID lzma

!define MUI_ABORTWARNING
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"

!define MUI_WELCOMEPAGE_TITLE "OMO Connector for OBS Studio"
!define MUI_WELCOMEPAGE_TEXT "This installs the OMO Overlay plugin into OBS Studio (Program Files).$\r$\n$\r$\nAdministrator rights are required.$\r$\nClose OBS Studio before continuing.$\r$\n$\r$\nClick Next to continue."

!define MUI_DIRECTORYPAGE_TEXT_TOP "Select your OBS Studio install folder (must contain obs-plugins\64bit)."
!define MUI_DIRECTORYPAGE_TEXT_DESTINATION "OBS Studio folder"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "Plugin installed"
!define MUI_FINISHPAGE_TEXT "Restart OBS Studio, then:$\r$\n  Sources -> Add -> OMO Overlay$\r$\n$\r$\nModes: Native / Browser (local) / Browser (remote)."
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Russian"

LangString OMO_CLOSE_OBS ${LANG_ENGLISH} "Please close OBS Studio before installing the plugin.$\r$\n$\r$\nContinue anyway?"
LangString OMO_CLOSE_OBS ${LANG_RUSSIAN} "Закройте OBS Studio перед установкой плагина.$\r$\n$\r$\nПродолжить всё равно?"
LangString OMO_MISSING ${LANG_ENGLISH} "Plugin files not found. Rebuild with build-plugin-installer.bat."
LangString OMO_MISSING ${LANG_RUSSIAN} "Файлы плагина не найдены. Соберите установщик через build-plugin-installer.bat."
LangString OMO_BAD_OBS ${LANG_ENGLISH} "This folder does not look like OBS Studio.$\r$\nExpected: obs-plugins\64bit$\r$\n$\r$\nChoose the OBS install directory (usually C:\Program Files\obs-studio)."
LangString OMO_BAD_OBS ${LANG_RUSSIAN} "Эта папка не похожа на OBS Studio.$\r$\nОжидается: obs-plugins\64bit$\r$\n$\r$\nУкажите каталог установки OBS (обычно C:\Program Files\obs-studio)."

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "OBS Studio x64 is required."
    Abort
  ${EndIf}
  SetRegView 64
  !insertmacro MUI_LANGDLL_DISPLAY

  ReadRegStr $0 HKLM "SOFTWARE\OBS Studio" ""
  ${If} $0 != ""
  ${AndIf} ${FileExists} "$0\obs-plugins\64bit"
    StrCpy $INSTDIR $0
  ${EndIf}
FunctionEnd

Function .onVerifyInstDir
  IfFileExists "$INSTDIR\obs-plugins\64bit\*.*" 0 omo_dir_bad
    Return
  omo_dir_bad:
    MessageBox MB_ICONEXCLAMATION "$(OMO_BAD_OBS)"
    Abort
FunctionEnd

Section "OMO Connector" SecPlugin
  SectionIn RO
  SetRegView 64

  MessageBox MB_YESNO|MB_ICONQUESTION "$(OMO_CLOSE_OBS)" IDYES omo_go
    Abort
  omo_go:

  IfFileExists "${OMO_PLUGIN_SRC}\bin\64bit\omo-connector.dll" 0 omo_bad
    Goto omo_ok
  omo_bad:
    MessageBox MB_ICONSTOP "$(OMO_MISSING)"
    Abort
  omo_ok:

  SetOutPath "$INSTDIR\obs-plugins\64bit"
  File "${OMO_PLUGIN_SRC}\bin\64bit\omo-connector.dll"

  SetOutPath "$INSTDIR\data\obs-plugins\omo-connector\locale"
  File /nonfatal "${OMO_PLUGIN_SRC}\data\locale\*.ini"

  SetOutPath "$INSTDIR\data\obs-plugins\omo-connector"
  WriteUninstaller "$INSTDIR\data\obs-plugins\omo-connector\Uninstall-OMO-Connector.exe"

  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OBS-OMO-Connector" "DisplayName" "OBS OMO Connector Plugin ${OMO_PLUGIN_VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OBS-OMO-Connector" "UninstallString" "$\"$INSTDIR\data\obs-plugins\omo-connector\Uninstall-OMO-Connector.exe$\""
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OBS-OMO-Connector" "DisplayVersion" "${OMO_PLUGIN_VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OBS-OMO-Connector" "Publisher" "OBS Moderator Overlay"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OBS-OMO-Connector" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OBS-OMO-Connector" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OBS-OMO-Connector" "NoRepair" 1
  WriteRegStr HKLM "Software\OBSModeratorOverlay\OmoPlugin" "ObsDir" "$INSTDIR"

  RMDir /r "$APPDATA\obs-studio\plugins\omo-connector"
SectionEnd

Section "Uninstall"
  SetRegView 64
  ReadRegStr $INSTDIR HKLM "Software\OBSModeratorOverlay\OmoPlugin" "ObsDir"
  ${If} $INSTDIR == ""
    StrCpy $INSTDIR "$PROGRAMFILES64\obs-studio"
  ${EndIf}

  Delete "$INSTDIR\obs-plugins\64bit\omo-connector.dll"
  Delete "$INSTDIR\obs-plugins\64bit\omo-connector.pdb"
  RMDir /r "$INSTDIR\data\obs-plugins\omo-connector"
  RMDir /r "$APPDATA\obs-studio\plugins\omo-connector"

  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\OBS-OMO-Connector"
  DeleteRegKey HKLM "Software\OBSModeratorOverlay\OmoPlugin"
SectionEnd