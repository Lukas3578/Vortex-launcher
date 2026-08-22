## Vortex Client v0.9.50 — Original Minecraft Skin Hard Fix

### Neu

- Skin Studio, importierte Skins und Community-Skins werden nun ausschließlich unter `config/vortexlauncher/skin-previews` als **Launcher-Vorschauen** gespeichert.
- Diese Vorschau-Dateien liegen außerhalb des von der Cosmetics-Core-Mod gelesenen Ordners und können daher nicht mehr als Ingame-Skin verwendet werden.
- Die ausgelieferte Cosmetics-Core-JAR enthält weder eine Registrierung noch die Bytecode-Datei von `SkinOverrideMixin`.

### Behoben

- Alle PNG-Dateien im früheren Core-Skin-Ordner werden bei jeder Instanzwartung entfernt.
- Alle bekannten alten Skinfelder — `baseSkin`, `generatedSkin`, `previewSkin`, `skin`, `skinPath`, `activeSkin`, `selectedSkin` und `customSkin` — werden im Core-Profil konsequent genullt.
- Auch Parallelinstanzen übernehmen die bereinigte Basisinstanz, sodass ein zweites Konto keine alte Cosmetics-JAR oder Skin-Konfiguration behält.
- Cosmetics behalten ihre echten 3D-Hüte und Back-Capes, haben aber keinen Pfad mehr, die angemeldete Microsoft-/Minecraft-Skin zu ersetzen.

### Installation

1. `Vortex-Client-Setup-0.9.50.exe` unter diesem Release herunterladen.
2. Vortex Launcher und **alle Minecraft-Fenster** vollständig schließen.
3. Den Installer ausführen, den Launcher öffnen und einmal **Launch Vortex** starten.
4. Minecraft vollständig beenden und ein zweites Mal über **Launch Vortex** starten. Der erste Start bereinigt alte Instanzdateien; der zweite Start lädt nur noch die originale Konto-Skin.

### Hinweis

Es werden nur lokale Cosmetics-Override-Dateien entfernt. Deine Skin beim Microsoft-/Minecraft-Konto wird nicht geändert, nicht hochgeladen und nicht gelöscht. Deine Studio- und Community-Skin-Entwürfe bleiben als reine Launcher-Vorschauen verfügbar.
