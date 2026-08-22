## Vortex Client v0.9.38

### Neu

- Die ausgewählte Hut-ID wird nun unmittelbar in die Konfigurationsdatei geschrieben, die die Minecraft Cosmetics Core für ihre **echten 3D-Hutmodelle** ausliest.
- Die fünf verschiedenen Kopfformen sind eindeutig verknüpft: **Vortex Cap**, **Neon Halo**, **Void Crown**, **Cyber Headphones** und **Slime Antennae**.
- Die Hutkarten im Launcher beschreiben jetzt die jeweilige 3D-Form direkt.

### Behoben

- Behebt den Fehler, bei dem die Launcher-Auswahl nicht dauerhaft an Minecraft übergeben wurde und deshalb immer derselbe Ring sichtbar blieb.
- Die Instanz-Wartung löscht die `launcher-cosmetics.json`-Datei mit der 3D-Hut-Auswahl nicht mehr.
- Vor jedem Minecraft-Start wird die aktuell gewählte Hut-ID erneut in jede Vortex-Instanz synchronisiert.

### Installation

1. `Vortex-Client-Setup-0.9.38.exe` herunterladen.
2. Den bisherigen Launcher und Minecraft vollständig schließen.
3. Den Installer ausführen.
4. Im neuen Launcher unter **Cosmetics → Hats & Headwear** einen Hut auswählen.
5. Minecraft über **Launch Vortex** starten. Der gewählte Hut erscheint nach dem Laden als seine passende 3D-Geometrie auf dem Kopf.

### Hinweis

Nur **Neon Halo** ist absichtlich ein Ring. Vortex Cap ist eine Kappe, Void Crown eine Krone, Cyber Headphones sind Kopfhörer und Slime Antennae sind Antennen. Beim Wechsel wird die Core-Konfiguration direkt aktualisiert; ein vollständiger Minecraft-Neustart stellt sicher, dass die neue Form sofort sichtbar ist.
