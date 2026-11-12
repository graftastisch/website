# Wochenplan mit Login

Statische Website für GitHub Pages (`https://graftastisch.github.io/website/`).
Die Startseite leitet auf `/dashboard/` weiter. Davor sitzt das Login unter `/login/`, das nur zum Anmelden dient.

## Aufbau

```
index.html            → leitet auf dashboard/ weiter
assets/config.js      → Supabase-URL, öffentlicher Schlüssel, Domain für Nutzernamen
assets/auth.js        → gemeinsames Login-Modul für alle Seiten
login/                → nur Anmeldung
dashboard/            → Navigation, Übersicht, Einstellungen (Anzeigename, Passwort)
plan/                 → der Wochenplan (geschützt)
supabase/schema.sql   → Datenbankschema (für ein neues Projekt)
supabase/add-user.sql → neuen Nutzer freigeben
```

## Dashboard: neue Seite oder Projekt hinzufügen

In `dashboard/index.html` steht im Bereich «Anwendungen» ein auskommentiertes Beispiel. Eine Zeile kopieren, anpassen, fertig:

```html
<a class="nav-item app" href="../projekt1/" data-desc="Kurze Beschreibung"><span class="ico">📁</span>Projekt 1</a>
```

Der Eintrag erscheint links in der Navigation und automatisch als Karte auf der Übersicht.

## Anzeigename

Beim ersten Login fragt das Dashboard nach einem Anzeigenamen. Man kann ihn überspringen und jederzeit unter Einstellungen ändern. Er wird im Konto bei Supabase gespeichert und gilt auf allen Geräten. Der Login-Name bleibt immer gleich.

## Wie das Login funktioniert

- Anmeldung mit **Nutzername + Passwort** über Supabase Auth. Intern wird der Name zu `<name>@graftastisch.app`.
- Wer eine geschützte Seite ohne Sitzung öffnet, landet bei `/login/` und kommt nach der Anmeldung zurück (sonst zum Dashboard).
- Die Sitzung liegt im `localStorage` und gilt für **alle Seiten** der Website.
- Eine weitere Seite schützt man mit drei Zeilen im `<head>`:

```html
<script src="../assets/config.js"></script>
<script src="../assets/auth.js"></script>
<script>Auth.guard('../login/');</script>
```

Ihre Daten sichert man in Supabase mit `public.is_member()` ab (siehe `schema.sql`).

## Neuen Nutzer anlegen

1. Supabase-Dashboard → Authentication → Users → Add user → Create new user.
   E-Mail `<nutzername>@graftastisch.app`, Passwort wählen, **Auto Confirm User** an.
2. Nutzer freigeben: `supabase/add-user.sql` mit dem Namen im SQL-Editor ausführen.
   Ohne Freigabe sieht das Konto keine Daten.

Das Passwort ändert man später selbst unter `/login/`.

## Sicherheit

- Tabellen und der Speicher (`plan-media`, privat) sind nur für angemeldete **und freigegebene** Konten zugänglich. Bilder werden über zeitlich begrenzte, signierte Links geladen.
- Der Schlüssel in `assets/config.js` ist der öffentliche `anon`-Schlüssel. Der `service_role`-Schlüssel gehört nie in die Website.
- Empfehlung: im Dashboard unter Authentication → Sign In / Providers **«Allow new users to sign up»** ausschalten.
- Auf `github.io` teilen sich alle Projekte desselben Kontos den `localStorage`-Ursprung. Der Schlüssel `graftastisch-session` ist deshalb nur für diese Website gedacht.
- Free-Tier: Supabase pausiert das Projekt nach 7 Tagen ohne Aktivität (im Dashboard wieder aktivierbar). Dateien sind auf 50 MB begrenzt.

## Ohne Supabase

Sind URL und Schlüssel in `assets/config.js` leer, läuft der Plan nur lokal im Browser, ohne Login und ohne Sync.
