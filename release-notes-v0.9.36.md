## Vortex Client v0.9.36

### Neu

- Der vollständige 64×64-Cape-Atlas ist nun mit dem Astral-Vortex-Pixelmuster belegt.
- Das Muster liegt nicht mehr nur auf einer Cape-Seite, sondern auf **Vorderseite, Rückseite, beiden schmalen Seiten, Oberkante und Unterkante** der echten Minecraft-Cape-Box.
- Die primären Front- und Rückflächen verwenden ein zusammenhängendes beziehungsweise gespiegeltes Vortex-Motiv.

### Behoben

- Behebt die schwarze Hälfte des Capes beim Drehen oder bei der Bewegung des Spielers.
- Entfernt transparente und schwarze Pixel aus dem vollständigen 64×64-Atlas, den der Back-Cape-Renderer verwenden kann.
- Die fest mitgelieferte `vortex-plus-addon-1.0.0.jar` enthält die aktualisierten, vollständig belegten Texturen direkt.

### Installation

1. `Vortex-Client-Setup-0.9.36.exe` herunterladen und die vorherige Launcher-Version sowie Minecraft vollständig schließen.
2. Den Installer ausführen.
3. Den neuen Launcher öffnen, unter **Cosmetics → Back-mounted Capes** ein Cape auswählen und Minecraft ausschließlich über **Launch Vortex** starten.
4. Minecraft beim ersten Test einmal vollständig beenden und erneut über den Launcher starten, damit die neue Renderer-JAR in die 1.21.11-Instanz kopiert wird.

### Hinweis

Die aktuelle Renderer-JAR wurde darauf geprüft, dass jede der 4.096 Atlas-Pixelpositionen vollständig deckend und nicht schwarz ist. Dadurch kann die Cape-Geometrie beim Drehen keine ungemusterte schwarze Seite mehr anzeigen.
