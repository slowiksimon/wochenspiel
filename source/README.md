# Slowik: Quellcode

Die App, die im Hauptverzeichnis dieses Repos liegt (`index.html`, `sw.js`, `manifest.json`, Icons), wird aus diesem Ordner gebaut. Gebaut wird eine einzelne `index.html` mit allem drin (Schrift, Skript, Stile), dazu Service Worker, Manifest und Icons.

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `src/app.js` | Wochenansicht: Nest, Wochenleiste, Aufgaben, Verschieben per Gedrückthalten, Dialoge für Aufgabe, Einstellungen und „Wer bist du?“ |
| `src/lists.js`, `src/lists-core.js` | Einkaufsliste und Wunschliste (Bildschirme, Dialoge, Listen einfügen, Regeln für Titel, Preise, Links) |
| `src/muell.js`, `src/muell-core.js`, `src/muell-data.js` | Müllplan Pfaffstätten: Monatsansicht, nächste Abholung, „Eure Tonnen“ (Straße, Tonnen); Termine und Straßen aus dem Abfuhrplan 2026 des GVA Baden |
| `src/muell-ics.js` | Kalenderdateien zum Abonnieren (Erinnerung um 19 Uhr am Vorabend), eine je Restmüll-Bereich und Tonnen-Kombination; der Build schreibt sie nach `dist/kalender/` |
| `src/shell.js`, `src/codec.js`, `src/adapter.js` | Einrichtung, Einladungslink und QR-Code, Anbindung an Firestore (mit Offline-Verhalten) |
| `src/nest.js`, `src/nav.js`, `src/inert.js`, `src/sheet.js` | Nest-Zeichnung und App-Icon, Tab-Leiste, Sperren der Seite hinter Dialogen, Rahmen der Dialoge |
| `src/style.css`, `src/lists.css`, `src/muell.css`, `src/shell.css` | Gestaltung (Design „Nest“: Stroh, Papier, Walnuss; Blau = Simon/Person 1, Rot = Anna/Person 2) |
| `src/body.html`, `src/sw.js`, `src/seed.js`, `src/dom.js`, `src/toast.js` | Seitengerüst, Service Worker, Start-Aufgaben, kleine Helfer |
| `assets/` | Schrift Gabarito (OFL), Icon als SVG und die daraus erzeugten PNGs |
| `tests/` | Tests mit Chromium und einem Fake-Firebase-Server |
| `tools/muellplan.py` | liest den Abfuhrplan (PDF) und schreibt `src/muell-data.js` |

## Bauen und veröffentlichen

```
npm install
npm run build          # schreibt dist/
```

Die Dateien aus `dist/` (samt Ordner `kalender/`) ins Hauptverzeichnis des Repos kopieren, committen und pushen. GitHub Pages liefert sie aus. Die Handys holen sich die neue Version beim nächsten Start (Service Worker: App einmal ganz schließen und neu öffnen). Die Daten liegen in Firebase und bleiben dabei erhalten.

`npm run icons` erzeugt die PNG-Icons neu aus `assets/icon.svg` (braucht Chromium und ImageMagick).

## Testen

```
npm test               # baut beide Varianten und lässt alle Suiten laufen (einige Minuten)
```

Braucht Chromium; liegt es nicht unter `/opt/pw-browsers/chromium`, den Pfad in `CHROMIUM` angeben. Die Tests laufen gegen einen Fake-Firebase-Server und eine eingefrorene Uhr (Mittwoch, 7. Okt. 2026, Woche 41). Eine Suite (`run-real.mjs`) prüft zusätzlich das echte Firebase-SDK ohne Netz, `run-muell.mjs` den Müllplan mit zwei Handys. `node tests/preview.mjs` macht Screenshots aller Bildschirme (`WIDTH`, `HEIGHT`, `DARK=1`).

## Müllplan für ein neues Jahr

Die Termine stehen fest in `src/muell-data.js` (nur 2026). Für ein neues Jahr das PDF des GVA Baden holen und:

```
pip install pdfplumber            # dazu poppler (pdftotext)
python3 tools/muellplan.py Pfaffstaetten_2027_web.pdf src/muell-data.js
```

Das Skript prüft jede Zeile (Wochentag, Farbe der Zelle, Feiertage) und den Rhythmus jeder Tonne und schreibt nur, wenn alles stimmt. Beim nächsten Build entstehen daraus auch die Kalenderdateien neu; wer abonniert hat, bekommt die neuen Termine von selbst. Die Unit-Tests in `tests/unit.mjs` prüfen die Daten von 2026 (Anzahl, Wochentage, Abstände) und müssen für ein neues Jahr angepasst werden. Danach bauen und veröffentlichen wie oben.

## Datenmodell (Firestore, `rooms/{Haushalt}/…`)

- `tasks/{id}`: `title`, `who` (`a`, `b`, `both`), `days` (0 = Montag … 6 = Sonntag), `pts` (1 bis 3), `once` (Woche, falls nur einmalig), `order`
- `slots/{Woche}_{Aufgabe}_{Tag}`: `done`, `by`, `at`, `to` (verschoben auf Tag), `who` (abgegeben an), `skip` (entfällt)
- `settings/people`: Namen, Belohnung, Teamziel (50 bis 100 %), Geräte-IDs der beiden
- `settings/shop-…`, `settings/wish-…`: Einträge der Einkaufs- und der Wunschliste
- `settings/muell`: `area` (Restmüll-Bereich 1 oder 2, 0 = offen), `street`, `have` (welche Tonnen der Haushalt hat); gilt für beide

Zugangsdaten zu Firebase stehen nicht im Code. Sie werden in der App eingegeben und liegen nur auf den Handys.
