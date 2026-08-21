# Cape- und Cap-Designbefunde

Die Client-Vorschau `cape-nebula-mark.png` zeigt ein schmales, dunkelviolettes, rechteckiges Cape mit abgerundeter beziehungsweise pixelartig eingefasster Silhouette, horizontalen dunklen Bändern und einem hellvioletten, zentralen Stern-/Kreuzmotiv. Die eigentliche Minecraft-Textur muss dieses Motiv auf der sichtbaren 10×16-Cape-Fläche abbilden; transparente Bereiche sollen außerhalb der Cape-Fläche bleiben.

Die Client-Vorschau `hat-vortex-cap.png` zeigt eine cyanfarbene, futuristische Kappe beziehungsweise einen Halo mit leuchtender Kontur, dunklem Innenraum, Pixel-Sternen im Hintergrund und einem weißen/cyanen Vortex-Symbol. Die Cap-Vorschau ist ein eigenständiges 128×128-Preview-Asset und keine Minecraft-Cape-Textur. Änderungen müssen daher Vorschau und Spieltextur getrennt, aber stilistisch konsistent behandeln.

Der Nutzer verlangt, dass die Darstellung im Spiel dem Client-Bild entspricht; der bisherige Fehler bestand zusätzlich darin, dass der Runtime-Fallback wegen eines falschen Mixin-Konstruktor-Deskriptors nicht angewendet wurde. Der neue Build muss daher sowohl die korrekten 1.21.11-UVs als auch die tatsächliche Mixin-Anwendung verifizieren.
