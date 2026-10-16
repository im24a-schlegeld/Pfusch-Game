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

Der erste vollständige Browserlauf zeigte zusätzlich einen Fehler im neuen Scrolltest: Sein pauschaler Startpunkt lag neben dem Größenregler und wurde von Chromiums Touch-Zielkorrektur auf dessen Minimum von 4 cm gezogen. Die Browseraufzeichnung zeigte vorher korrekt 9 cm. Der Test beginnt nun gezielt auf einer nicht interaktiven Überschrift und prüft nach dem Scrollen zusätzlich, dass Größe und Drehung unverändert bleiben. Die produktive Standardgröße von 9 cm bleibt erhalten.

## Kundendatenprüfung nach dem Patch-Push

Die separate Prüfung fand einen zu weit gefassten Admin-Lesezugriff: Ein gültiger App-Bridge-ID-Token identifizierte einen Mitarbeiter, berechtigte ihn aber bisher bereits zum Abrufen der Kundenliste, einzelner Spielstände und der Übersicht. Die bestehende Mitarbeiterfreigabe wurde nur beim Schreiben geprüft. Ein mit einem Testschlüssel signierter, nicht freigegebener Mitarbeiter konnte dies mit ausschließlich erfundenen Kundendaten reproduzieren.

Die Korrektur prüft dieselbe serverseitige `SHOPIFY_DASHBOARD_EDITOR_IDS`-Freigabe jetzt vor allen diesen Lese- und Schreibzugriffen. Fehlende, leere oder ungültige Freigaben verweigern den Zugriff. Nicht freigegebene Mitarbeiter erhalten keine Kundendaten; dabei wird Shopify gar nicht kontaktiert. Freigegebene Mitarbeiter behalten die vorhandenen Verwaltungsfunktionen. Die öffentliche Admin-Hülle enthält weiterhin keine Kundendaten.

Diese Trennung entspricht der [Shopify-Dokumentation zu ID-Tokens](https://shopify.dev/docs/apps/build/authentication-authorization/id-tokens): Der Token bestätigt die Identität und enthält selbst keine Berechtigungen. Die App nutzt eine ausdrückliche Mitarbeiterfreigabe für ihre eigenen privilegierten Funktionen. Eine automatische Übernahme aller individuellen Shopify-Rollen würde zusätzlich [personenbezogene Online-Access-Tokens](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens#online-access-tokens) erfordern.

Zusätzlich geprüft wurden Kundenidentität und Kontozuordnung, CSRF/Origin-Grenzen, öffentliche Bestenliste und Einladungslinks, HTML-Ausgabe im Admin, feste Fehlerantworten, API-/Auth-Cacheausschlüsse und veröffentlichte Textdateien auf typische Zugangsdatenmuster. Dabei wurde kein weiteres externes Kundendatenleck nachgewiesen. Es wurden keine echten privaten Kundendaten abgerufen oder Zugangsdaten ausgegeben. Lokal gespeicherte Offline-Spielstände und Wiederherstellungskopien bleiben für die gewünschte Offline-Funktion erhalten; der Bericht ist kein Nachweis gegen beliebige Angriffe oder Browserzugriff durch andere Benutzer desselben Geräteprofils.
