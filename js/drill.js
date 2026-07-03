/**
 * Ideogramm-Drill Modul
 * Announces random RV target categories via speech synthesis (or vibration).
 */

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
  // Defaults
  return {
    minInterval: 5,
    maxInterval: 15,
    useVibration: false,
    categories: Object.fromEntries(CATEGORIES.map(c => [c.id, true])),
  };
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// --- Speech API helpers ---
let germanVoice = null;
let voicesReady = false;

function loadVoices() {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    germanVoice = voices.find(v => v.lang.startsWith('de')) || voices[0];
    voicesReady = true;
  }
}

// Voices load asynchronously on iOS
if ('speechSynthesis' in window) {
  window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
  loadVoices(); // Try synchronous too (works on some browsers)
}

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.9;
  utterance.pitch = 1;
  utterance.volume = 1;
  // Re-try voice assignment in case it loaded late
  if (!voicesReady) loadVoices();
  if (germanVoice) utterance.voice = germanVoice;
  window.speechSynthesis.speak(utterance);
}

function vibrate(pattern) {
  if ('vibrate' in navigator) {
    navigator.vibrate(pattern);
  }
}

function unlockSpeechAPI() {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance('');
  u.volume = 0;
  window.speechSynthesis.speak(u);
}

// --- Module state ---
let drillState = {
  running: false,
  counter: 0,
  timeoutId: null,
  settings: null,
};

function getEnabledCategories() {
  return CATEGORIES.filter(c => drillState.settings.categories[c.id] !== false);
}

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

function announceNext() {
  const enabled = getEnabledCategories();
  if (enabled.length < 2) {
    stopDrill();
    showWarning(true);
    return;
  }

  const category = enabled[Math.floor(Math.random() * enabled.length)];
  drillState.counter++;

  // Update UI
  const display = document.getElementById('drill-category-display');
  const counter = document.getElementById('drill-counter');
  if (display) {
    display.textContent = category.label;
    display.classList.add('pulsing');
    setTimeout(() => display.classList.remove('pulsing'), 800);
  }
  if (counter) counter.textContent = drillState.counter;

  // Announce
  const { useVibration, minInterval, maxInterval } = drillState.settings;
  if (useVibration) {
    vibrate([200, 100, 200]);
  } else {
    speak(category.label);
  }

  // Schedule next
  const delay = randomBetween(minInterval, maxInterval) * 1000;
  drillState.timeoutId = setTimeout(announceNext, delay);
}

function startDrill() {
  const enabled = getEnabledCategories();
  if (enabled.length < 2) {
    showWarning(true);
    return;
  }

  showWarning(false);
  drillState.running = true;
  drillState.counter = 0;

  const counter = document.getElementById('drill-counter');
  if (counter) counter.textContent = 0;

  const btn = document.getElementById('drill-start-btn');
  if (btn) btn.textContent = 'Stop';

  const display = document.getElementById('drill-category-display');
  if (display) display.textContent = '—';

  // iOS: unlock speech API on user gesture
  unlockSpeechAPI();

  // Start loop
  announceNext();
}

function stopDrill() {
  drillState.running = false;
  clearTimeout(drillState.timeoutId);
  drillState.timeoutId = null;

  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  if ('vibrate' in navigator) navigator.vibrate(0);

  const btn = document.getElementById('drill-start-btn');
  if (btn) btn.textContent = 'Start';

  const display = document.getElementById('drill-category-display');
  if (display) display.textContent = '—';
}

function showWarning(visible) {
  const el = document.getElementById('drill-warning');
  if (el) el.classList.toggle('visible', visible);
}

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
      showWarning(getEnabledCategories().length < 2);
    });
    container.appendChild(chip);
  });
}

export function initDrill() {
  const container = document.getElementById('view-drill');
  if (!container) return;

  const settings = loadSettings();
  drillState.settings = settings;

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

      <div class="settings-card">
        <h3>Kategorien</h3>
        <div class="category-chips" id="category-chips"></div>

        <h3>Intervall</h3>
        <div class="interval-row">
          <label>
            Min:
            <span id="min-val">${settings.minInterval}</span>s
          </label>
          <input type="range" id="min-interval" min="3" max="30" value="${settings.minInterval}">
          <label>
            Max:
            <span id="max-val">${settings.maxInterval}</span>s
          </label>
          <input type="range" id="max-interval" min="5" max="60" value="${settings.maxInterval}">
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

  // Start/Stop
  document.getElementById('drill-start-btn').addEventListener('click', () => {
    if (drillState.running) {
      stopDrill();
    } else {
      startDrill();
    }
  });

  // Min interval slider
  document.getElementById('min-interval').addEventListener('input', e => {
    const val = parseInt(e.target.value, 10);
    settings.minInterval = val;
    document.getElementById('min-val').textContent = val;
    // Ensure min <= max
    if (val > settings.maxInterval) {
      settings.maxInterval = val;
      document.getElementById('max-interval').value = val;
      document.getElementById('max-val').textContent = val;
    }
    saveSettings(settings);
  });

  // Max interval slider
  document.getElementById('max-interval').addEventListener('input', e => {
    const val = parseInt(e.target.value, 10);
    settings.maxInterval = val;
    document.getElementById('max-val').textContent = val;
    // Ensure max >= min
    if (val < settings.minInterval) {
      settings.minInterval = val;
      document.getElementById('min-interval').value = val;
      document.getElementById('min-val').textContent = val;
    }
    saveSettings(settings);
  });

  // Vibration toggle
  document.getElementById('vibration-toggle').addEventListener('change', e => {
    settings.useVibration = e.target.checked;
    saveSettings(settings);
  });
}
