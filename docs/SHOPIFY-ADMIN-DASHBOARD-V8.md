# Wheelie Escape – V7 Shopify-Admin und Einstellungen

Für die **bestehende** in Shopify eingebettete App Wheelie Escape. Keine zusätzliche App und keine Änderungen an der OAuth Callback-URL.

## Neues Dashboard

- Weiß-graues Shopify-ähnliches Layout. Shopify-Kunden mit E-Mail, Suche und Filter „Alle / Mit Spielstand / Ohne Spielstand“.
- E-Mail ist **nur lesbar**: kein Bearbeitungsformular und POST `field=email` wird serverseitig mit HTTP 403 abgewiesen.
- Coins, XP, Guardian Bells sowie gespeicherte Fahrten, Highscore, Kilometer und weitere digitale Spielstatistiken editierbar (mit berechtigter Staff-ID).
- Vollständiger **digitaler** Katalog: Shop-Kleidungsstücke und deren Farbvarianten, digitale Freischaltungen, getragenes Outfit, alle Spiel-Motorräder, Lack-/Felgenfarben, Helme, Visierfarben, Hosen-/Schuhfarben und Bestenlistenname. Sticker lassen sich pro Ziel zurücksetzen.
- Shop-Käufe, Warenbestellungen, echte Rabattcodes und verifizierte Shop-Punkte bleiben **unverändert**. Insbesondere kann keine Shopify-Bestellung und kein realer Kaufnachweis durch die Admin-Freigabe erzeugt werden.
- Jede Mutation wird nach der Shopify-App-Bridge-ID-Token-Prüfung, Staff-Allowlist und serverseitiger Schema-Validierung ausgeführt; mittels compareDigest gegen paralleles Überschreiben geschützt und im Audit protokolliert.
- Online-Anzeige erfasst nur angemeldete aktive Spieler innerhalb der aktuellen Seite (max. 25), keine Gäste. „Mit Spielstand/Ohne Spielstand“ bezieht sich ausdrücklich auf das Shopify-Kunden-Spielstand-Metafeld, nicht auf nicht erfassbare Gastbesucher. Filter gelten pro Seite.

## Warum zeigt das Dashboard „Nur Lesen“?

Die Schutzregel ist bewusst aktiv. Um Coins und Inventar ändern zu dürfen:

1. In **Shopify Admin → Apps → Wheelie Escape** im Abschnitt „Systemstatus“ die **Shopify Staff-ID** ablesen. Es ist eine numerische ID und **kein Passwort oder API-Schlüssel**.
2. In Shopify **Hydrogen → Oxygen → Storefront → Environment variables** in der Umgebung, in der `game.pfusch-clothing.ch` läuft, den Eintrag **`SHOPIFY_DASHBOARD_EDITOR_IDS`** mit genau deiner numerischen Staff-ID anlegen. Bei mehreren Administratoren IDs mit Kommas trennen.
3. Die geänderte Oxygen-Umgebung/Deployment aktivieren bzw. neu deployen. Danach eingebettete App im Shopify Admin neu öffnen.
4. Der Systemstatus muss **„Freigegeben“** anzeigen. Vorher bleiben alle Bearbeitungen gesperrt. **Die Umgebungsvariable selbst niemals im Chat zusammen mit anderen Secrets posten.** Die Staff-ID darf als reine Kennzahl gezeigt werden.

Shopify Protected Customer Data Zugriff kann erforderlich sein, damit bei allen Kunden die E-Mail sichtbar ist. Eine fehlende Shopify-E-Mail darf nicht erfunden werden.

## Ingame Einstellungen

Unten im Einstellungen-Menü steht **EINSTELLUNGEN SPEICHERN**. Bereits über Steuerelemente geänderte Einstellungen werden vor Schließen zur vorhandenen Spielstand-Cloud-Synchronisierung übertragen. Bei fehlender Verbindung/ungelösten Konflikten bleibt das Menü offen und zeigt die Fehlermeldung. Auch während einer pausierten Fahrt geht der Button zur Pause zurück, ohne die Fahrt neu zu starten.

## Betrieb

- Bitte zuerst vollständigen PowerShell-Testlauf erfolgreich abschließen und erst dann `JA` eingeben. Die vorherige Codeversion wird beim Testfehler wiederhergestellt; bei bereits erzeugtem Commit wird nicht zurückgesetzt.
- Aktive Spieler-Sitzungen können mit Admin-Änderungen kollidieren. Die bestehende CAS-Prüfung verhindert stilles Überschreiben; Spieler sollten danach die Spielseite neu laden.
- Gespeicherte Sticker und vorhandene Spielstände werden bei Installation nicht gelöscht.
