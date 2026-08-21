## Vortex Client v0.9.34

### Neu

- Das **Astral-Vortex-Design** ist nun in die echten Minecraft-Cape-Atlanten, die Launcher-Karten und die gemeinsamen Backend-Assets übernommen.
- Alle drei auswählbaren Vortex-Capes verwenden dieselbe vollständige cyan-violette Astral-Vortex-Pixelgrafik.
- Das Cape-Muster füllt die gesamte sichtbare Cape-Seite: abgestufte Indigo- und Blauflächen, Violett-Runen, Cyan-Spark-Traces und ein kompakter heller Vortex-Kern.
- Die Launcher-Karten zeigen nun die reale vollflächige Cape-Grafik statt einer dunklen oder leeren Cape-Fläche.

### Behoben

- Schwarze beziehungsweise ungemusterte Pixel auf der sichtbaren Cape-Fläche wurden entfernt.
- Die Minecraft-Textur, die feste Cosmetics-Mod und die Launcher-Vorschau werden aus demselben Asset-Stand erzeugt.
- Die Cosmetics-Oberfläche bezeichnet die Auswahl nun korrekt als **back-mounted cape** statt als Körper-Overlay.

### Installation

1. `Vortex-Client-Setup-0.9.34.exe` herunterladen und die vorherige Launcher-Version vollständig schließen.
2. Den Installer ausführen und Minecraft nur über **Launch Vortex** starten.
3. In Cosmetics ein Vortex-Cape auswählen.
4. Der Launcher ersetzt die enthaltene Cosmetics-Mod in der Minecraft-1.21.11-Instanz automatisch durch die aktuelle Fassung.
5. Für Multiplayer-Sichtbarkeit müssen alle beteiligten Spieler die aktuelle Vortex-Cape-Mod verwenden.

### Hinweis

Die Minecraft-Cape-Geometrie verwendet nur einen kleinen sichtbaren UV-Bereich der 64×64-Atlasdatei. Nicht sichtbare Atlasbereiche bleiben transparent, wie es der Renderer benötigt; die tatsächlich gerenderte Cape-Fläche ist vollständig gemustert und enthält keine schwarzen Leerflächen.
