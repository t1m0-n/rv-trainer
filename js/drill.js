/**
 * Ideogramm-Drill Modul
 * Announces random RV target categories via speech synthesis (or vibration).
 * Logs every announcement; after stop the log can be saved as a drill session.
 */

import { showToast } from './toast.js';
import { acquireWakeLock, releaseWakeLock } from './wakelock.js';

const CATEGORIES = [
  { id: 'land',       label: 'Land' },
  { id: 'wasser',     label: 'Wasser' },
  { id: 'struktur',   label: 'Struktur' },
  { id: 'berg',       label: 'Berg' },
  { id: 'lebensform', label: 'Lebensform' },
  { id: 'energie',    label: 'Bewegung / Energie' },
];

const SETTINGS_KEY = 'drill.settings';

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return {
    minInterval: 5,
    maxInterval: 15,
    useVibration: false,
    categories: Object.fromEntries(CATEGORIES.map(c => [c.id, true])),
  };
}

function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function generateId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ── Speech API ────────────────────────────────────────────────────────

let germanVoice = null;
let voicesReady = false;

function loadVoices() {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    germanVoice = voices.find(v => v.lang.startsWith('de')) || voices[0];
    voicesReady = true;
  }
}

if ('speechSynthesis' in window) {
  window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
  loadVoices();
}

/** Spricht den Text und gibt ein Promise zurück, das nach Abschluss resolved. */
function speakAndWait(text) {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window)) { resolve(); return; }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.9; u.pitch = 1; u.volume = 1;
    if (!voicesReady) loadVoices();
    if (germanVoice) u.voice = germanVoice;
    u.onend   = resolve;
    u.onerror = resolve;  // im Fehlerfall nicht einfrieren
    window.speechSynthesis.speak(u);
  });
}

