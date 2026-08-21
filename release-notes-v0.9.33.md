## Vortex Client v0.9.33

### Neu

- Drei neue, eigenständige Vortex-Cape-Designs im dunklen Minecraft-Pixel-Art-Stil: **Vortex Crest**, **Nebula Mark** und **Void Rune**.
- Gemeinsame Cape-Assets für Launcher-Vorschauen, Backend-Katalog, Presence-API und Minecraft-Texturen.
- Charakter-Vorschauen mit Vorder-, Seiten- und Rückenansicht, damit die tatsächliche Cape-Position klar erkennbar ist.
- Neue reproduzierbare Werkzeuge für die Erstellung und Synchronisierung der 128×128-Vorschauen und 64×64-Minecraft-Cape-Atlanten.

### Behoben

- Alte Körper-/Skin-Overlays werden nicht mehr als Cape verwendet.
- Cape-Texturen werden mit dem korrekten Minecraft-64×64-Atlasformat ausgeliefert.
- Die Cape-Auswahl und die Ingame-Textur verwenden dieselben IDs und Assets.
- Die bestehende UUID-basierte Vortex-Cape-Presence bleibt für andere Spieler aktiv.

### Installation

1. `Vortex-Client-Setup-0.9.33.exe` herunterladen und installieren.
2. Die vorherige Launcher-Version vollständig schließen.
3. Minecraft ausschließlich über **Launch Vortex** starten.
4. In der 1.21.11-Instanz prüfen, dass `vortexclient-2.29.9-cosmetics.jar` und `vortex-plus-addon-1.0.0.jar` vorhanden sind.
5. Im Cosmetics-Bereich ein Cape auswählen. Für die Multiplayer-Sichtbarkeit müssen alle beteiligten Spieler v0.9.33 beziehungsweise die enthaltene aktualisierte Cosmetics-Mod verwenden.

### Hinweis

Der Windows-Installer wurde über GitHub Actions erfolgreich gebaut. Ein echter Multiplayer-Test muss mit mindestens zwei gestarteten Vortex-Clients durchgeführt werden.
