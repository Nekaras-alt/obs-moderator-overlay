; Optional OBS OMO Connector plugin (electron-builder NSIS include).
; This file is !include'd BEFORE MUI2 — only Var and !macro here.
; Functions must live in customHeader (inserted after MUI2).

Var OmoPluginDialog
Var OmoPluginCheckbox
Var InstallOmoPlugin

!macro customInit
  StrCpy $InstallOmoPlugin "1"
!macroend

!macro customHeader
  !ifndef BUILD_UNINSTALLER
    !include "nsDialogs.nsh"

    Function omoPluginPageCreate
      nsDialogs::Create 1018
      Pop $OmoPluginDialog
      StrCmp $OmoPluginDialog "error" 0 +2
        Abort

      ${NSD_CreateLabel} 0 0 100% 48u "Install the OMO Connector plugin into your OBS user plugins folder (%AppData%\obs-studio\plugins).$\r$\nRestart OBS after setup, then add source: OMO Overlay.$\r$\nUncheck to skip (Browser Source still works without the plugin)."
      Pop $0

      ${NSD_CreateCheckbox} 0 60u 100% 12u "Install OBS OMO Connector plugin (recommended)"
      Pop $OmoPluginCheckbox
      ${NSD_Check} $OmoPluginCheckbox

      nsDialogs::Show
    FunctionEnd

    Function omoPluginPageLeave
      ${NSD_GetState} $OmoPluginCheckbox $0
      StrCmp $0 ${BST_CHECKED} 0 omo_uncheck
        StrCpy $InstallOmoPlugin "1"
        Goto omo_leave_done
      omo_uncheck:
        StrCpy $InstallOmoPlugin "0"
      omo_leave_done:
    FunctionEnd
  !endif
!macroend

!macro customPageAfterChangeDir
  Page custom omoPluginPageCreate omoPluginPageLeave
!macroend

!macro customInstall
  StrCmp $InstallOmoPlugin "1" 0 omo_skip
  IfFileExists "$INSTDIR\resources\omo-plugin\omo-connector\bin\64bit\omo-connector.dll" 0 omo_missing
    CreateDirectory "$APPDATA\obs-studio\plugins\omo-connector\bin\64bit"
    CreateDirectory "$APPDATA\obs-studio\plugins\omo-connector\data\locale"
    CopyFiles /SILENT "$INSTDIR\resources\omo-plugin\omo-connector\bin\64bit\omo-connector.dll" "$APPDATA\obs-studio\plugins\omo-connector\bin\64bit"
    IfFileExists "$INSTDIR\resources\omo-plugin\omo-connector\data\locale\en-US.ini" 0 omo_skip
      CopyFiles /SILENT "$INSTDIR\resources\omo-plugin\omo-connector\data\locale\*.*" "$APPDATA\obs-studio\plugins\omo-connector\data\locale"
    Goto omo_skip
  omo_missing:
    MessageBox MB_ICONEXCLAMATION "OBS OMO plugin was selected, but omo-connector.dll is missing from this installer."
  omo_skip:
!macroend

!macro customUnInstall
  RMDir /r "$APPDATA\obs-studio\plugins\omo-connector"
!macroend
