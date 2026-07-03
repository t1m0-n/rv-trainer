# RV Trainer

Progressive Web App für Remote Viewing Training — offline-fähig, optimiert für iPhone.

## Features

- **Ideogramm-Drill**: Zufällige Kategorie-Ansagen (Sprache oder Vibration) mit konfigurierbarem Intervall
- **RV Sessions**: Koordinaten-basierte Sessions mit Timer, verdecktem Target (Picsum-Fotos), Bewertungssystem (0–5 Sterne)
- **Journal**: Alle Sessions persistent in IndexedDB gespeichert — mit Statistiken, Notizfotos und ZIP-Export
- **PWA / Offline**: Service Worker cached alle App-Assets; funktioniert nach erstem Laden ohne Internet
- **iOS-optimiert**: Safe-Area-Insets, 44px Touch-Targets, Bottom-Nav, Speech API Unlock

## iPhone Installation

1. Safari öffnen → App-URL aufrufen
2. Teilen-Button (☐↑) antippen
3. **„Zum Home-Bildschirm"** wählen
4. Name bestätigen → **Hinzufügen**

Danach startet die App im Vollbild (standalone) ohne Safari-UI.

## Lokale Entwicklung

Beliebiger HTTP-Server im Projektverzeichnis:

```bash
# Python
python3 -m http.server 8080

# Node
npx serve .

# VS Code
# Live Server Extension → "Open with Live Server"
```

Dann `http://localhost:8080` im Browser öffnen.

**Wichtig**: Direkt als `file://` öffnen funktioniert nicht (ES Modules + Service Worker benötigen HTTP/HTTPS).

## Icons generieren

```bash
python3 scripts/generate-icons.py
```

Erstellt `icons/icon-192.png`, `icons/icon-512.png`, `icons/apple-touch-icon.png`.  
Benötigt Python 3, keine externen Abhängigkeiten.

## GitHub Pages Deployment

Der Workflow `.github/workflows/pages.yml` deployed automatisch auf GitHub Pages bei jedem Push auf `main`:

1. Icons werden per Python-Script generiert
2. Alle Dateien werden als Pages-Artifact hochgeladen
3. App ist unter `https://<user>.github.io/rv-trainer/` verfügbar

## Architektur

### TargetProvider (js/target-provider.js)
Abstrakte Klasse — aktuell: `PicsumProvider` (deterministisch via Koordinaten-Seed).  
Später austauschbar gegen server-seitige Provider mit echten RV-Targets.

```
TargetProvider
  └── PicsumProvider    (aktuell aktiv)
  └── ServerProvider    (zukünftig)
```

### JournalStore (js/journal-store.js)
Abstrakte Klasse — aktuell: `IndexedDBStore`.  
Speichert Blobs direkt in IndexedDB (kein Base64-Overhead).

```
JournalStore
  └── IndexedDBStore    (aktuell aktiv)
```

### Module
| Datei | Funktion |
|---|---|
| `js/app.js` | Bootstrap, Service Worker, Navigation |
| `js/drill.js` | Ideogramm-Drill (Speech/Vibration) |
| `js/session.js` | Session-Flow (idle → active → reveal → saved) |
| `js/journal.js` | Sessionliste, Statistiken, ZIP-Export |
| `js/toast.js` | Geteiltes Toast-Notification-System |
| `js/target-provider.js` | TargetProvider-Interface + PicsumProvider |
| `js/journal-store.js` | JournalStore-Interface + IndexedDBStore |

## Technologie

- Vanilla JS (ES Modules, kein Build-Tool)
- CSS Custom Properties, kein Framework
- IndexedDB für Blob-Speicherung
- Web Speech API für Drill-Ansagen
- Service Worker (Cache-first)
- JSZip (CDN) für ZIP-Export
