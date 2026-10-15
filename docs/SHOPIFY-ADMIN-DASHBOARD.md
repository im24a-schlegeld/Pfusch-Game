# Wheelie Escape – Shopify-Admin-Dashboard (erste Version)

## Zweck

Dies ist **keine neue Shopify-App**. Das bestehende Projekt erhält zwei isolierte Oxygen-Routen:

- `GET /admin` – eingebettete, nur lesende Verwaltungsoberfläche mit Shopify App Bridge.
- `GET /api/admin/overview` – nur mit von Shopify signiertem Admin-ID-Token (HS256) zugängliche Kennzahlen.

Die bestehenden `GET /`, Game-App, Customer Account OAuth, Shop-Käufe, Guardian Bells, Rabattcode-Ausgabe und Belohnungsläufe werden nicht verändert.

## Voraussetzungen in der bestehenden Shopify-App

1. Die **bereits vorhandene** Wheelie-Escape-App im Shopify Dev Dashboard auswählen.
2. App URL auf `https://<deine-bestehende-Oxygen-Spieladresse>/admin` setzen und *embedded* aktivieren. **Keine neue App anlegen.**
3. Shopify-App-Version veröffentlichen/aktualisieren und gegebenenfalls die Installation bzw. Berechtigungen bestätigen. Die Customer-Account-Callback-URL `https://<Oxygen-Adresse>/auth/callback` beibehalten. Vorhandene App-Scopes nicht entfernen.
4. Oxygen benötigt unverändert `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_CLIENT_ID` und `SHOPIFY_CLIENT_SECRET` **nur serverseitig**. Client-ID und Secret müssen zur gleichen installierten App gehören. Geheimnisse niemals in eine ZIP, in Git oder in Browser-Code schreiben.
5. Für die Kunden-Stichprobe benötigt die App den bestehenden Kundenzugriff (`write_customers` oder `read_customers`), für Rabattstatus `write_discounts`.
6. Erst die neue Dashboard-Version in Oxygen bereitstellen. Danach im Shopify-Admin unter **Apps → Wheelie Escape** öffnen.

## Was das Dashboard zeigt

- Stichprobe der 25 zuletzt im Shop aktualisierten Kunden, unter denen gespeicherte Spielstände erkannt werden.
- Fahrten, virtuelle Coins, gefahrene Kilometer, verfügbare und verbrauchte Guardian Bells **in dieser Stichprobe**.
- Verifizierte Punkte, Läufe und ausgegebene Codes **aus gültig HMAC-signierten Reward-Ledgern innerhalb der Stichprobe**. Codes selbst werden nicht an den Browser geliefert.
- Top 10 der im bestehenden Shop-Metafield gespeicherten Bestenliste.
- Angezeigte Berechtigungen und Serverzeit.

**Wichtig:** Dies sind keine Gesamtspielerzahlen oder tägliche Aktivitätsstatistiken. Shopify-Kundendaten sind keine vollständige Ereignis-Datenbank. Für historische Kennzahlen muss später ein eigener, aggregierter, serverseitiger Analytics-Speicher eingerichtet werden.

## Sicherheit

Shopify App Bridge stellt kurzlebige ID-Tokens bereit. Der Server prüft Signatur, `alg`, `aud`, `sub`, `iss`, `dest`, `nbf`, `iat`, `exp` vor jeder Admin-Datenabfrage. Kunden-ID, E-Mail-Adresse, Admin-Token, HMAC-Schlüssel, Rabattcode und persönliche Bestellinformationen erscheinen nie im Dashboard-JSON. Alle Admin-Routen sind `no-store`. Das Admin-HTML allein ist nicht geheim und zeigt ohne gültigen App-Bridge-Token keine Shop-Kennzahlen an. Der Admin-Frame ist auf Shopify Admin und die konkrete Shop-Domain begrenzt.

## Freigabe

Die Installation erzeugt die Dateien und ergänzt genau eine Server-Routenprüfung. Sie läuft erst durch Typecheck, Lint, Unit-Tests und Oxygen-Build. Der Push auf `main` erfolgt nur nach expliziter Bestätigung mit `JA`. Bei Fehlern bleiben die bisherigen versionierten Dateien erhalten. Shopify-App-Konfiguration im Dev Dashboard muss anschließend autorisiert vorgenommen werden; ein Git-Push allein aktiviert keinen Admin-Menüeintrag.
