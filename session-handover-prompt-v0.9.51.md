# Übergabe-Prompt: Vortex Client Launcher und Addon weiterentwickeln

Du übernimmst die Weiterentwicklung des **Vortex Client Launchers**, des **Vortex Client Addons** und bei Bedarf des **Vortex Client Backends**. Arbeite direkt in den vorhandenen Repositories und behandle die folgenden Punkte als verbindlichen Projektstand.

## Zielbild und verbindliche Regeln

Der Vortex Client ist ein Minecraft-Fabric-Client für **Minecraft 1.21.11** mit einem Electron-Windows-Launcher. Der Launcher enthält Cosmetics, ein Skin Studio, Community-Skins, Mod-Management und den parallelen Start zweier lizenzierter Microsoft-Konten.

> **Wichtig:** Die originale Microsoft-/Minecraft-Skin des angemeldeten Kontos darf unter keinen Umständen verändert, ersetzt, hochgeladen oder lokal als Ingame-Skin überschrieben werden. Lokale Skin-Dateien sind ausschließlich Launcher-Vorschauen.

Jede Launcher-Veröffentlichung muss als fertiger Windows-Release über GitHub Actions erstellt und unter `Lukas3578/Vortex-launcher/releases` veröffentlicht werden. Jeder Release braucht eine strukturierte deutsche Beschreibung mit **Neu**, **Behoben**, **Installation** und **Hinweis**.

| Bereich | Verbindliche Anforderung |
|---|---|
| Capes | Echte rückseitige Minecraft-Capes, kein Brust-/Skin-Overlay, sichtbar zwischen Vortex-Spielern über UUID-Presence-Synchronisierung. |
| Hüte | Echte 3D-Modelle mit eigenen Geometrien und Texturen; kein weißer oder transparenter Overlay-Block. |
| Skins | Microsoft-/Minecraft-Skin bleibt im Spiel autoritativ; Studio-, Import- und Community-Skins sind nur Launcher-Vorschauen. |
| Konten | Oben rechts aktives Konto auswählen, **Launch Vortex** starten; ein zweites Konto startet automatisch separat, falls eine Primärinstanz läuft. |
| UI | Premium, minimal und editorartig; keine überladene Dashboard-Optik oder unnötige Karten. |

## Repositories und wichtige Pfade

| Repository | Zweck | Wesentliche Dateien |
|---|---|---|
| `Lukas3578/Vortex-launcher` | Electron-Windows-Launcher, Assets und Releases | `src/main.js`, `src/renderer.js`, `src/index.html`, `src/styles.css`, `src/preload.js`, `.github/workflows/release.yml` |
| `Lukas3578/Vortex-Client-Addon` | Eigenes Fabric-Addon für feste Cape- und Hut-Renderer | `FixedCapeRendererMixin.java`, `FixedHatRendererMixin.java`, `LocalCosmeticsSelection.java`, `CapePresence.java` |
| `Lukas3578/Vortex-Client` | Node/Express-Backend | `routes/capes.js`, `routes/skins.js`, `db/database.js`, `server.js` |

## In dieser Sitzung vollständig umgesetzt

### 1. Premium-3D-Hüte und Cape-Renderer

Die fünf Hüte wurden als deutlich detailliertere echte Minecraft-3D-Kosmetik gebaut: **Vortex Cap**, **Neon Halo**, **Void Crown**, **Cyber Headphones** und **Slime Antenna**. Sie verwenden feste Addon-Geometrien und vollständig deckende 64×64-Texturen. Der alte fehlerhafte Core-Hutrenderer wird durch Addon-Mixins unterdrückt.

Die Cape-Logik nutzt einen festen Back-Cape-Renderer im Addon, eingebettete Cape-Texturen und UUID-basierte Presence-Synchronisierung über `https://vortex-client.onrender.com/api/capes/presence`. Die Designs sind Vortex Crest in Cyan/Blau, Nebula in Lila/Violett und Void in Schwarz/Anthrazit mit sichtbaren Mustern.

### 2. Skin Studio und Community-Skins

Der Launcher enthält unter **Cosmetics → Skins** ein Skin Studio mit einem echten 64×64-Pixelcanvas, Farbwahl, Pinselgrößen, Füllen, Radierer und einer drehbaren 3D-Minecraft-Figur. Community-Skins können mit Titel, Beschreibung und Sichtbarkeit veröffentlicht sowie in einer Galerie geladen werden.

Die Backend-Route `routes/skins.js` validiert Community-Uploads als echte 64×64-PNGs. Die Datenbanktabelle wird über `db/database.js` angelegt und die Route ist in `server.js` registriert.

### 3. Aktueller Skin-Studio-UI-Stand

Die zuletzt verbindliche Oberfläche ist ein **zusammenhängender, minimaler Editor**, nicht ein Dashboard. Pixel Editor, 3D Preview und Properties / Export liegen in einer gemeinsamen Arbeitsfläche mit feinen Trennlinien statt drei separaten Karten.

Verwende für spätere UI-Arbeit diese Regeln:

- Hintergrund `#070B14`, sekundärer Hintergrund `#0B1220`, Oberfläche `#101A2B`, Rahmen `#1B2A40`.
- Cyan `#35C7FF` und Blau `#4F8CFF` nur für gezielte Interaktionen und nicht als dauerhafte Glow-Flächen.
- Linke Navigation schlank, monochrom, mit einer feinen Cyan-Linie als Aktivzustand.
- Kompakte Kopfzeile mit `VORTEX SKIN STUDIO`, Unterstützertext und kleinem `64×64 PIXELS`-Hinweis.
- Keine riesige Bannerfläche, keine dekorativen Nummern wie `01`, keine zufälligen Kreise, keine übermäßigen Glows und keine unnötigen Badges.
- Der Satz **„Paint your Minecraft character.“** wurde auf Wunsch des Nutzers vollständig aus `src/index.html` entfernt und darf nicht wieder eingefügt werden.

