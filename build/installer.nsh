; Maintenance page when Business One Test Environment is already installed.
; Offers Update or Uninstall only.

!ifndef BUILD_UNINSTALLER

!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!insertmacro GetParameters
!insertmacro GetOptions

Var hwndMaintenanceDialog
Var hwndRadioUpdate
Var hwndRadioUninstall
Var installedLocation

!macro customInit
  Call DetectExistingInstallPath
  ${If} $installedLocation != ""
    StrCpy $INSTDIR $installedLocation
  ${EndIf}
!macroend

!macro customWelcomePage
  !insertmacro MUI_PAGE_INIT
  Page custom MaintenancePageShow MaintenancePageLeave
  !insertmacro skipPageIfUpdated
  !define MUI_WELCOMEPAGE_TITLE "Setup - ${PRODUCT_NAME}"
  !define MUI_WELCOMEPAGE_TEXT "This will install ${PRODUCT_NAME} ${VERSION} on your computer.$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_PAGE_WELCOME
!macroend

Function DetectExistingInstallPath
  Push $0
  StrCpy $installedLocation ""

  SetRegView 64

  ReadRegStr $0 HKLM "Software\${APP_GUID}" InstallLocation
  StrCpy $installedLocation $0

  ${If} $installedLocation == ""
    ReadRegStr $0 HKCU "Software\${APP_GUID}" InstallLocation
    StrCpy $installedLocation $0
  ${EndIf}

  ${If} $installedLocation == ""
    ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" InstallLocation
    StrCpy $installedLocation $0
  ${EndIf}

  ${If} $installedLocation == ""
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" InstallLocation
    StrCpy $installedLocation $0
  ${EndIf}

  ${If} $installedLocation == ""
    ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" DisplayIcon
    ${If} $0 != ""
      Push $0
      Call GetParentDir
      Pop $0
      StrCpy $installedLocation $0
    ${EndIf}
  ${EndIf}

  ${If} $installedLocation == ""
    IfFileExists "$PROGRAMFILES64\${APP_FILENAME}\${PRODUCT_FILENAME}.exe" 0 +3
      StrCpy $installedLocation "$PROGRAMFILES64\${APP_FILENAME}"
  ${EndIf}

  Pop $0
FunctionEnd

Function GetParentDir
  Exch $R0
  Push $R1
  Push $R2
  StrCpy $R1 $R0
  StrCpy $R2 $R1 1 -1
  ${If} $R2 == "\"
    StrCpy $R1 $R1 -1
  ${EndIf}
  StrCpy $R0 $R1 1
  StrCpy $R2 0
  loop:
    IntOp $R2 $R2 + 1
    StrCpy $R0 $R1 1 -$R2
    StrCmp $R0 "\" found
    StrCmp $R2 ${NSIS_MAX_STRLEN} done
    Goto loop
  found:
    IntOp $R2 $R2 - 1
    StrCpy $R0 $R1 $R2
  done:
  Pop $R2
  Pop $R1
  Exch $R0
FunctionEnd

Function LaunchUninstaller
  Push $0
  Push $1

  SetRegView 64
  StrCpy $0 ""

  ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" UninstallString
  ${If} $0 == ""
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" UninstallString
  ${EndIf}

  ${If} $0 == ""
    StrCpy $0 "$installedLocation\Uninstall ${PRODUCT_FILENAME}.exe"
    IfFileExists $0 0 noUninst
    Goto runUninst
  ${EndIf}

  runUninst:
  ExecWait '$0' $1
  Quit

  noUninst:
  MessageBox MB_OK|MB_ICONEXCLAMATION "Unable to find the uninstaller. Remove the app from Windows Settings > Apps."
  Pop $1
  Pop $0
  Abort
FunctionEnd

