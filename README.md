# Vortex Client Launcher

Der Vortex Client Launcher ist eine Electron-Windows-App für getrennte Fabric-Instanzen, Vortex-Pflichtmods und Cosmetics. Der Launcher verwendet GitHub Releases als sichere Update-Quelle.

## Entwicklung

Installiere die Abhängigkeiten mit `npm ci` und starte die Anwendung mit `npm start`. Im Entwicklungsmodus ist die automatische Update-Prüfung absichtlich deaktiviert. Dadurch wird verhindert, dass eine lokale Entwicklungsversion versehentlich ein produktives Update herunterlädt.

## Online-Mods

Im Menü **Online-Mods** kann der Nutzer nach einem Modnamen suchen. Die Suche verwendet die öffentliche Modrinth-API und filtert die Vorschläge auf die ausgewählte Minecraft-Version und den Fabric-Loader. Für jedes Ergebnis werden die passende Mod-Version, Beschreibung, Kategorien und Downloadzahl angezeigt.

Beim Herunterladen fragt der Launcher die Modrinth-Version erneut ab, überprüft die Kompatibilität, akzeptiert ausschließlich eine HTTPS-JAR-Datei, begrenzt die Dateigröße auf 100 MB und vergleicht – sofern vorhanden – die SHA-512-Prüfsumme. Die Datei wird in den `mods`-Ordner der ausgewählten Instanz geschrieben. Bereits vorhandene Dateinamen werden nicht überschrieben. Die Suche nutzt die öffentliche Modrinth-API ohne Benutzerkonto; Modrinth verlangt dafür einen eindeutig identifizierenden User-Agent.[1]

## Updates für Nutzer

In der installierten Windows-App gibt es links den Menüpunkt **Updates**. Dort kann der Nutzer nach einer neuen GitHub-Version suchen, das Update herunterladen und anschließend mit **Update installieren** den Launcher neu starten. Die persönlichen Minecraft-Instanzen und Kontodaten liegen außerhalb des Installationsverzeichnisses und werden beim Update nicht ersetzt.

## Neue Version veröffentlichen

Erhöhe zunächst die Version in `package.json`, zum Beispiel von `0.4.0` auf `0.4.1`, committe die Änderungen und erstelle anschließend ein Versions-Tag:

```bash
npm version patch --no-git-tag-version
git add package.json package-lock.json src assets
git commit -m "Release 0.4.1"
git tag v0.4.1
git push origin main --tags
```

Das GitHub-Workflow erstellt danach auf einem Windows-Runner den NSIS-Installer und veröffentlicht ihn als GitHub Release. Dabei werden neben der `.exe` auch `latest.yml` und die Blockmap hochgeladen. Diese Metadateien benötigt `electron-updater`, damit der installierte Launcher die neue Version erkennt und den Download verifizieren kann.

Die Anwendung ist bereits auf das Repository `Lukas3578/Vortex-launcher` als Update-Quelle eingestellt. Der erste produktive Release muss daher als GitHub Release veröffentlicht werden. Ein normaler Commit allein ändert keine bereits installierte EXE; für Endnutzer muss immer ein neuer Versions-Tag beziehungsweise Release erstellt werden.

## Quellen

[1]: https://docs.modrinth.com/api/ "Offizielle Modrinth-API-Dokumentation"

## Lokaler Build

`npm run dist` erzeugt den Windows-Installer. Ein Windows-Rechner oder ein Windows-CI-Runner ist erforderlich, um den NSIS-Installer vollständig zu erstellen. Das Repository enthält deshalb den GitHub-Workflow unter `.github/workflows/release.yml`.
