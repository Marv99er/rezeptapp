# Unsere Rezepte

Kleine PWA zum Sammeln von Rezepten, Planen der Woche und automatischen Erstellen der Einkaufsliste. Läuft auf GitHub Pages, Daten liegen in Supabase (Region Frankfurt, `eu-central-1`).

## Aufbau

| Datei | Inhalt |
|---|---|
| `index.html`, `styles.css` | Oberfläche im Salbei-Design |
| `app.js` | Ansichten, Login, Datenzugriff, Echtzeit-Sync |
| `parse.js` | Zutaten zerlegen, Einkaufsliste zusammenrechnen, Kalorien schätzen, Screenshot-Text aufteilen |
| `config.js` | Supabase-URL und Publishable Key (öffentlich, geschützt durch Login + Row Level Security) |
| `sw.js` | Offline-Cache – bei Änderungen `VERSION` erhöhen |
| `supabase/functions/import-recipe` | Edge Function: liest Rezeptdaten (schema.org/Recipe) aus Links und Pinterest-Pins |

## Gemeinsamer Account

Registrierung gibt es in der App nicht. Den Account legt man im Supabase-Dashboard an:
Authentication → Users → Add user → Create new user (E-Mail + Passwort, „Auto Confirm User“ anhaken).
Unter Authentication → Sign In / Providers „Allow new users to sign up“ ausschalten.

## Auf dem iPhone installieren

Link in Safari öffnen → Teilen → „Zum Home-Bildschirm“. Danach in der installierten App einmal anmelden.

## Kalorien

Grobe Schätzung über eine eingebaute Tabelle gängiger Zutaten (`parse.js`, `KCAL` und `PIECE_G`). Fehlt eine Zutat, zeigt die App an, aus wie vielen Zutaten geschätzt wurde.