### 4. Addon-Build-Reparatur

Der Addon-GitHub-Actions-Build scheiterte, weil `FixedCapeRendererMixin` und `FixedHatRendererMixin` `com.vortex.client.cosmetics.WearableCosmetics` importierten. Diese Klasse ist in dem im Workflow gebauten Core-Client nicht vorhanden.

Der Fehler wurde behoben:

- `WearableCosmetics` wurde aus beiden Renderern entfernt.
- `FixedCapeRendererMixin` nutzt ausschließlich `CapePresence.textureFor(state.id)`.
- `LocalCosmeticsSelection.java` wurde im Addon ergänzt. Es erkennt den lokalen Spieler und liest die Hutwahl aus `config/vortexclient/launcher-cosmetics.json`.
- Der Addon-Build ist lokal mit `./gradlew clean build --no-daemon` erfolgreich.
- Der GitHub-Actions-Build im Addon-Repository ist ebenfalls erfolgreich.
- Die daraus erzeugte `vortex-plus-addon-1.0.0.jar` wurde in `Vortex-launcher/assets/modpacks/1.21.11/` übernommen.

### 5. Harter Originalskin-Fix

Dies ist der kritischste aktuelle Stand. Es gab weiterhin Berichte über eine blaue Ingame-Skin. Deshalb wurden alle möglichen Cosmetics-Skin-Override-Pfade härter getrennt.

| Maßnahme | Aktueller Stand |
|---|---|
| Core-Mixin | `SkinOverrideMixin` wurde aus `vortexclient.client.mixins.json` entfernt. |
| Core-Bytecode | `SkinOverrideMixin.class` wird mit `tools/disable_core_skin_override.py` zusätzlich vollständig aus der ausgelieferten Cosmetics-Core-JAR entfernt. |
| Launcher-Vorschauen | Studio-, Import- und Community-Skins liegen nur noch unter `config/vortexlauncher/skin-previews`. |
| Core-Profil | `config/vortexclient/launcher-cosmetics.json` enthält keine lokalen Skin-Dateien mehr. |
| Bereinigung | Alle PNGs im alten Core-Skin-Ordner werden gelöscht; bekannte Altwerte wie `baseSkin`, `generatedSkin`, `previewSkin`, `skin`, `skinPath`, `activeSkin`, `selectedSkin` und `customSkin` werden genullt. |
| Instanzen | `maintainBundledMods()` aktualisiert die Core-JAR und bereinigt Profile; Parallelinstanzen kopieren danach die reparierte Basisinstanz. |

Ändere diese harte Trennung nicht. Lokale Vorschauen dürfen nie wieder nach `config/vortexclient/skins` oder in `launcher-cosmetics.json` geschrieben werden.

## Aktuelle Release-Reihe dieser Sitzung

| Version | Schwerpunkt |
|---|---|
| `v0.9.44` | Premium-3D-Hutserie und neue Vorschauen |
| `v0.9.45` | Skin Studio, Community-Skins und Backend-API |
| `v0.9.46` | Korrektur der zerschnittenen Skin-Studio-3D-Darstellung |
| `v0.9.47` | Erstes Premium-Skin-Studio-Redesign |
| `v0.9.48` | Minimaler, verbundener Editor statt Karten-Dashboard |
| `v0.9.49` | Addon-Build-Stabilitätsfix für fehlendes `WearableCosmetics` |
| `v0.9.50` | Harter Originalskin-Fix: Entfernung von Override-Bytecode und getrennte Vorschau-Speicherung |
| `v0.9.51` | Entfernt die Überschrift `Paint your Minecraft character.` aus dem Skin Studio |

## Aktuelle Test- und Release-Checkliste

1. Prüfe JavaScript mit `node --check src/main.js`, `node --check src/renderer.js` und `node --check src/preload.js`.
2. Bei Core-JAR-Änderungen muss `unzip -t` erfolgreich sein.
3. Bei Addon-Änderungen lokal `./gradlew clean build --no-daemon` ausführen und den GitHub-Actions-Lauf kontrollieren.
4. Bei Originalskin-Arbeit prüfen, dass die Core-JAR keine `SkinOverrideMixin.class` enthält und die Mixinkonfiguration keinen Eintrag dafür hat.
5. Für Launcher-Releases Versionen geschlossen in `package.json`, `src/main.js`, `src/index.html` und `src/renderer.js` erhöhen.
6. `release-notes-vX.md` mit **Neu**, **Behoben**, **Installation** und **Hinweis** schreiben.
7. Commit, Push, Git-Tag, GitHub-Actions-Windows-Build prüfen und danach die Release Notes mit `gh release edit --notes-file` setzen.
8. Nutzer erhält den GitHub-Release-Link und klare Installationsschritte.

## Nächster Pflicht-Test beim Nutzer

Nach Installation von `v0.9.50` oder neuer: Launcher und alle Minecraft-Fenster schließen, Installer ausführen, einmal **Launch Vortex** starten, Minecraft komplett schließen und ein zweites Mal starten. Der erste Start bereinigt alte Instanzdateien. Wenn die Ingame-Skin danach noch blau ist, benötigt der nächste Bearbeiter `latest.log`, den Inhalt von `config/vortexclient/launcher-cosmetics.json` und die Mod-Liste der betroffenen Basis- und Parallelinstanz.

> Arbeite direkt, veröffentliche bei jeder Launcher-Änderung einen vollständigen Windows-Release und frage nur nach, wenn eine echte Nutzereingabe oder ein Screenshot unvermeidbar ist.
