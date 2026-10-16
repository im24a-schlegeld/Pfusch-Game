# Wheelie Escape V9 — Sicherheit und UI

- Keine Behauptung einer vollständigen Bot-Abwehr. `event.isTrusted` blockiert browserseitig über `dispatchEvent` erzeugte Tastatur-/Zeigerbefehle; echte Automationsprogramme können weiterhin Eingaben erzeugen.
- `/api/player` verwirft für **bestehende** Kunden-Spielstände extrem hohe Guthaben-/XP-/Distanz-/Highscore-Sprünge in einer Speicherung mit `422 implausible_game_progress`. Die erstmalige Kontosynchronisierung wird ebenfalls auf sehr große Sprünge geprüft, akzeptiert aber realistische Offline-Fortschritte. Diese Plausibilitätsgrenze ist **keine** kryptografische Fahrtenverifikation.
- Echte Shop-Belohnungen verwenden weiterhin separat gespeicherte signierte Ledger und serverseitiges Replay. Keine Änderungen an Preis, Check-out oder Shopify-Kaufdaten.
- Integralhelm etwa fünf Prozent größer; Motocross-Helm bleibt unverändert.
- Sticker: Größen-Presets, 5°- und 45°-Drehschritte, Duplizieren eines vorhandenen Stickers und Tippen zum Versetzen. Gespeicherte Positionen bleiben kompatibel.
- Admin: mobil kartenbasierte Kundenliste, größere Touch-Ziele und kompaktere Texte. Shopify App Bridge und Staff-Rechte unverändert.

**Wichtige Grenze:** Ein manipulierter Browser kann sich wie ein menschlicher Spieler verhalten und offline entstandene Daten sind nicht vollständig beweisbar. Für echte Wettbewerbssicherheit müsste jedes Ranglistenresultat ausschließlich aus einem serverseitig verifizierten Spielereignis entstehen. Digitale Werte und verifizierte Shop-Rabatte bleiben technisch getrennt.

## Prüfung
Schnelllauf: Typprüfung, Oxlint für die gezielt betroffenen Dateien, relevante Unit-Tests; danach kompletter Vitest-Lauf, Oxygen-Build und ein Sticker-PWA-Browsertest. Mit `-FullBrowser` zusätzlich die ganze 20-Test-Suite lokal. GitHub Actions prüft vor Oxygen-Deployment erneut.

## Integrationskorrekturen

Die Distanzgrenze folgt dem vorhandenen XP-Budget statt einer pauschalen Kilometergrenze pro Fahrt. Das Endlosspiel erlaubt lange Runden; echte 50-km-Fahrten und mehrere offline abgeschlossene 40-km-Fahrten dürfen beim Synchronisieren nicht den Kontozugang sperren. Die Regressionen verwenden die tatsächliche `finishRun`-Abrechnung und behalten die Ablehnung extrem gefälschter Werte bei.

Die Sticker-Werkstatt erhält auch innerhalb des Containers für den Installationshinweis einen eigenen begrenzten Scrollbereich. Die Scrollsperre während der Fahrt bleibt davon getrennt.
