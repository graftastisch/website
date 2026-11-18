# Wochenplan, Dateien und Login

Statische Website für GitHub Pages (`https://graftastisch.github.io/website/`).
Die Startseite leitet auf `/dashboard/` weiter. Davor sitzt das Login unter `/login/`, das nur zum Anmelden dient.

## Aufbau

```
index.html                  → leitet auf dashboard/ weiter
assets/config.js            → Supabase-URL, öffentlicher Schlüssel, Domain für Nutzernamen
assets/auth.js              → gemeinsames Login-Modul für alle Seiten
assets/docs.js, docs.css    → Dokument-Anzeige (PDF, Word, TXT), gemeinsam für Plan und Dateien
assets/vendor/pdfjs/        → pdf.js (Apache-2.0) für die PDF-Anzeige, liegt hier selbst, nichts kommt von Dritten
login/                      → nur Anmeldung
dashboard/                  → Navigation, Übersicht, Einstellungen (Anzeigename, Passwort)
plan/                       → der Wochenplan (geschützt)
files/                      → Dateiverwaltung (geschützt): index.html, style.css, files.js, zip.js
lists/                      → Listen (geschützt): index.html, style.css, lists.js
supabase/schema.sql         → Datenbankschema für ein NEUES Projekt
supabase/migration-pro-nutzer.sql → Umstellung eines bestehenden Projekts (Stand vor v7)
supabase/dateien.sql        → Tabellen und Speicher für die Seite /files/ (einmal ausführen)
supabase/listen.sql         → Tabellen für die Seite /lists/ (einmal ausführen)
supabase/add-user.sql       → Anleitung: neuen Nutzer anlegen
```

## Jeder hat seinen eigenen Wochenplan

Termine und Felder gehören dem Konto, mit dem sie angelegt wurden (`user_id`). Die Datenbank liefert jedem Nutzer nur seine eigenen Zeilen, die Dateien liegen im privaten Speicher im Ordner des Nutzers. Ein neues Konto startet mit einem leeren Plan. Eine Freigabe pro Konto ist nicht mehr nötig.

## Dokumente in Terminen

Zusätzlich zu Bildern, Videos und Links lassen sich **PDF, Word (.docx) und TXT** anhängen (max. 50 MB pro Datei).

- Dokumente sind nur zum Ansehen, nicht bearbeitbar.
- Die Kachel hat dieselbe Grösse wie Bilder und Videos und zeigt den Anfang des Dokuments.
- Ist das Dokument länger, erscheint «Vergrössern»: Ein Klick öffnet die ganze Ansicht (PDF seitenweise, Word mit Überschriften, Listen und Tabellen).
- Alte Word-Dateien (.doc) werden angehängt, können aber nicht angezeigt werden, nur herunterladen.
- Die Anzeige läuft komplett im Browser.

## Links in Terminen

Im Feld «Link einfügen» geht jede Webadresse, auch ohne `https://` (z. B. `plex.tv`, `github.com/...`, SharePoint-Links).

- **YouTube / Vimeo:** werden als Video eingebettet.
- **Bilder und Videos:** werden erkannt und direkt angezeigt, auch ohne Dateiendung (z. B. Google-Bildlinks). Der Browser probiert dazu aus, was die Adresse liefert.
- **Alle anderen Seiten** (GitHub, SharePoint, Plex, ...): erscheinen als Karte mit Name und Adresse, ein Klick auf «Öffnen» öffnet sie in einem neuen Tab. Einbetten geht bei diesen Seiten nicht, weil sie das aus Sicherheitsgründen verbieten.
- Nicht erlaubt sind Adressen mit anderen Protokollen (`javascript:`, `ftp:` ...) oder mit Passwort in der Adresse.
- Ein Bildlink, der später nicht mehr lädt, wird automatisch als Link-Karte angezeigt.

## Dateien (`/files/`)

Eigene Dateiverwaltung: beliebige Dateien (Code, Dokumente, Bilder, Videos, Audio, Archive …) hochladen, ansehen, herunterladen, ordnen und löschen. Jedes Konto sieht nur die eigenen Dateien.

**Einrichten (einmalig):** `supabase/dateien.sql` im Supabase SQL Editor ausführen. Das legt die Tabellen `file_folders` und `files` sowie den privaten Speicher `user-files` an.

- **Hochladen:** Knopf «Hochladen» (Dateien oder ganze Ordner), oder Dateien und Ordner aufs Fenster ziehen. Mehrere Uploads laufen gleichzeitig, mit Fortschritt, «Erneut» bei Fehlern. Gleiche Namen werden zu `name (2).ext`.
- **Ordner:** neuer Ordner, Verschieben per Ziehen (auf Ordner, Pfad oder «Alle Dateien») oder über «Verschieben …».
- **Ansicht:** Liste oder Raster, sortieren nach Name, Grösse, Datum. Links: Alle Dateien, Bilder, Videos, Audio, Dokumente, Code, Archive, Markiert, Papierkorb. Suche nach Namen.
- **Vorschau:** Klick auf den Namen. Bilder, Video, Audio, PDF, Word (.docx), TXT und Code/Text (bis 2 MB), mit Pfeiltasten zur nächsten Datei.
- **Herunterladen:** einzelne Datei direkt, mehrere Dateien oder Ordner als ZIP (zusammen bis 600 MB, der ZIP wird im Browser gebaut).
- **Löschen:** kommt zuerst in den Papierkorb (mit «Rückgängig»). Endgültig löschen und «Papierkorb leeren» fragen nach und entfernen auch die Datei im Speicher.
- **Teilen:** «Link teilen …» erzeugt einen Link für 1 Stunde bis 30 Tage. Wer ihn hat, kann die Datei ohne Anmeldung öffnen. Ein Link lässt sich vor Ablauf nicht zurückziehen.
- Tastatur: Strg+A alles auswählen, Entf löschen, F2 umbenennen, Enter öffnen, Pfeile bewegen.
- **Grenzen (Free-Tier):** 50 MB pro Datei, 1 GB Speicher insgesamt. Dieser Speicher wird mit den Anhängen des Wochenplans geteilt. Die Anzeige links unten zeigt den belegten Platz.

