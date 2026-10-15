# Wheelie Escape – Shopify-Admin-Dashboard V5

Die bestehende eingebettete Shopify-App bleibt bestehen. Technischer Hintergrund: `https://game.pfusch-clothing.ch/admin`. Der Betreiber öffnet **Shopify → Apps → Wheelie Escape**.

## Funktionen

- Shopify-ähnliche helle, graue und schwarze Verwaltung mit Kundenname und **E-Mail pro Zeile**, sofern das Konto eine Adresse hat und Shopify diese freigibt.
- Suche, seitenweises Blättern, Fahrten, Coins, XP, Guardian Bells, Highscore.
- E-Mail-Bearbeitung getrennt von Spielwerten, mit expliziter Bestätigung.
- Bearbeitung von Coins, XP und insgesamt verdienten Guardian Bells. Bereits ausgegebene Bells dürfen nicht unterschritten werden; verifizierte Shop-Guthaben und echte Rabattcodes werden nie über die Oberfläche verändert.
- Vergleichsdigests schützen Änderungen des Spielstands gegen paralleles Überschreiben, und Spielwertänderungen werden im Kunden-Metafeld `dashboard_audit_v1` protokolliert.
- Aktivitätsanzeige auf Basis angemeldeter und aktiver Spielseiten mit einem 90-Sekunden-Heartbeat, in einem 120-Sekunden-Zeitfenster. **Keine Erfassung anonymer Gäste.** Die aktuelle Anzeige bezieht sich auf die momentan angezeigte Seite (höchstens 25 Kunden); sie ist **keine exakte Gesamtzahl** aller aktiven Website-Besucher.
- Stickergrößen-/Dreh-Regler wieder sichtbar plus Schnellbuttons. Vorhandene gespeicherte Sticker bleiben erhalten.

## Schreibrechte aktivieren

Schreibzugriff ist beim ersten Deployment **standardmäßig deaktiviert**. Öffne das Dashboard unter Shopify → Apps → Wheelie Escape. In **Systemstatus** findest du die Shopify-Staff-ID des angemeldeten Benutzers. Setze in der Oxygen-Umgebung für dieses Deployment:

`SHOPIFY_DASHBOARD_EDITOR_IDS=<eigene Shopify Staff-ID>`

Bei mehreren freigegebenen Administratoren IDs durch Kommas trennen. Die Prüfung erfolgt ausschließlich **serverseitig** nach Verifikation des signierten Shopify-App-Bridge-ID-Tokens; Browserdaten können keine Berechtigung erteilen. OAuth-Berechtigung `write_customers` wird benötigt. Für E-Mail-Adressen sind Shopifys Protected Customer Data Permissions maßgeblich; fehlt der Zugriff, zeigt Shopify möglicherweise keine E-Mails an.

### Betriebshinweise

- Die Kundensuche und Seitenanzeige verwenden Shopify Admin GraphQL. E-Mails sind personenbezogene Daten; nur berechtigten Shop-Mitarbeitern Zugriff auf die App geben.
- E-Mail-Änderungen sind Änderungen am Shopify-Kundenkonto, nicht am Anmeldekennwort. Sie können die Anmeldung beeinflussen. E-Mail-Änderungen erscheinen in Shopifys Kundenaktivitätsverlauf; digitaler Spielstand wird getrennt protokolliert.
- Die Live-Funktion erzeugt periodische Shopify-Metafeldzugriffe. Bei hohem Verkehrsaufkommen ist später ein dedizierter Presence-Store sinnvoll.
- Bei einer aktiven Spielsitzung kann das Cloud-Speichern nach einer Admin-Bearbeitung einen Konflikt melden. Den Spieler dann neu laden lassen.
- Kein neuer Shopify-App-Eintrag, kein API-Schlüssel in HTML, keine Manipulation der signierten Reward-Ledger.
