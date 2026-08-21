## Vortex Client v0.9.35

### Neu

- Die feste Back-Cape-Renderer-Mod enthält die drei Astral-Vortex-Cape-Texturen nun **direkt in der Mod-JAR** unter dem eigenen `vortexplus`-Resource-Pfad.
- Der lokale Renderer liest die gewählte Cape-ID unmittelbar aus `config/vortex-client/cosmetics.json`.
- Die Auswahl `vortex-crest`, `nebula-mark` und `void-rune` wird dadurch ohne Abhängigkeit von einer dynamischen Texture-Registrierung der Core-Mod aufgelöst.

### Behoben

- Behebt den Fall, dass die Launcher-Vorschau korrekt angezeigt wurde, Minecraft das Cape aber nicht geladen oder gerendert hat.
- Der Renderer besitzt jetzt einen lokalen Fallback, falls die Entity-ID im Render-State nicht direkt dem Spieler entspricht.
- Multiplayer-Presence bleibt UUID-basiert aktiv; fremde Vortex-Spieler verwenden ebenfalls die eingebetteten Texturen der festen Renderer-Mod.

### Installation

1. `Vortex-Client-Setup-0.9.35.exe` herunterladen.
2. Den bisherigen Launcher und Minecraft vollständig schließen.
3. Den Installer ausführen und Minecraft ausschließlich über **Launch Vortex** starten.
4. Unter **Cosmetics → Back-mounted Capes** ein Cape auswählen und Minecraft danach einmal vollständig neu starten.
5. Prüfen, ob in der 1.21.11-Instanz `vortex-plus-addon-1.0.0.jar` vorhanden ist. Der Launcher ersetzt diese Datei automatisch durch die neue Fassung.

### Hinweis

Die sichtbare Cape-Seite wird aus den direkt eingebetteten `vortexplus:textures/capes/*.png`-Dateien geladen. Damit ist sie nicht mehr davon abhängig, ob die separate Cosmetics-Core-Mod ihre Texture-ID beim Start registriert.