## Listen (`/lists/`)

Beliebig viele Listen anlegen (To-Do, Bücher, Filme & Serien, Einkauf oder eigene), darin Einträge hinzufügen, bearbeiten und löschen. Jedes Konto sieht nur die eigenen Listen.

**Einrichten (einmalig):** `supabase/listen.sql` im Supabase SQL Editor ausführen (legt `lists` und `list_items` an).

- **Neue Liste:** «Neue Liste», Name, Art, Symbol und Farbe wählen. Die Art bestimmt, welche Felder und Bezeichnungen der Dialog zeigt (z. B. «Autor» bei Büchern, «Fällig am» bei To-Do, «Geschäft» beim Einkauf). «Allgemein» zeigt alle Felder.
- **Felder pro Eintrag:** Titel, Zusatz (Autor, Regie, Menge), Beschreibung, Datum, Uhrzeit, Ort (mit Link zu OpenStreetMap), Link, Bewertung (1–5 Sterne), Wichtigkeit, Status (erledigt, gelesen, gesehen, gekauft). Felder, die in einer Liste nicht vorgesehen sind, erscheinen trotzdem, sobald ein Wert gesetzt ist.
- **Schnell hinzufügen:** Titel oben eintippen und Enter. «Mehr …» öffnet den Eintrag mit allen Feldern.
- **Abhaken:** Klick auf den Kreis. Filter «Offen / Alle / Erledigt», «Erledigte löschen» räumt auf.
- **Sortieren:** eigene Reihenfolge (Einträge per Ziehen umordnen, am Computer), Datum, Titel, Wichtigkeit, Bewertung, zuletzt hinzugefügt.
- **Anstehend:** zeigt alle offenen Einträge mit Datum aus allen Listen, gruppiert in Überfällig, Heute, Morgen, nächste 7 Tage, Später.
- **Suche:** oben, durchsucht Titel, Zusatz, Beschreibung und Ort in allen Listen.
- Löschen eines Eintrags: ohne Rückfrage, mit «Rückgängig». Eine ganze Liste löschen fragt nach.
- Tastatur: Pfeile bewegen, Enter öffnet, Leertaste hakt ab, Entf löscht.

## Dashboard: neue Seite oder Projekt hinzufügen

In `dashboard/index.html` steht im Bereich «Anwendungen» ein auskommentiertes Beispiel. Eine Zeile kopieren, anpassen, fertig:

```html
<a class="nav-item app" href="../projekt1/" data-desc="Kurze Beschreibung"><span class="ico">📁</span>Projekt 1</a>
```

Der Eintrag erscheint links in der Navigation und automatisch als Karte auf der Übersicht.

## Anzeigename

Beim ersten Login fragt das Dashboard nach einem Anzeigenamen. Man kann ihn überspringen und jederzeit unter Einstellungen ändern. Er wird im Konto bei Supabase gespeichert und gilt auf allen Geräten. Der Login-Name bleibt immer gleich.

## Wie das Login funktioniert

- Anmeldung mit **E-Mail-Adresse + Passwort** über Supabase Auth. Für Adressen `@graftastisch.app` genügt der Teil vor dem `@`.
- Wer eine geschützte Seite ohne Sitzung öffnet, landet bei `/login/` und kommt nach der Anmeldung zurück (sonst zum Dashboard).
- Die Sitzung liegt im `localStorage` und gilt für **alle Seiten** der Website.
- Eine weitere Seite schützt man mit drei Zeilen im `<head>`:

```html
<script src="../assets/config.js"></script>
<script src="../assets/auth.js"></script>
<script>Auth.guard('../login/');</script>
```

## Neuen Nutzer anlegen

Supabase-Dashboard → Authentication → Users → Add user → Create new user. E-Mail und Passwort wählen, **Auto Confirm User** einschalten. Fertig, das Konto hat sofort seinen eigenen Plan (Details: `supabase/add-user.sql`).

## Sicherheit

- **Wichtig:** Im Supabase-Dashboard unter Authentication → Sign In / Providers **«Allow new users to sign up»** ausschalten. Sonst könnte sich jeder mit dem öffentlichen Schlüssel ein eigenes Konto anlegen und Speicherplatz belegen. Konten legst du dann nur noch selbst an.
- Tabellen und Speicher (`plan-media`, privat) sind nur für angemeldete Konten und nur für die eigenen Daten zugänglich. Dateien werden über zeitlich begrenzte, signierte Links geladen.
- Der Schlüssel in `assets/config.js` ist der öffentliche `anon`-Schlüssel. Der `service_role`-Schlüssel gehört nie in die Website.
- Beim Abmelden wird der lokale Zwischenspeicher gelöscht. Der Zwischenspeicher eines anderen Kontos wird nie angezeigt.
- Auf `github.io` teilen sich alle Projekte desselben Kontos den `localStorage`-Ursprung. Der Schlüssel `graftastisch-session` ist deshalb nur für diese Website gedacht.
- Free-Tier: Supabase pausiert das Projekt nach 7 Tagen ohne Aktivität (im Dashboard wieder aktivierbar). Dateien sind auf 50 MB begrenzt, der Speicher auf 1 GB.

## Ohne Supabase

Sind URL und Schlüssel in `assets/config.js` leer, läuft der Plan nur lokal im Browser, ohne Login und ohne Sync.
