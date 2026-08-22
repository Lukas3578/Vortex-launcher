## Vortex Client v0.9.43

### Behoben

- Die blaue bzw. veränderte Spielerskin wurde durch einen alten Cosmetics-Skin-Override verursacht.
- Der `SkinOverrideMixin` wurde aus der mitgelieferten Cosmetics-Core-Mod deaktiviert.
- Alte `baseSkin`- und `generatedSkin`-Einträge werden bei der Instanz-Wartung bereinigt, damit wieder die originale Microsoft-/Minecraft-Skin geladen wird.

### Neu

- Hüte und Capes sind jetzt ausschließlich separate echte 3D-Cosmetics.
- Lokale 64×64-Skin-Dateien können weiter im Launcher als Vorschau verwendet werden, werden aber niemals auf deinen angemeldeten Minecraft-Account angewendet.
- Der Launcher zeigt jetzt sichtbar an, dass die originale Minecraft-Skin geschützt ist.

### Installation

1. `Vortex-Client-Setup-0.9.43.exe` herunterladen.
2. Minecraft und den alten Launcher vollständig schließen.
3. Den Installer ausführen und den Vortex Launcher öffnen.
4. Minecraft einmal über **Launch Vortex** starten und wieder vollständig schließen.
5. Minecraft ein zweites Mal über **Launch Vortex** starten. Die alte Skin-Variante ist dann bereinigt und deine originale Skin wird wieder geladen.

### Hinweis

Die Änderung entfernt keine Skin aus deinem Microsoft-Konto. Sie beendet nur den lokalen Vortex-Cosmetics-Override, der eine alte erzeugte blaue Skin-Datei bevorzugt hat.
