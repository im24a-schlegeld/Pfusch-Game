# CHF-5-Spielbelohnung: Einrichtung und Betrieb

Die Funktion ist implementiert, aber ohne `SHOPIFY_GAME_REWARDS_ENABLED=true` deaktiviert. In Entwicklung und Tests werden keine echten Shopify-Rabatte erstellt. Das Aktivieren der Variable erlaubt dem Server, nach erfüllten Bedingungen einen echten Rabattcode anzulegen.

## Festgelegte Bedingungen

- CHF 5 Rabatt ab CHF 50 Warenwert; nur für das angemeldete Shopify-Kundenkonto.
- Ein Code pro Konto, insgesamt einmal verwendbar, nicht mit anderen Rabatten kombinierbar.
- 30 Tage gültig ab der ersten serverseitigen Reservierung. Wiederholungen verlängern diese Frist nicht.
- Neu erspielte, servergeprüfte 50.000 Punkte und mindestens 10 gültige Fahrten. Pro UTC-Tag zählen maximal 10.000 Punkte, also frühestens nach fünf Tagen.
- Eine qualifizierende Fahrt dauert mindestens 20 aktive Sekunden und erzielt mindestens 100 nachgerechnete Punkte. Maximal 100 Punkte pro aktiver Sekunde zählen für diese Belohnung.
- Alte Spielstände, Coins, XP, Rankings und frei veränderbare Kunden-Spielmetafelder zählen nicht. Das normale Gastspiel funktioniert unabhängig davon.
- Nur `/api/rewards/run/finish` erlaubt bis zu 256 KiB JSON für vollständige Touch-Eingabeprotokolle. Spieler-Speicherstände und alle anderen JSON-Endpunkte behalten ihre Grenze von 128 KiB; gestreamte und angekündigte Längen werden geprüft.

## Berechtigungen der Shopify-App

