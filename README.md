# Protokoll Recorder (Voice + Notizen -> Protokoll -> Text + PDF)

Diese App ist als **statische Web-App** für GitHub Pages gedacht.  
Die OpenAI-Calls laufen **serverseitig** (Cloudflare Worker oder Vercel Function), damit der API-Key nicht im Browser liegt.

## Features
- Audioaufnahme (optional) + Transkription (optional)
- Notizenfeld
- ChatGPT erstellt ein strukturiertes Protokoll (ohne Emojis, ohne Sternchen, Bulletpoints mit `-`)
- Teilnehmerblock intern ist fix: **Teilnehmer Sika / PCI / SCHÖNOX**
- PDF-Erzeugung im Browser mit pdf-lib (A4, klare Gliederung, Task-Board als Tabelle)

---

## 1) Frontend auf GitHub Pages
1. Repo erstellen, Ordner `public/` als Pages-Root nutzen
2. Inhalte aus `public/` hochladen
3. GitHub Pages aktivieren

App aufrufen, oben **API-URL** eintragen und speichern.

---

## 2) API deployen (Cloudflare Worker - empfohlen)
### Voraussetzungen
- Cloudflare Account + Wrangler CLI

### Setup
In `backend/cloudflare-worker/`:
- `wrangler.toml` anpassen
- Secret setzen:
  - `wrangler secret put OPENAI_API_KEY`

Deploy:
- `wrangler deploy`

Die Worker-URL trägst du in der App oben als **API-URL** ein.

---

## 3) API deployen (Vercel Alternative)
In `backend/vercel/` liegt ein minimalistisches Beispiel.

---

## Output-Format (für PDF Parsing)
Der Server liefert `protocolText` in folgendem Format:
- erste Zeile: Titel
- Teilnehmerblöcke als Überschrift + Bullet-Liste
- Abschnitte als Überschrift + Bullet `- ...`
- Task-Board als Markdown-Tabelle:
  | Aufgabe | Verantwortlich | Status |
  | --- | --- | --- |
  | ... | ... | ... |

