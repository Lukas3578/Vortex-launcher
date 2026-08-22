## Vortex Client v0.9.39

### Neu

- Der Launcher kann jetzt einen **zweiten gespeicherten Minecraft-Account parallel** zum aktiven Konto starten.
- Auf der Startseite steht dafür eine Auswahl für ein weiteres gespeichertes Konto und der Button **Launch Second Account** bereit.
- Der Zweitaccount nutzt einen separaten Spielordner in der Vortex-Instanzstruktur. Dadurch kollidiert er nicht mit der Minecraft-Session-Sperre des ersten Clients.

### Behoben

- Die bisherige globale Sperre, die jeden zweiten Minecraft-Start verhindert hat, wurde durch getrennte Prozessverwaltung pro Konto ersetzt.
- Der Parallelstart verhindert ausdrücklich, dass dasselbe gespeicherte Konto doppelt verwendet wird.
- Beide Clients behalten die geprüfte Vortex-Fabric-Konfiguration, die gewählte Minecraft-Version sowie den aktuell ausgewählten Server beim Direktstart.

### Installation

1. `Vortex-Client-Setup-0.9.39.exe` herunterladen und den bisherigen Launcher vollständig schließen.
2. Den Installer ausführen.
3. Über das Kontomenü oben rechts zwei unterschiedliche Microsoft-/Minecraft-Konten hinzufügen.
4. Den ersten Account wie gewohnt mit **Launch Vortex** oder einem Server-Button starten.
5. Den zweiten Account im neuen Auswahlfeld wählen und **Launch Second Account** klicken.

### Hinweis

Jedes Konto benötigt eine eigene gültige Minecraft-Java-Lizenz. Der Launcher trennt die lokalen Spielordner technisch, ersetzt aber keine Serverregeln. Prüfe deshalb die Regeln des Servers zu Zweitaccounts und Multiboxing, bevor beide Accounts demselben Server beitreten.