Function MaintenancePageShow
  ${If} ${Silent}
    Abort
  ${EndIf}

  ${GetParameters} $R0
  ${GetOptions} $R0 "--updated" $R1
  ${IfNot} ${Errors}
    Abort
  ${EndIf}

  Call DetectExistingInstallPath
  ${If} $installedLocation == ""
    Abort
  ${EndIf}

  nsDialogs::Create 1018
  Pop $hwndMaintenanceDialog
  ${If} $hwndMaintenanceDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0u 0u 100% 12u "Application Maintenance"
  Pop $0

  ${NSD_CreateLabel} 0u 14u 100% 24u "${PRODUCT_NAME} is already installed.$\r$\nLocation: $installedLocation"
  Pop $0

  ${NSD_CreateRadioButton} 8u 48u 100% 12u "Update - install version ${VERSION}"
  Pop $hwndRadioUpdate
  ${NSD_Check} $hwndRadioUpdate

  ${NSD_CreateRadioButton} 8u 64u 100% 12u "Uninstall - remove ${PRODUCT_NAME} from this computer"
  Pop $hwndRadioUninstall

  nsDialogs::Show
FunctionEnd

Function MaintenancePageLeave
  ${NSD_GetState} $hwndRadioUpdate $0
  ${If} $0 == ${BST_CHECKED}
    Call DetectExistingInstallPath
    ${If} $installedLocation != ""
      StrCpy $INSTDIR $installedLocation
    ${EndIf}
    Return
  ${EndIf}

  ${NSD_GetState} $hwndRadioUninstall $0
  ${If} $0 == ${BST_CHECKED}
    Call LaunchUninstaller
    Return
  ${EndIf}

  Abort
FunctionEnd

Function _DeleteLnk
  Exch $R0
  ${If} ${FileExists} "$R0"
    Delete "$R0"
  ${EndIf}
  Pop $R0
FunctionEnd

; Delete desktop + start-menu links for a shortcut name in the current shell context.
Function _DeleteLnkIfName
  Exch $R0
  Push $R1
  StrCpy $R1 "$DESKTOP\$R0.lnk"
  Push $R1
  Call _DeleteLnk
  StrCpy $R1 "$SMPROGRAMS\$R0.lnk"
  Push $R1
  Call _DeleteLnk
  Pop $R1
  Pop $R0
FunctionEnd

; Remove every known shortcut (user desktop + public desktop) so the new one replaces them.
Function RemoveAllLegacyShortcuts
  Push $0

  SetRegView 64

  SetShellVarContext current
  Push "Business One"
  Call _DeleteLnkIfName
  Push "${PRODUCT_FILENAME}"
  Call _DeleteLnkIfName
  Push "${SHORTCUT_NAME}"
  Call _DeleteLnkIfName
  ReadRegStr $0 HKCU "Software\${APP_GUID}" ShortcutName
  ${If} $0 != ""
    Push $0
    Call _DeleteLnkIfName
  ${EndIf}

  SetShellVarContext all
  Push "Business One"
  Call _DeleteLnkIfName
  Push "${PRODUCT_FILENAME}"
  Call _DeleteLnkIfName
  Push "${SHORTCUT_NAME}"
  Call _DeleteLnkIfName
  ReadRegStr $0 HKLM "Software\${APP_GUID}" ShortcutName
  ${If} $0 != ""
    Push $0
    Call _DeleteLnkIfName
  ${EndIf}

  Pop $0
FunctionEnd

; Recreate shortcuts with logo .ico (outside app.asar). Default NSIS shortcuts are
; disabled in package.json — this is the only shortcut path, so update/repair always refresh.
!macro customInstall
  SetOutPath "$INSTDIR\resources"
  File /oname=icon.ico "${PROJECT_DIR}\assets\icon.ico"

  Call RemoveAllLegacyShortcuts

  SetShellVarContext all
  !insertmacro setLinkVars

  StrCpy $R8 "$INSTDIR\resources\icon.ico"

  CreateShortCut "$newDesktopLink" "$appExe" "" "$R8" 0 "" "" "${APP_DESCRIPTION}"
  ClearErrors
  WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"

  CreateShortCut "$newStartMenuLink" "$appExe" "" "$R8" 0 "" "" "${APP_DESCRIPTION}"
  ClearErrors
  WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"

  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

!endif