1. [Shopify Dev Dashboard](https://dev.shopify.com/) öffnen und die bereits für die Spiel-Admin-API verwendete App auswählen.
2. Links **Versionen → Version erstellen** öffnen. Unter **API-Zugriff** das Feld **Bereiche** bearbeiten. Zusätzlich zu den vorhandenen Berechtigungen `write_discounts` eintragen; `write_customers` beibehalten. Für explizite Leseberechtigungen können `read_discounts` und `read_customers` mit eingetragen werden.
3. Unten **Veröffentlichen** anklicken und die Berechtigungsänderung für die bestehende Shop-Installation bestätigen, falls Shopify dies verlangt. Es wird keine zweite App und kein neuer öffentlicher Token benötigt.
4. Im Spiel angemeldet den Status prüfen. `discount_scope_missing` bedeutet, dass der tatsächlich ausgestellte Admin-Token `write_discounts` noch nicht enthält. Nach einer Scope-Änderung kann ein neues Deployment den bisherigen Token-Cache ersetzen.

Je nach Bereich zeigt Shopify auch englische Schaltflächen an: **Versions → Create a version → Scopes** bezeichnet denselben Weg. Shopify beschreibt die Versionierung im [Dev-Dashboard-Leitfaden](https://shopify.dev/docs/apps/build/dev-dashboard/create-apps-using-dev-dashboard) und Scope-Änderungen unter [Manage access scopes](https://shopify.dev/docs/apps/build/authentication-authorization/manage-access-scopes).

## Oxygen aktivieren

1. Im Shopify-Admin **Hydrogen** öffnen und den Storefront-Eintrag des Spiels auswählen.
2. In den Einstellungen von **Wheelie Escape** den Menüpunkt **Umgebungen und Variablen** öffnen. Dort eine neue Variable hinzufügen.
3. **Schlüssel:** `SHOPIFY_GAME_REWARDS_ENABLED`; **Wert:** `true`; unter **Umgebungen** **Production** auswählen und speichern. Der Wert ist kein Geheimnis.
4. Zu **Oxygen-Bereitstellungen** wechseln, **Production** auswählen und über **… → Redeploy environment** erneut bereitstellen. Erst das neue Deployment enthält den neuen Wert. Vorschau-/Testumgebungen erhalten weiterhin `false` oder keine Variable.

Die bestehenden serverseitigen Admin-Zugangsdaten und Customer-Account-Anmeldedaten bleiben erforderlich. Secrets gehören nie in `PUBLIC_`- oder `VITE_`-Variablen. Die Shop-Währung muss CHF sein; sonst liefert der Status `currency_not_chf`. Shopifys [Oxygen-Umgebungsdokumentation](https://shopify.dev/docs/storefronts/headless/hydrogen/environments) beschreibt die Variablen und den erforderlichen erneuten Deploy.

Wenn `discount_scope_missing` trotz veröffentlichter Berechtigung bleibt, erneuert der Server den zwischengespeicherten Admin-Token einmal und prüft die tatsächlich gewährten Scopes erneut. Pro laufender Serverinstanz und Zugangsdaten ist diese Erneuerung auf einmal pro Minute begrenzt. Statische ältere Admin-Tokens lassen sich so nicht erneuern. Bleibt die Berechtigung danach aus, enthält der authentifizierte Status unter `diagnostics.adminClientId` die öffentliche Client-ID der verwendeten Admin-App. Diese muss zur App-Version mit `write_discounts` passen; sie wird aus `SHOPIFY_CLIENT_ID` gelesen. Es werden keine Secrets oder Admin-Tokens ausgegeben. In diesem Fall die aktive App-Version, die Freigabe der Installation und die Client-ID in Production vergleichen.

Zum Abschalten den Wert auf `false` setzen und erneut deployen. Dies verhindert weitere Erstellung durch diese Anwendung; bereits ausgestellte Shopify-Codes werden dadurch nicht automatisch gelöscht. Einen bereits ausgestellten Code kann der Händler im Shopify-Admin unter **Discounts / Rabatte** verwalten.

## Serverprotokoll und Vertrauensgrenzen

Oxygen verwendet die vorhandene HttpOnly-Customer-Account-Sitzung. Der ältere Node-Adapter akzeptiert nur Shopify-signierte App-Proxy-Identität. Alle Antworten sind privat und ohne Cache; POST benötigt den an dieses Konto gebundenen CSRF-Token. Die Shopify-Identität wird nie aus dem Request-Body übernommen.

| Route | Eingabe | Ergebnis |
| --- | --- | --- |
| `GET /api/rewards/status` | Authentifizierte Sitzung | Verfügbarkeit, geprüfte Punkte/Fahrten, Tageslimit, CSRF, bestätigter Code oder `null` |
| `POST /api/rewards/run/start` | `csrfToken`, `bikeId` | Signierte Challenge mit Run-ID, Server-Seed, kanonischem Bike, Start-/Ablaufzeit |
| `POST /api/rewards/run/finish` | `csrfToken`, `token`, `proof: {ticks, events}` | Server-Nachsimulation und einmalige Gutschrift |
| `POST /api/rewards/claim` | `csrfToken` | Reservierung/Erstellung oder Wiederaufnahme derselben Reservierung |

Die Challenge bindet Shop, Kunde, Run-ID, Bike, Seed, Version und Zeiten mittels HMAC. Sie läuft nach 30 Minuten ab. Pro Konto ist nur eine Challenge aktiv; ein neuer Start ersetzt die vorherige. Es gelten 30 Sekunden Startabstand und maximal 40 Starts pro UTC-Tag. Alle im zentralen `BIKES`-Katalog enthaltenen Fahrzeuge können geprüft werden; ein Browser-Inventar ist kein Nachweis für eine wertvolle Belohnung.

Die Nachsimulation verwendet dieselbe feste Engine-Schrittweite von 1/60 Sekunde. Maximal 18.000 Schritte und 2.000 Eingabeereignisse werden akzeptiert; maximal acht Ereignisse pro Schritt und ein Spurwechsel je sechs Schritte verhindern künstliche Eingabestürme. Die behauptete aktive Laufzeit darf die verstrichene Serverzeit nur um 1,5 Sekunden überschreiten. Der Server berechnet Punkte selbst und akzeptiert keinen zugesandten Score. Pausen verlängern nur die reale Zeit.

Ein getrenntes, HMAC-geschütztes Kundenmetafeld `$app:pfusch_game.verified_rewards_v1` speichert geprüften Fortschritt, verbrauchte Runs und die Rabattreservierung. `player_v1` wird dafür nie gelesen. Jede Änderung verwendet `metafieldsSet.compareDigest`; konkurrierende Abschlüsse oder Claims können nicht doppelt gutschreiben. Ein ungültiger Ledger wird nicht als leeres Konto behandelt.

Vor der ersten finanziellen Mutation wird die Reservierung dauerhaft gespeichert. Der Rabattcode wird aus Server-Secret, Shop und Konto abgeleitet. Vor jeder Erstellung und nach unklaren Fehlern sucht der Server denselben Code und kontrolliert Käuferbindung, Betrag, Mindestwarenwert, Gültigkeit, einmalige Verwendung und ausgeschlossene Kombinationen. `pending=true` erlaubt die Wiederholung eines unbestätigten Claims; es wird niemals ersatzweise ein zweiter Code erzeugt. Ein bestätigter Claim bleibt auch nach Ablauf verbraucht.

Die Implementierung folgt Shopifys [DiscountCodeBasicInput](https://shopify.dev/docs/api/admin-graphql/latest/input-objects/DiscountCodeBasicInput), [DiscountContextInput](https://shopify.dev/docs/api/admin-graphql/latest/input-objects/DiscountContextInput) und [Suche nach einem Rabattcode](https://shopify.dev/docs/api/admin-graphql/latest/queries/codeDiscountNodeByCode), geprüft für Admin API `2026-10`.

## Betrieb und Grenzen

Ledger nicht löschen, zurücksetzen oder aus untrusted Spielerexporten wiederherstellen. Eine Rotation des verwendeten Shopify-App-Secrets erfordert eine kontrollierte Migration der signierten Ledger; ohne gültige Signatur bleibt die Ausgabe gesperrt. Bei Änderungen der Gameplay-Regeln die Replay-/Challenge-Version gemeinsam aktualisieren und laufende Challenges auslaufen lassen.

Deterministische Nachsimulation verhindert erfundene Browser-Scores. Sie beweist keine menschliche Bedienung und verhindert keine getrennten legitimen Kundenkonten. Tages-/Startlimits und die einmalige Kontobelohnung begrenzen das Risiko; bei Missbrauch die Ausgabe deaktivieren und die serverseitigen Regeln gezielt verschärfen.

Die automatisierten Tests verwenden ausschliesslich lokale Shopify-Mocks: Auth/CSRF, Scope-/CHF-Sperre, Tokenbindung, Zeit-/Eingabelimits, tatsächliche kurze Nachsimulation, einmalige/CAS-Gutschrift, Ledger-Manipulation, Reservierung, konkurrierende Claims sowie Wiederaufnahme nach unklarer Shopify-Antwort. Ein echter Rabatt wurde für diese Tests nicht angelegt.
