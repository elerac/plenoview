!define PRISMIFOLD_EXR_THUMBNAIL_PROVIDER_CLSID "{4D64B0F7-4E7E-49E2-8F8C-1DB4B1EF6C15}"
!define PRISMIFOLD_THUMBNAIL_PROVIDER_HANDLER "{e357fccd-a995-4576-b01f-234630154e96}"

!macro PRISMIFOLD_EXR_THUMBNAIL_SET_REGVIEW
  !if "${ARCH}" == "x64"
    SetRegView 64
  !endif
  !if "${ARCH}" == "arm64"
    SetRegView 64
  !endif
!macroend

!macro PRISMIFOLD_EXR_THUMBNAIL_NOTIFY_SHELL
  System::Call "shell32::SHChangeNotify(i,i,i,i) (0x08000000, 0x1000, 0, 0)"
!macroend

!macro PRISMIFOLD_EXR_THUMBNAIL_REMOVE_OLD_ASSOCIATION FILECLASS
  ReadRegStr $R0 SHCTX "Software\Classes\.exr" ""
  ${If} $R0 == "${FILECLASS}"
    DeleteRegValue SHCTX "Software\Classes\.exr" ""
  ${EndIf}
  DeleteRegKey SHCTX "Software\Classes\${FILECLASS}"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro PRISMIFOLD_EXR_THUMBNAIL_SET_REGVIEW
  !insertmacro PRISMIFOLD_EXR_THUMBNAIL_REMOVE_OLD_ASSOCIATION "OpenEXR Image"
  !insertmacro PRISMIFOLD_EXR_THUMBNAIL_REMOVE_OLD_ASSOCIATION "Prismifold.exr"

  WriteRegStr SHCTX "Software\Classes\.exr\ShellEx\${PRISMIFOLD_THUMBNAIL_PROVIDER_HANDLER}" "" "${PRISMIFOLD_EXR_THUMBNAIL_PROVIDER_CLSID}"
  WriteRegStr SHCTX "Software\Classes\CLSID\${PRISMIFOLD_EXR_THUMBNAIL_PROVIDER_CLSID}" "" "Prismifold EXR Thumbnail Provider"
  WriteRegStr SHCTX "Software\Classes\CLSID\${PRISMIFOLD_EXR_THUMBNAIL_PROVIDER_CLSID}\InprocServer32" "" "$INSTDIR\prismifold_exr_thumbnail.dll"
  WriteRegStr SHCTX "Software\Classes\CLSID\${PRISMIFOLD_EXR_THUMBNAIL_PROVIDER_CLSID}\InprocServer32" "ThreadingModel" "Apartment"
  WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Shell Extensions\Approved" "${PRISMIFOLD_EXR_THUMBNAIL_PROVIDER_CLSID}" "Prismifold EXR Thumbnail Provider"
  !insertmacro PRISMIFOLD_EXR_THUMBNAIL_NOTIFY_SHELL
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro PRISMIFOLD_EXR_THUMBNAIL_SET_REGVIEW
  DeleteRegKey SHCTX "Software\Classes\.exr\ShellEx\${PRISMIFOLD_THUMBNAIL_PROVIDER_HANDLER}"
  DeleteRegKey /ifempty SHCTX "Software\Classes\.exr\ShellEx"
  DeleteRegKey /ifempty SHCTX "Software\Classes\.exr"
  DeleteRegKey SHCTX "Software\Classes\CLSID\${PRISMIFOLD_EXR_THUMBNAIL_PROVIDER_CLSID}"
  DeleteRegValue SHCTX "Software\Microsoft\Windows\CurrentVersion\Shell Extensions\Approved" "${PRISMIFOLD_EXR_THUMBNAIL_PROVIDER_CLSID}"
  !insertmacro PRISMIFOLD_EXR_THUMBNAIL_NOTIFY_SHELL
!macroend