function vibrate(pattern) {
  if ('vibrate' in navigator) navigator.vibrate(pattern);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function unlockSpeechAPI() {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance('');
  u.volume = 0;
  window.speechSynthesis.speak(u);
  // Sofort abbrechen — wir wollen nur die API entsperren, nicht warten
  setTimeout(() => window.speechSynthesis.cancel(), 50);
}

// ── Module state ──────────────────────────────────────────────────────

let state = {
  running: false,
  phase: 'idle',        // 'idle' | 'running' | 'done'
  counter: 0,
  timeoutId: null,
  settings: null,
  log: [],              // { nr, label, timestamp }
  sessionStartedAt: null,
  notePhotos: [],       // Blobs accumulated after stop
  bag: [],              // Shuffled-Bag: verbleibende Kategorien dieser Runde
  lastLabel: null,      // letzte angesagte Kategorie (für Anti-Wiederholung)
};

let journalStore = null;  // injected by initDrill

// ── Shuffled-Bag ──────────────────────────────────────────────────────
// Jede aktive Kategorie kommt gleich oft dran; maximal 2 gleiche in Folge
// über Rundengrenze hinweg.

function shuffle(arr) {
  // Fisher-Yates in-place
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function refillBag(enabled, lastLabel) {
  const bag = shuffle([...enabled]);
  // Erste Karte darf nicht gleich der letzten der Vorrunde sein
  if (lastLabel && bag.length > 1 && bag[0].label === lastLabel) {
    // Tausche mit einer zufälligen anderen Position
    const swapIdx = 1 + Math.floor(Math.random() * (bag.length - 1));
    [bag[0], bag[swapIdx]] = [bag[swapIdx], bag[0]];
  }
  return bag;
}

// ── Core drill logic ──────────────────────────────────────────────────

function getEnabled() {
  return CATEGORIES.filter(c => state.settings.categories[c.id] !== false);
}

async function announceNext() {
  if (!state.running) return;

  const enabled = getEnabled();
  if (enabled.length < 2) { stopDrill(); showWarning(true); return; }

  // Bag leer oder Kategorienauswahl hat sich geändert → neu befüllen
  if (state.bag.length === 0 ||
      state.bag.some(c => !enabled.find(e => e.id === c.id))) {
    state.bag = refillBag(enabled, state.lastLabel);
  }

  const cat = state.bag.shift();
  state.lastLabel = cat.label;
  state.counter++;
  state.log.push({ nr: state.counter, label: cat.label, timestamp: new Date().toISOString() });

  // UI aktualisieren
  const display = document.getElementById('drill-category-display');
  const counterEl = document.getElementById('drill-counter');
  if (display) {
    display.textContent = cat.label;
    display.classList.add('pulsing');
    setTimeout(() => display.classList.remove('pulsing'), 800);
  }
  if (counterEl) counterEl.textContent = state.counter;

  const { useVibration, minInterval, maxInterval } = state.settings;

  // Ansage abspielen und auf Abschluss warten → kein Überlappen möglich
  if (useVibration) {
    vibrate([200, 100, 200]);
    await sleep(500);        // Vibrationsdauer abwarten
  } else {
    await speakAndWait(cat.label);
  }

  if (!state.running) return;  // wurde während Ansage gestoppt?

  // Intervall-Pause NACH Ende der Ansage
  const delay = (Math.random() * (maxInterval - minInterval) + minInterval) * 1000;
  state.timeoutId = setTimeout(announceNext, delay);
}

function startDrill() {
  const enabled = getEnabled();
  if (enabled.length < 2) { showWarning(true); return; }

  showWarning(false);
  state.running = true;
  state.phase = 'running';
  state.counter = 0;
  state.log = [];
  state.notePhotos = [];
  state.sessionStartedAt = new Date().toISOString();
  state.bag = [];
  state.lastLabel = null;

  document.getElementById('drill-counter').textContent = 0;
  document.getElementById('drill-start-btn').textContent = 'Stop';

  const display = document.getElementById('drill-category-display');
  if (display) display.textContent = '—';

  // Hide settings while running
  document.querySelector('.settings-card')?.classList.add('hidden');
  document.getElementById('drill-done-section')?.classList.add('hidden');

  acquireWakeLock();
  unlockSpeechAPI();
  announceNext();
}

function stopDrill() {
  state.running = false;
  state.phase = 'done';
  clearTimeout(state.timeoutId);
  state.timeoutId = null;

  releaseWakeLock();
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  if ('vibrate' in navigator) navigator.vibrate(0);

  document.getElementById('drill-start-btn').textContent = 'Neue Runde';

  // Show done section, hide settings
  document.querySelector('.settings-card')?.classList.add('hidden');
  renderDoneSection();
  document.getElementById('drill-done-section')?.classList.remove('hidden');
}

function resetDrill() {
  state.phase = 'idle';
  state.counter = 0;
  state.log = [];
  state.notePhotos = [];
  state.sessionStartedAt = null;

  document.getElementById('drill-counter').textContent = 0;
  document.getElementById('drill-start-btn').textContent = 'Start';

  const display = document.getElementById('drill-category-display');
  if (display) display.textContent = '—';

  document.querySelector('.settings-card')?.classList.remove('hidden');
  document.getElementById('drill-done-section')?.classList.add('hidden');
}

function showWarning(visible) {
  document.getElementById('drill-warning')?.classList.toggle('visible', visible);
}

// ── Done-Section: Protokoll + Speichern ───────────────────────────────

function renderDoneSection() {
  const section = document.getElementById('drill-done-section');
  if (!section) return;

  const endedAt = new Date();
  const startedAt = new Date(state.sessionStartedAt);
  const durationSec = Math.round((endedAt - startedAt) / 1000);
  const durationStr = durationSec < 60
    ? `${durationSec}s`
    : `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`;

  const logRows = state.log.map(entry => {
    const t = new Date(entry.timestamp);
    const ts = t.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `<div class="drill-log-row">
      <span class="drill-log-nr">${entry.nr}.</span>
      <span class="drill-log-label">${entry.label}</span>
      <span class="drill-log-time">${ts}</span>
    </div>`;
  }).join('');

  section.innerHTML = `
    <div class="drill-log-card card">
      <div class="drill-log-header">
        <span>${state.log.length} Ansagen · ${durationStr}</span>
        <span style="color:var(--text-muted);font-size:12px">${startedAt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <div class="drill-log-list" id="drill-log-list">${logRows || '<span style="color:var(--text-muted);font-size:13px">Keine Ansagen protokolliert.</span>'}</div>
    </div>

    <div class="card" style="margin-top:10px" id="drill-photo-card">
      <div class="modal-label">Foto des Kritzel-Blatts (optional)</div>
      <div class="photo-grid" id="drill-photo-grid"></div>
      <label class="photo-upload-label" style="margin-top:8px">
        📷 Foto aufnehmen
        <input type="file" accept="image/*" capture="environment" multiple id="drill-photo-input">
      </label>
    </div>

    <button id="drill-save-btn" class="btn-primary btn-large">💾 Im Journal speichern</button>
  `;

  // Photo input
  section.querySelector('#drill-photo-input').addEventListener('change', async e => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    const blobs = await Promise.all(files.map(f =>
      f.arrayBuffer().then(buf => new Blob([buf], { type: f.type }))
    ));
    state.notePhotos.push(...blobs);
    renderPhotoGrid();
    showToast(`${files.length} Foto(s) hinzugefügt`, 'success');
  });

  // Save button
  section.querySelector('#drill-save-btn').addEventListener('click', saveDrillSession);
}

function renderPhotoGrid() {
  const grid = document.getElementById('drill-photo-grid');
  if (!grid) return;
  grid.innerHTML = state.notePhotos.map((b, i) => {
    const url = URL.createObjectURL(b);
    return `<img class="photo-thumb" src="${url}" alt="Foto ${i+1}">`;
  }).join('');
}

async function saveDrillSession() {
  if (!journalStore) { showToast('Journal nicht verfügbar', 'error'); return; }

  const btn = document.getElementById('drill-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Wird gespeichert…'; }

  try {
    const endedAt = new Date().toISOString();
    const durationSec = Math.round(
      (new Date(endedAt) - new Date(state.sessionStartedAt)) / 1000
    );

    await journalStore.saveSession({
      id: generateId(),
      type: 'drill',
      coordinate: null,
      startedAt: state.sessionStartedAt,
      endedAt,
      durationSeconds: durationSec,
      score: 0,
      notes: null,
      targetBlob: null,
      targetMetadata: null,
      notePhotos: [...state.notePhotos],
      drillLog: [...state.log],
      drillSettings: { ...state.settings },
    });

    showToast('Drill-Session gespeichert ✓', 'success');

    // Replace done section with confirmation
    const section = document.getElementById('drill-done-section');
    if (section) {
      section.innerHTML = `
        <div class="saved-message" style="font-size:18px">✓ Gespeichert</div>
        <button id="drill-reset-btn" class="btn-secondary btn-large">Neue Runde</button>
      `;
      section.querySelector('#drill-reset-btn').addEventListener('click', resetDrill);
    }
  } catch (err) {
    showToast(`Fehler: ${err.message}`, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '💾 Im Journal speichern'; }
  }
}

// ── Chip-Rendering ────────────────────────────────────────────────────

function renderChips(settings) {
  const container = document.getElementById('category-chips');
  if (!container) return;
  container.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (settings.categories[cat.id] !== false ? ' active' : '');
    chip.textContent = cat.label;
    chip.addEventListener('click', () => {
      settings.categories[cat.id] = !settings.categories[cat.id];
      chip.classList.toggle('active', settings.categories[cat.id]);
      saveSettings(settings);
      showWarning(getEnabled().length < 2);
    });
    container.appendChild(chip);
  });
}

