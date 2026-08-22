## Vortex Client v0.9.49 — Addon Build Stability Fix

### Neu

- Das feste Vortex-Cape- und 3D-Hut-Addon liest die eigene lokale Hutwahl jetzt über eine kleine Addon-Komponente aus.
- Der Launcher enthält die neu gebaute, verifizierte Addon-JAR aus dem erfolgreich ausgeführten Build.

### Behoben

- Der Addon-Build auf GitHub Actions kompiliert wieder erfolgreich.
- Die direkte Abhängigkeit von `WearableCosmetics` wurde entfernt. Diese Klasse war im im Workflow gebauten Cosmetics-Client nicht vorhanden und verursachte den Fehler `cannot find symbol`.
- Cape- und Hut-Renderer bleiben vollständig erhalten: Capes werden weiterhin über die eigene Presence-Komponente aufgelöst, Hüte bleiben an den lokalen Spieler und die ausgewählte Launcher-Konfiguration gebunden.

### Installation

1. `Vortex-Client-Setup-0.9.49.exe` unter diesem Release herunterladen.
2. Launcher und Minecraft vollständig schließen, dann den Installer ausführen.
3. Minecraft einmal über **Launch Vortex** starten, damit die korrigierte Addon-JAR in die Instanz übernommen wird.

### Hinweis

Der Fehler betraf den Addon-Kompiliervorgang, nicht deine Microsoft-/Minecraft-Skin. Die GitHub-Actions-Prüfung des Addon-Repositories ist nach diesem Fix erfolgreich abgeschlossen.
