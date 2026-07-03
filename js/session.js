/**
 * RV Session Modul
 * Phases: idle → active → reveal → saved
 */

import { showToast } from './toast.js';
import { acquireWakeLock, releaseWakeLock } from './wakelock.js';

const SCORE_LABELS = [
  '0 – Kein Treffer',
  '1 – Kaum',
  '2 – Ansatzweise',
  '3 – Teilweise',
  '4 – Gut',
  '5 – Exzellent',
];

function generateCoordinate() {
  const part1 = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  const part2 = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `${part1}-${part2}`;
}

function generateId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function formatTimer(seconds) {
  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function formatDateTime(isoString) {
  const d = new Date(isoString);
  return d.toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function initSession(targetProvider, journalStore) {
  const container = document.getElementById('view-session');
  if (!container) return;

  // ── Module state ──
  let phase = 'idle';
  let coordinate = null;
  let sessionId = null;
  let startedAt = null;
  let timerInterval = null;
  let elapsedSeconds = 0;
  let targetBlobRef = null;   // NEVER create objectURL until reveal
  let targetMetadata = null;
  let currentScore = 0;
  let targetLoadPromise = null;

  // ── Render HTML ──
  container.innerHTML = `
    <div class="session-container">
      <h1 class="screen-title">RV Session</h1>

      <!-- IDLE -->
      <div id="session-idle" class="phase-content">
        <p class="hint-text">Eine neue Session starten</p>
        <button id="session-start-btn" class="btn-primary btn-large">Neue Session</button>
      </div>

      <!-- ACTIVE -->
      <div id="session-active" class="phase-content hidden">
        <div class="coordinate-display" id="session-coordinate"></div>
        <div class="timer-display" id="session-timer">00:00</div>
        <button id="session-end-btn" class="btn-accent btn-large">Session beenden</button>
      </div>

      <!-- REVEAL -->
      <div id="session-reveal" class="phase-content hidden">
        <div class="coordinate-small" id="reveal-coordinate"></div>
        <div class="timer-small" id="reveal-duration"></div>

        <div class="target-image-container" id="target-container">
          <span class="target-loading">Lade Target…</span>
        </div>

        <div class="assessment-section">
          <h3>Wie gut war dein Treffer?</h3>
          <div class="star-rating" id="star-rating"></div>
          <div class="score-label" id="score-label">Keine Bewertung</div>
        </div>

        <div class="notes-section">
          <label for="session-notes">Notizen</label>
          <textarea id="session-notes" rows="4" placeholder="Eindrücke, Wahrnehmungen, Symbole…"></textarea>
        </div>

        <button id="session-save-btn" class="btn-primary btn-large">💾 Speichern</button>
      </div>

      <!-- SAVED -->
      <div id="session-saved" class="phase-content hidden">
        <div class="saved-message">✓ Session gespeichert</div>
        <button id="session-new-btn" class="btn-secondary btn-large">Neue Session</button>
      </div>
    </div>
  `;

  // ── Phase helpers ──
  function showPhase(phaseName) {
    phase = phaseName;
    const phases = ['idle', 'active', 'reveal', 'saved'];
    phases.forEach(p => {
      const el = document.getElementById(`session-${p}`);
      if (el) el.classList.toggle('hidden', p !== phaseName);
    });
  }

  // ── Timer ──
  function startTimer() {
    elapsedSeconds = 0;
    const timerEl = document.getElementById('session-timer');
    if (timerEl) timerEl.textContent = '00:00';
    timerInterval = setInterval(() => {
      elapsedSeconds++;
      if (timerEl) timerEl.textContent = formatTimer(elapsedSeconds);
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  // ── Star Rating ──
  function renderStars() {
    const container = document.getElementById('star-rating');
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i <= 5; i++) {
      const star = document.createElement('span');
      star.className = 'star' + (i <= currentScore && currentScore > 0 ? ' active' : '');
      star.textContent = i === 0 ? '✕' : '⭐';
      star.title = SCORE_LABELS[i];
      star.dataset.score = i;
      star.addEventListener('click', () => {
        currentScore = i;
        updateStars();
        updateScoreLabel();
      });
      container.appendChild(star);
    }
    updateScoreLabel();
  }

  function updateStars() {
    const stars = document.querySelectorAll('#star-rating .star');
    stars.forEach(star => {
      const s = parseInt(star.dataset.score, 10);
      star.classList.toggle('active',
        currentScore > 0 ? s <= currentScore : s === 0
      );
    });
  }

  function updateScoreLabel() {
    const label = document.getElementById('score-label');
    if (label) label.textContent = SCORE_LABELS[currentScore] || 'Keine Bewertung';
  }

  // ── Target image reveal ──
  async function revealTarget() {
    const targetContainer = document.getElementById('target-container');
    if (!targetContainer) return;

    targetContainer.innerHTML = '<span class="target-loading pulsing">Lade Target…</span>';

    try {
      // Wait for pre-fetched blob or fetch now
      const result = await targetLoadPromise;
      targetBlobRef = result.imageBlob;
      targetMetadata = result.metadata;

      // Only NOW create object URL and insert image
      const objectUrl = URL.createObjectURL(targetBlobRef);
      const img = document.createElement('img');
      img.src = objectUrl;
      img.alt = `RV Target ${coordinate}`;
      img.style.width = '100%';
      img.onload = () => {
        // Revoke after rendering to free memory — but keep blob for storage
        // We keep objectUrl alive as long as img is in DOM
      };
      targetContainer.innerHTML = '';
      targetContainer.appendChild(img);
    } catch (err) {
      targetContainer.innerHTML = `<span class="target-loading" style="color:var(--accent)">⚠ ${err.message}</span>`;
    }
  }

  // ── Session Flow ──
  function startSession() {
    coordinate = generateCoordinate();
    sessionId = generateId();
    startedAt = new Date().toISOString();
    currentScore = 0;
    targetBlobRef = null;
    targetMetadata = null;

    // Start fetching target immediately in background — store only blob, no URL
    targetLoadPromise = targetProvider.getTarget(coordinate).catch(err => {
      console.warn('[Session] Background target load failed:', err.message);
      throw err;
    });

    // Show active phase
    const coordEl = document.getElementById('session-coordinate');
    if (coordEl) coordEl.textContent = coordinate;

    showPhase('active');
    startTimer();
    acquireWakeLock();
  }

  async function endSession() {
    stopTimer();
    releaseWakeLock();
    const endedAt = new Date().toISOString();
    const durationSeconds = elapsedSeconds;

    // Update reveal info
    const revealCoord = document.getElementById('reveal-coordinate');
    const revealDuration = document.getElementById('reveal-duration');
    if (revealCoord) revealCoord.textContent = coordinate;
    if (revealDuration) revealDuration.textContent = `Dauer: ${formatDuration(durationSeconds)}`;

    showPhase('reveal');
    renderStars();
    await revealTarget();

    // Attach end metadata to closure for save
    Object.assign(window._sessionEndMeta || {}, { endedAt, durationSeconds });
    window._sessionEndMeta = { endedAt, durationSeconds };
  }

  async function saveSession() {
    const notes = document.getElementById('session-notes')?.value || '';
    const meta = window._sessionEndMeta || {};

    const btn = document.getElementById('session-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Wird gespeichert…'; }

    try {
      await journalStore.saveSession({
        id: sessionId,
        coordinate,
        startedAt,
        endedAt: meta.endedAt || new Date().toISOString(),
        durationSeconds: meta.durationSeconds || elapsedSeconds,
        score: currentScore,
        notes,
        targetBlob: targetBlobRef,
        targetMetadata: targetMetadata || {},
        notePhotos: [],
      });

      showPhase('saved');
    } catch (err) {
      console.error('[Session] Save failed:', err);
      showToast(`Fehler beim Speichern: ${err.message}`, 'error');
      if (btn) { btn.disabled = false; btn.textContent = '💾 Speichern'; }
    }
  }

  function resetToIdle() {
    window._sessionEndMeta = null;
    showPhase('idle');
  }

  // ── Event Listeners ──
  document.getElementById('session-start-btn').addEventListener('click', startSession);
  document.getElementById('session-end-btn').addEventListener('click', endSession);
  document.getElementById('session-save-btn').addEventListener('click', saveSession);
  document.getElementById('session-new-btn').addEventListener('click', resetToIdle);
}
