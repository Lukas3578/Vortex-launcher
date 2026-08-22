## Vortex Client v0.9.54

### Behoben
Der Renderer des normalen Vortex Client referenzierte nach dem Entfernen der Cosmetics-Seite noch nicht vorhandene Cosmetics-Schaltflächen. Dadurch wurde die Initialisierung abgebrochen: Der Account-/Sign-in-Bereich wurde nicht geladen und weitere Schaltflächen reagierten nicht.

Die verwaisten Cosmetics-Ereignisbindungen und der Hintergrund-Aufruf für Website-Capes wurden entfernt. Der normale Vortex Client startet wieder vollständig, zeigt die Anmeldung und bindet seine Bedienelemente korrekt.

### Installation
1. Den laufenden Vortex Client schließen.
2. `Vortex-Client-Setup-0.9.54.exe` aus diesem Release herunterladen und installieren.
3. Den Launcher öffnen; der Sign-in-Button und die Navigation müssen wieder funktionieren.

### Hinweis
Der normale Vortex Client bleibt ohne Cosmetics. Cosmetics gehören ausschließlich zu Sandbox Vortex.
