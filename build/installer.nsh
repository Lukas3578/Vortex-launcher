; Vortex Client — NSIS-Erweiterung für electron-builder.
; Die Standard-Installationslogik bleibt unverändert; dieses Include fügt nur
; klare, gebrandete Willkommens- und Abschlussseiten hinzu.

!macro customHeader
  !define MUI_FINISHPAGE_TITLE "Vortex Client ist bereit."
  !define MUI_FINISHPAGE_TEXT "Die Vortex-Instanz, Mods, Resource Packs und Cosmetics verwaltest du direkt im Launcher.$\r$\n$\r$\nKlicke auf Fertig stellen, um Vortex Client zu starten."
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Willkommen bei Vortex Client"
  !define MUI_WELCOMEPAGE_TEXT "Dieser Installer richtet den Vortex Client für dein Windows-Konto ein.$\r$\n$\r$\nMinecraft-Instanzen, eigene Mods, Resource Packs und Cosmetics liegen getrennt vom Programmordner und bleiben bei Updates erhalten.$\r$\n$\r$\nKlicke auf Weiter, um den Installationsordner zu wählen und Vortex Client einzurichten."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Vortex Client entfernen"
  !define MUI_WELCOMEPAGE_TEXT "Der Launcher wird entfernt. Deine Minecraft-Instanzen, Mods, Resource Packs und Cosmetics bleiben auf deinem Computer erhalten."
  !insertmacro MUI_UNPAGE_WELCOME
!macroend
