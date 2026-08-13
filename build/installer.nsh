; Optional OBS OMO Connector plugin (electron-builder NSIS include).
; Installs into Program Files\obs-studio (requires the main Setup to elevate).
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

      ${NSD_CreateLabel} 0 0 100% 56u "Install the OMO Connector plugin into OBS Studio (Program Files\obs-studio).$\r$\nRequires Administrator. Close OBS before finishing setup.$\r$\nRestart OBS, then add source: OMO Overlay.$\r$\nUncheck to skip (Browser Source still works without the plugin)."
      Pop $0

      ${NSD_CreateCheckbox} 0 70u 100% 12u "Install OBS OMO Connector plugin (recommended)"
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
    ; OBS loads plugins from Program Files\obs-studio\obs-plugins\64bit
    StrCpy $0 "$PROGRAMFILES64\obs-studio"
    IfFileExists "$0\obs-plugins\64bit\*.*" 0 omo_try_reg
      Goto omo_have_obs
    omo_try_reg:
      ReadRegStr $0 HKLM "SOFTWARE\OBS Studio" ""
      IfFileExists "$0\obs-plugins\64bit\*.*" 0 omo_obs_missing
    omo_have_obs:
      CreateDirectory "$0\obs-plugins\64bit"
      CreateDirectory "$0\data\obs-plugins\omo-connector\locale"
      CopyFiles /SILENT "$INSTDIR\resources\omo-plugin\omo-connector\bin\64bit\omo-connector.dll" "$0\obs-plugins\64bit"
      IfFileExists "$INSTDIR\resources\omo-plugin\omo-connector\data\locale\en-US.ini" 0 omo_clean_appdata
        CopyFiles /SILENT "$INSTDIR\resources\omo-plugin\omo-connector\data\locale\*.*" "$0\data\obs-plugins\omo-connector\locale"
      omo_clean_appdata:
      ; Remove legacy AppData install OBS does not load
      RMDir /r "$APPDATA\obs-studio\plugins\omo-connector"
      Goto omo_skip
    omo_obs_missing:
      MessageBox MB_ICONEXCLAMATION "OBS Studio was not found under Program Files.$\r$\nInstall the plugin later with OBS-OMO-Connector-Plugin-Setup, or copy omo-connector.dll into obs-studio\obs-plugins\64bit."
      Goto omo_skip
  omo_missing:
    MessageBox MB_ICONEXCLAMATION "OBS OMO plugin was selected, but omo-connector.dll is missing from this installer."
  omo_skip:
!macroend

!macro customUnInstall
  ; Do not remove Program Files plugin on app uninstall — streamer may still need it.
  ; Legacy AppData path cleanup only:
  RMDir /r "$APPDATA\obs-studio\plugins\omo-connector"
!macroend