// ── Init ──────────────────────────────────────────────────────────────

export function initDrill(store) {
  journalStore = store;

  const container = document.getElementById('view-drill');
  if (!container) return;

  const settings = loadSettings();
  state.settings = settings;

  container.innerHTML = `
    <div class="drill-container">
      <h1 class="screen-title">Ideogramm-Drill</h1>

      <div class="current-category" id="drill-category-display">—</div>

      <div class="counter-display">
        <span id="drill-counter">0</span> Ansagen
      </div>

      <button id="drill-start-btn" class="btn-primary btn-large">Start</button>

      <div id="drill-warning" class="drill-warning">
        Mindestens 2 Kategorien müssen aktiviert sein.
      </div>

      <!-- Protokoll + Speichern (nach Stop) -->
      <div id="drill-done-section" class="hidden"></div>

      <div class="settings-card">
        <h3>Kategorien</h3>
        <div class="category-chips" id="category-chips"></div>

        <h3>Intervall <span style="font-weight:400;color:var(--text-muted)">(nach Ende der Ansage)</span></h3>
        <div class="interval-row">
          <label>Min: <span id="min-val">${settings.minInterval}</span>s</label>
          <input type="range" id="min-interval" min="2" max="30" step="0.5" value="${settings.minInterval}">
          <label>Max: <span id="max-val">${settings.maxInterval}</span>s</label>
          <input type="range" id="max-interval" min="2" max="60" step="0.5" value="${settings.maxInterval}">
        </div>

        <h3>Ausgabe</h3>
        <label class="toggle-row">
          <span>Vibration statt Sprache</span>
          <input type="checkbox" id="vibration-toggle" ${settings.useVibration ? 'checked' : ''}>
        </label>
      </div>
    </div>
  `;

  renderChips(settings);

  // Start / Stop / Neue Runde
  document.getElementById('drill-start-btn').addEventListener('click', () => {
    if (state.phase === 'idle') startDrill();
    else if (state.phase === 'running') stopDrill();
    else if (state.phase === 'done') resetDrill();
  });

  function fmtSec(v) {
    // "2" statt "2.0", "2.5" statt "2.50"
    return parseFloat(v).toString();
  }

  // Min slider
  document.getElementById('min-interval').addEventListener('input', e => {
    const val = parseFloat(e.target.value);
    settings.minInterval = val;
    document.getElementById('min-val').textContent = fmtSec(val);
    if (val > settings.maxInterval) {
      settings.maxInterval = val;
      document.getElementById('max-interval').value = val;
      document.getElementById('max-val').textContent = fmtSec(val);
    }
    saveSettings(settings);
  });

  // Max slider
  document.getElementById('max-interval').addEventListener('input', e => {
    const val = parseFloat(e.target.value);
    settings.maxInterval = val;
    document.getElementById('max-val').textContent = fmtSec(val);
    if (val < settings.minInterval) {
      settings.minInterval = val;
      document.getElementById('min-interval').value = val;
      document.getElementById('min-val').textContent = fmtSec(val);
    }
    saveSettings(settings);
  });

  // Vibration toggle
  document.getElementById('vibration-toggle').addEventListener('change', e => {
    settings.useVibration = e.target.checked;
    saveSettings(settings);
  });
}
