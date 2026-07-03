/**
 * ARV – Associative Remote Viewing Modus
 *
 * Trial lifecycle: setup → session_done → judged → resolved
 *
 * Sicherheitsmodell:
 *   - Bild-Zuordnung (A↔Ausgang) wird mit AES-GCM verschlüsselt
 *   - Schlüssel in localStorage unter _k_{trialId} (NICHT in IndexedDB)
 *   - Bilder als Blobs in IndexedDB (binär, nicht trivial interpretierbar)
 *   - Entschlüsselung nur bei Auflösung, danach Schlüssel gelöscht
 *   - Nach Auflösung: nur das korrekte Bild bleibt, das andere wird gelöscht
 */

import { showToast } from './toast.js';

// ── Konstanten ────────────────────────────────────────────────────────

const STATUS_LABELS = {
  setup:        { text: 'Bereit',      cls: 'badge-setup' },
  session_done: { text: 'Session ✓',   cls: 'badge-session' },
  judged:       { text: 'Versiegelt',  cls: 'badge-judged' },
  resolved:     { text: 'Aufgelöst',   cls: 'badge-resolved' },
};

// ── Utils ─────────────────────────────────────────────────────────────

function generateId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function generateCoordinate() {
  const p1 = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  const p2 = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `${p1}-${p2}`;
}

function formatDate(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatTimer(seconds) {
  if (!seconds && seconds !== 0) return '—';
  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// ── Krypto ────────────────────────────────────────────────────────────

async function generateAesKey() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

async function storeKeyLocally(key, trialId) {
  const raw = await crypto.subtle.exportKey('raw', key);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(raw)));
  localStorage.setItem(`_k_${trialId}`, b64);
}

async function loadKeyLocally(trialId) {
  const b64 = localStorage.getItem(`_k_${trialId}`);
  if (!b64) throw new Error('Verschlüsselungsschlüssel nicht gefunden – wurde die App neu installiert?');
  const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
}

function eraseKeyLocally(trialId) {
  localStorage.removeItem(`_k_${trialId}`);
}

async function encryptAssignment(assignment, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(assignment));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { encrypted, iv };
}

async function decryptAssignment(encryptedAb, ivData, trialId) {
  const key = await loadKeyLocally(trialId);
  const iv = ivData instanceof Uint8Array ? ivData : new Uint8Array(ivData);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encryptedAb);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

// ── Blob → Base64 (für Anthropic API) ────────────────────────────────

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ── Anthropic API – Judging ───────────────────────────────────────────

async function judgeWithClaude(imageABlob, imageBBlob, notePhotos, apiKey) {
  const [b64A, b64B] = await Promise.all([
    blobToBase64(imageABlob),
    blobToBase64(imageBBlob),
  ]);

  const content = [
    { type: 'text', text: 'Hier sind zwei mögliche Zielbilder. Bild A:' },
    { type: 'image', source: { type: 'base64', media_type: imageABlob.type || 'image/jpeg', data: b64A } },
    { type: 'text', text: 'Bild B:' },
    { type: 'image', source: { type: 'base64', media_type: imageBBlob.type || 'image/jpeg', data: b64B } },
  ];

  if (notePhotos && notePhotos.length > 0) {
    content.push({ type: 'text', text: `Handschriftliche RV-Notizen/Skizzen des Viewers (${notePhotos.length} Foto(s)):` });
    for (const blob of notePhotos) {
      const b64 = await blobToBase64(blob);
      content.push({ type: 'image', source: { type: 'base64', media_type: blob.type || 'image/jpeg', data: b64 } });
    }
  } else {
    content.push({ type: 'text', text: 'Es liegen keine Notizfotos vor.' });
  }

  content.push({
    type: 'text',
    text: `Analysiere welches Bild (A oder B) besser zu den Notizen/Skizzen passt.
Berücksichtige: visuelle Elemente, Texturen, Farben, Formen, Stimmung und beschriebene Eindrücke.
Antworte NUR mit diesem JSON (kein weiterer Text):
{"pickedImage":"A","confidence":"mittel","reasoning":"Kurze Begründung auf Deutsch"}`,
  });

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      system: `Du bist ein unparteiischer Richter für Associative Remote Viewing (ARV).
Vergleiche Remote-Viewing-Notizen mit zwei Zielbildern und bestimme, welches besser zu den Wahrnehmungen passt.
Sei objektiv. Antworte NUR mit gültigem JSON:
{"pickedImage":"A or B","confidence":"niedrig or mittel or hoch","reasoning":"Begründung auf Deutsch"}`,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Anthropic API Fehler (${resp.status})${errText ? ': ' + errText.slice(0, 200) : ''}`);
  }

  const data = await resp.json();
  const text = data.content?.[0]?.text || '';

  // Robustes JSON-Parsing: suche erstes {...}
  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error(`Unerwartetes KI-Antwortformat: ${text.slice(0, 100)}`);

  const result = JSON.parse(match[0]);
  if (!['A', 'B'].includes(result.pickedImage)) throw new Error('Ungültige Bildauswahl in KI-Antwort');
  if (!['niedrig', 'mittel', 'hoch'].includes(result.confidence)) result.confidence = 'mittel';

  return { pickedImage: result.pickedImage, confidence: result.confidence, reasoning: result.reasoning || '' };
}

// ── Binomialtest ──────────────────────────────────────────────────────

function computeArvStats(trials) {
  const resolved = trials.filter(t => t.status === 'resolved' && t.hit !== null);
  const resolvedCount = resolved.length;
  const hits = resolved.filter(t => t.hit).length;
  const hitRate = resolvedCount > 0 ? (hits / resolvedCount * 100).toFixed(1) : null;

  const byConf = { niedrig: { n: 0, hits: 0 }, mittel: { n: 0, hits: 0 }, hoch: { n: 0, hits: 0 } };
  for (const t of resolved) {
    const c = t.judgeResult?.confidence || 'mittel';
    if (byConf[c]) { byConf[c].n++; if (t.hit) byConf[c].hits++; }
  }

  let pValue = null;
  if (resolvedCount >= 1) {
    // Exakter Binomialtest, zwei-seitig (p=0.5)
    function logFac(n) { let r = 0; for (let i = 2; i <= n; i++) r += Math.log(i); return r; }
    function binom(n, k) { return Math.exp(logFac(n) - logFac(k) - logFac(n - k) + k * Math.log(0.5) + (n - k) * Math.log(0.5)); }
    let oneSided = 0;
    const observed = hits;
    const expected = resolvedCount / 2;
    // Schwanzwahrscheinlichkeit: extreme wie observed oder extremer
    for (let i = (observed >= expected ? observed : 0); i <= (observed >= expected ? resolvedCount : observed); i++) {
      oneSided += binom(resolvedCount, i);
    }
    pValue = Math.min(1, 2 * oneSided);
  }

  return { total: trials.length, resolvedCount, hits, hitRate, pValue, byConf };
}

// ── Haupt-Modul ───────────────────────────────────────────────────────

export function initArv(targetProvider, store) {
  const container = document.getElementById('view-arv');
  if (!container) return;

  let trials = [];
  let currentTrial = null;
  let sessionActive = false;
  let sessionElapsed = 0;
  let sessionStartedAt = null;
  let sessionTimerRef = null;
  let photoObjectUrls = [];  // track for cleanup

  // ── Shell ─────────────────────────────────────────────────────────

  container.innerHTML = `
    <div class="arv-container">
      <div id="arv-list-view"></div>
      <div id="arv-form-view" class="hidden"></div>
      <div id="arv-detail-view" class="hidden"></div>
    </div>
  `;

  // ── View-Switching ────────────────────────────────────────────────

  function showView(view) {
    ['list', 'form', 'detail'].forEach(v =>
      document.getElementById(`arv-${v}-view`).classList.toggle('hidden', v !== view)
    );
  }

  function getApiKey() { return localStorage.getItem('rv_apikey') || ''; }

  // ── Cleanup ObjectURLs ────────────────────────────────────────────

  function revokePhotoUrls() {
    photoObjectUrls.forEach(u => URL.revokeObjectURL(u));
    photoObjectUrls = [];
  }

  function trackUrl(url) { photoObjectUrls.push(url); return url; }

  // ── Laden & Listenansicht ─────────────────────────────────────────

  async function loadAndRenderList() {
    revokePhotoUrls();
    try {
      trials = await store.getAllArvTrials();
    } catch (err) {
      showToast(`ARV laden: ${err.message}`, 'error');
      trials = [];
    }
    renderList();
    showView('list');
  }

  function renderList() {
    const stats = computeArvStats(trials);
    const listEl = document.getElementById('arv-list-view');
    const pText = stats.pValue !== null
      ? (stats.pValue < 0.001 ? 'p < 0.001' : `p = ${stats.pValue.toFixed(3)}`)
      : '—';
    const sigClass = stats.pValue !== null && stats.pValue < 0.05 ? 'arv-stat-sig' : '';

    const confRows = ['hoch', 'mittel', 'niedrig']
      .filter(c => stats.byConf[c].n > 0)
      .map(c => {
        const { n, hits: h } = stats.byConf[c];
        return `<div class="arv-conf-row">
          <span class="conf-badge conf-${c}">${c}</span>
          <span>${h}/${n} (${(h/n*100).toFixed(0)}%)</span>
        </div>`;
      }).join('');

    listEl.innerHTML = `
      <div class="arv-header">
        <h1 class="screen-title">ARV</h1>
        <div class="arv-action-row">
          <button id="arv-new-btn" class="btn-primary btn-sm">+ Neues Trial</button>
          <button id="arv-apikey-btn" class="btn-secondary btn-sm">⚙ API-Key</button>
        </div>
      </div>

      <div class="card arv-stats-card">
        <div class="arv-stats-row">
          <div class="arv-stat">
            <span class="arv-stat-num">${stats.total}</span>
            <span class="arv-stat-lbl">Trials</span>
          </div>
          <div class="arv-stat">
            <span class="arv-stat-num">${stats.resolvedCount > 0 ? `${stats.hits}/${stats.resolvedCount}` : '—'}</span>
            <span class="arv-stat-lbl">Treffer</span>
          </div>
          <div class="arv-stat">
            <span class="arv-stat-num">${stats.hitRate !== null ? stats.hitRate + '%' : '—'}</span>
            <span class="arv-stat-lbl">Quote</span>
          </div>
          <div class="arv-stat">
            <span class="arv-stat-num ${sigClass}">${pText}</span>
            <span class="arv-stat-lbl">Binomialtest</span>
          </div>
        </div>
        ${confRows ? `<div class="arv-conf-breakdown">${confRows}</div>` : ''}
      </div>

      <div id="arv-trial-list" class="session-list"></div>
    `;

    document.getElementById('arv-new-btn').addEventListener('click', renderNewForm);
    document.getElementById('arv-apikey-btn').addEventListener('click', showApiKeyModal);

    const trialList = document.getElementById('arv-trial-list');
    if (trials.length === 0) {
      trialList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔮</div>
          <p>Noch keine Trials. Erstelle dein erstes ARV-Trial!</p>
        </div>`;
      return;
    }

    trials.forEach(trial => {
      const card = buildTrialCard(trial);
      card.addEventListener('click', () => openDetail(trial));
      trialList.appendChild(card);
    });
  }

  function buildTrialCard(trial) {
    const card = document.createElement('div');
    card.className = 'session-card arv-card';
    const sl = STATUS_LABELS[trial.status] || STATUS_LABELS.setup;
    const hitBadge = trial.status === 'resolved' && trial.hit !== null
      ? `<span class="arv-hit-chip ${trial.hit ? 'hit' : 'miss'}">${trial.hit ? '✓ Treffer' : '✗ Fehlschlag'}</span>`
      : '';
    const isPast = trial.feedbackAt && new Date() >= new Date(trial.feedbackAt);
    const actionHint = trial.status === 'judged' && isPast
      ? '<span class="arv-action-hint">→ Ergebnis eintragen</span>' : '';

    card.innerHTML = `
      <div class="session-thumb-placeholder arv-thumb">🔮</div>
      <div class="session-info">
        <div class="arv-card-top">
          <span class="arv-status-badge ${sl.cls}">${sl.text}</span>
          ${hitBadge}
          ${actionHint}
        </div>
        <div class="session-coordinate">${trial.coordinate || '—'}</div>
        <div class="arv-question-preview">${escHtml((trial.question || '').slice(0, 65))}${(trial.question || '').length > 65 ? '…' : ''}</div>
        <div class="session-date">📅 ${formatDate(trial.feedbackAt)}</div>
      </div>
    `;
    return card;
  }

  // ── API-Key Modal ─────────────────────────────────────────────────

  function showApiKeyModal() {
    const existing = getApiKey();
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <button class="modal-close">✕</button>
        <h2 style="margin-bottom:8px;font-size:18px">Anthropic API-Key</h2>
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:14px;line-height:1.5">
          Benötigt für die KI-Beurteilung. Wird lokal in localStorage gespeichert und nur an api.anthropic.com gesendet.
        </p>
        <label>API-Key (sk-ant-…)</label>
        <input type="password" id="apikey-input"
          style="width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:10px 12px;font-size:14px;outline:none;margin-bottom:14px;font-family:monospace"
          value="${existing}" placeholder="sk-ant-api03-...">
        <button id="apikey-save" class="btn-primary" style="width:100%;height:46px">Speichern</button>
      </div>
    `;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    modal.querySelector('.modal-backdrop').addEventListener('click', close);
    modal.querySelector('.modal-close').addEventListener('click', close);
    modal.querySelector('#apikey-save').addEventListener('click', () => {
      const val = modal.querySelector('#apikey-input').value.trim();
      if (val) { localStorage.setItem('rv_apikey', val); showToast('API-Key gespeichert ✓', 'success'); }
      else { localStorage.removeItem('rv_apikey'); showToast('API-Key entfernt', 'warning'); }
      close();
    });
  }

  // ── Neues Trial: Formular ─────────────────────────────────────────

  function renderNewForm() {
    const formEl = document.getElementById('arv-form-view');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(18, 0, 0, 0);
    const defFeedback = tomorrow.toISOString().slice(0, 16);

    formEl.innerHTML = `
      <div class="arv-form">
        <div class="arv-back-row">
          <button id="arv-form-back" class="btn-back">← Zurück</button>
          <h2 style="font-size:18px;font-weight:700">Neues ARV-Trial</h2>
        </div>

        <div class="card" style="margin-top:12px">
          <label>Binäres Ereignis / Frage *</label>
          <textarea id="arv-question" rows="3"
            placeholder="z.B. Aktie XYZ schließt am 15.07. über dem Vortagesschluss"></textarea>

          <label style="margin-top:14px">Ausgang 1 (Ja / Tritt ein)</label>
          <input class="arv-text-input" type="text" id="arv-outcome1" value="Ja"
            placeholder="Ja – Ereignis tritt ein">

          <label style="margin-top:12px">Ausgang 2 (Nein / Tritt nicht ein)</label>
          <input class="arv-text-input" type="text" id="arv-outcome2" value="Nein"
            placeholder="Nein – Ereignis tritt nicht ein">

          <label style="margin-top:14px">Feedback-Zeitpunkt *</label>
          <input class="arv-text-input" type="datetime-local" id="arv-feedback-at" value="${defFeedback}">
        </div>

        <p style="font-size:12px;color:var(--text-muted);margin:10px 0 4px;line-height:1.5">
          Die App zieht zwei verschiedene Zufallsbilder und versiegelt die Zuordnung (Bild A = Ausgang X) AES-256-verschlüsselt. Der Schlüssel liegt nur im localStorage deines Geräts.
        </p>

        <button id="arv-create-btn" class="btn-primary btn-large">Trial erstellen & Bilder laden</button>
      </div>
    `;
    showView('form');

    document.getElementById('arv-form-back').addEventListener('click', loadAndRenderList);
    document.getElementById('arv-create-btn').addEventListener('click', createTrial);
  }

  async function createTrial() {
    const question = document.getElementById('arv-question')?.value.trim();
    const outcome1 = document.getElementById('arv-outcome1')?.value.trim() || 'Ja';
    const outcome2 = document.getElementById('arv-outcome2')?.value.trim() || 'Nein';
    const feedbackStr = document.getElementById('arv-feedback-at')?.value;

    if (!question) { showToast('Bitte eine Frage eingeben', 'warning'); return; }
    if (!feedbackStr) { showToast('Bitte Feedback-Zeitpunkt wählen', 'warning'); return; }

    const btn = document.getElementById('arv-create-btn');
    btn.disabled = true; btn.textContent = '⏳ Lade Zielbilder…';

    try {
      const id = generateId();
      const coordinate = generateCoordinate();

      // Zwei verschiedene Bilder laden
      const { A, B } = await targetProvider.getTargetPair(coordinate);

      // Zufällig zuordnen: imageAIsOutcome1 = true → Bild A gehört Ausgang 1
      const imageAIsOutcome1 = Math.random() < 0.5;

      // Zuordnung verschlüsseln
      const key = await generateAesKey();
      const { encrypted, iv } = await encryptAssignment({ imageAIsOutcome1 }, key);
      await storeKeyLocally(key, id);

      const trial = {
        id, type: 'arv', status: 'setup',
        createdAt: new Date().toISOString(),
        question, outcome1, outcome2,
        feedbackAt: new Date(feedbackStr).toISOString(),
        coordinate,
        imageABlob: A.imageBlob, imageBBlob: B.imageBlob,
        encryptedAssignment: encrypted, assignmentIv: iv,
        sessionStartedAt: null, sessionEndedAt: null, durationSeconds: null,
        notePhotos: [],
        judgeResult: null, actualOutcome: null, resolvedAt: null,
        resolvedImageBlob: null, hit: null,
      };

      await store.saveArvTrial(trial);
      showToast('Trial erstellt ✓', 'success');
      await loadAndRenderList();
      openDetail(trial);
    } catch (err) {
      console.error('[ARV] createTrial:', err);
      showToast(`Fehler: ${err.message}`, 'error');
      btn.disabled = false; btn.textContent = 'Trial erstellen & Bilder laden';
    }
  }

  // ── Detail-Ansicht ────────────────────────────────────────────────

  function openDetail(trial) {
    currentTrial = trial;
    sessionActive = false;
    revokePhotoUrls();
    renderDetail();
    showView('detail');
  }

  function renderDetail() {
    const trial = currentTrial;
    if (!trial) return;
    const detailEl = document.getElementById('arv-detail-view');
    const sl = STATUS_LABELS[trial.status] || STATUS_LABELS.setup;

    detailEl.innerHTML = `
      <div class="arv-detail-wrap">
        <div class="arv-back-row">
          <button id="arv-detail-back" class="btn-back">← Zurück</button>
          <span class="arv-status-badge ${sl.cls}">${sl.text}</span>
        </div>
        <div class="coordinate-display" style="font-size:30px;margin:12px 0 16px">${trial.coordinate}</div>
        <div id="arv-phase-content"></div>
      </div>
    `;

    document.getElementById('arv-detail-back').addEventListener('click', () => {
      stopSessionTimer();
      sessionActive = false;
      loadAndRenderList();
    });

    renderPhase(trial);
  }

  function renderPhase(trial) {
    const phaseEl = document.getElementById('arv-phase-content');
    if (!phaseEl) return;

    switch (trial.status) {
      case 'setup':        phaseEl.innerHTML = buildSetupHTML(trial); break;
      case 'session_done': phaseEl.innerHTML = buildSessionDoneHTML(trial); break;
      case 'judged':       phaseEl.innerHTML = buildJudgedHTML(trial); break;
      case 'resolved':     phaseEl.innerHTML = buildResolvedHTML(trial); break;
    }

    attachPhaseListeners(trial);
  }

  // ── Phase: Setup / Session aktiv ──────────────────────────────────

  function buildSetupHTML(trial) {
    return `
      <div class="card">
        <div class="modal-label">Frage</div>
        <div class="modal-value">${escHtml(trial.question)}</div>
        <div class="arv-outcomes" style="margin-top:12px">
          <div class="arv-outcome-pill o1">1️⃣ ${escHtml(trial.outcome1)}</div>
          <div class="arv-outcome-pill o2">2️⃣ ${escHtml(trial.outcome2)}</div>
        </div>
        <div style="margin-top:12px">
          <div class="modal-label">Feedback-Zeitpunkt</div>
          <div class="modal-value">📅 ${formatDate(trial.feedbackAt)}</div>
        </div>
      </div>

      <div class="card arv-task-card">
        <div class="modal-label" style="text-align:center">Session-Aufgabe</div>
        <p style="text-align:center;margin-top:8px;font-size:15px;line-height:1.6">
          „Beschreibe das Bild, das dir am<br>
          <strong>${formatDate(trial.feedbackAt)}</strong><br>
          gezeigt wird."
        </p>
      </div>

      <!-- Aktive Session (initial versteckt) -->
      <div id="arv-session-block" class="hidden">
        <div class="timer-display" id="arv-timer">00:00</div>
        <button id="arv-end-session-btn" class="btn-accent btn-large">Session beenden</button>
      </div>

      <button id="arv-start-session-btn" class="btn-primary btn-large">▶ Session starten</button>

      <button id="arv-delete-btn" class="btn-danger" style="width:100%;margin-top:10px">🗑 Trial löschen</button>
    `;
  }

  // ── Phase: Session abgeschlossen ──────────────────────────────────

  function buildSessionDoneHTML(trial) {
    const photos = trial.notePhotos || [];
    const photoGrid = photos.length > 0
      ? `<div class="photo-grid">${photos.map((b) => {
          const url = trackUrl(URL.createObjectURL(b));
          return `<img class="photo-thumb" src="${url}" alt="Notiz">`;
        }).join('')}</div>`
      : `<p style="font-size:13px;color:var(--text-muted)">Noch keine Fotos</p>`;

    return `
      <div class="card">
        <div class="modal-label">Session-Dauer</div>
        <div class="modal-value">${formatTimer(trial.durationSeconds)}</div>
        ${trial.sessionStartedAt ? `<div class="session-date" style="margin-top:4px">${formatDate(trial.sessionStartedAt)}</div>` : ''}
      </div>

      <div class="card" style="margin-top:12px">
        <div class="modal-label">Notizfotos (${photos.length})</div>
        ${photoGrid}
        <label class="photo-upload-label" style="margin-top:12px">
          📷 Fotos hinzufügen
          <input type="file" accept="image/*" capture="environment" multiple id="arv-photo-input">
        </label>
      </div>

      <p style="font-size:12px;color:var(--text-muted);margin:12px 0;line-height:1.5">
        Die KI vergleicht deine Notizfotos blind mit beiden Zielbildern. Das Ergebnis wird AES-256-verschlüsselt gespeichert – nicht lesbar bis zur Auflösung.
      </p>

      <button id="arv-judge-btn" class="btn-primary btn-large">🤖 KI-Beurteilung starten</button>
      <button id="arv-delete-btn" class="btn-danger" style="width:100%;margin-top:10px">🗑 Trial löschen</button>
    `;
  }

  // ── Phase: Versiegelt (Judged) ────────────────────────────────────

  function buildJudgedHTML(trial) {
    const now = new Date();
    const feedbackDate = new Date(trial.feedbackAt);
    const isPast = now >= feedbackDate;
    const diff = feedbackDate - now;
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const countdown = diff > 0
      ? `${days > 0 ? days + 'd ' : ''}${hours > 0 ? hours + 'h ' : ''}${mins}m`
      : '—';

    return `
      <div class="card arv-sealed-card">
        <div style="font-size:52px;text-align:center;margin-bottom:8px">🔒</div>
        <div style="text-align:center;font-weight:700;font-size:17px">KI-Beurteilung versiegelt</div>
        <div style="text-align:center;font-size:13px;color:var(--text-muted);margin-top:6px;line-height:1.5">
          Das Ergebnis ist AES-256-verschlüsselt und wird erst zur Auflösung entschlüsselt.
        </div>
      </div>

      <div class="card" style="margin-top:12px">
        <div class="modal-label">Frage</div>
        <div class="modal-value">${escHtml(trial.question)}</div>
        <div style="margin-top:10px">
          <div class="modal-label">Feedback-Zeitpunkt</div>
          <div class="modal-value">📅 ${formatDate(trial.feedbackAt)}</div>
        </div>
        ${!isPast ? `<div style="margin-top:8px;font-size:13px;color:var(--text-muted)">⏱ Noch: ${countdown}</div>` : ''}
      </div>

      ${isPast ? `
      <div class="card arv-resolve-card" style="margin-top:12px">
        <div class="modal-label" style="margin-bottom:10px">Tatsächlich eingetretener Ausgang:</div>
        <div class="arv-outcome-select">
          <button class="arv-outcome-select-btn" data-outcome="1">1️⃣ ${escHtml(trial.outcome1)}</button>
          <button class="arv-outcome-select-btn" data-outcome="2">2️⃣ ${escHtml(trial.outcome2)}</button>
        </div>
      </div>
      ` : `
      <p class="hint-text" style="font-size:13px">Kehre nach dem Feedback-Zeitpunkt zurück und trage den tatsächlichen Ausgang ein.</p>
      `}
    `;
  }

  // ── Phase: Aufgelöst ──────────────────────────────────────────────

  function buildResolvedHTML(trial) {
    const hitCls = trial.hit ? 'arv-verdict-hit' : 'arv-verdict-miss';
    const hitTxt = trial.hit ? '✓ Treffer!' : '✗ Fehlschlag';
    const conf = trial.judgeResult?.confidence || '—';
    const reasoning = trial.judgeResult?.reasoning || '';
    const photos = trial.notePhotos || [];

    const photoGrid = photos.length > 0
      ? `<div class="photo-grid">${photos.map(b => {
          const url = trackUrl(URL.createObjectURL(b));
          return `<img class="photo-thumb" src="${url}" alt="Notiz">`;
        }).join('')}</div>`
      : `<p style="font-size:13px;color:var(--text-muted)">Keine Fotos</p>`;

    return `
      <div class="card arv-verdict-card">
        <div class="arv-verdict-text ${hitCls}">${hitTxt}</div>
        <div style="font-size:13px;color:var(--text-muted);margin-top:6px">
          KI-Konfidenz: <strong>${conf}</strong>
        </div>
      </div>

      ${trial.resolvedImageBlob ? `
      <div class="card" style="margin-top:12px">
        <div class="modal-label">Korrektes Zielbild (${trial.actualOutcome === '1' ? escHtml(trial.outcome1) : escHtml(trial.outcome2)})</div>
        <img id="arv-resolved-img" style="width:100%;border-radius:8px;margin-top:8px;display:block" alt="Zielbild">
      </div>` : ''}

      <div class="card" style="margin-top:12px">
        <div class="modal-label">Frage</div>
        <div class="modal-value">${escHtml(trial.question)}</div>
        <div style="margin-top:10px">
          <div class="modal-label">Eingetretener Ausgang</div>
          <div class="modal-value">${trial.actualOutcome === '1' ? escHtml(trial.outcome1) : escHtml(trial.outcome2)}</div>
        </div>
        ${reasoning ? `
        <div style="margin-top:10px">
          <div class="modal-label">KI-Begründung</div>
          <div class="modal-value" style="font-size:13px;color:var(--text-muted)">${escHtml(reasoning)}</div>
        </div>` : ''}
        <div style="margin-top:10px">
          <div class="modal-label">Session-Dauer</div>
          <div class="modal-value">${formatTimer(trial.durationSeconds)}</div>
        </div>
      </div>

      <div class="card" style="margin-top:12px">
        <div class="modal-label">Notizfotos (${photos.length})</div>
        ${photoGrid}
      </div>
    `;
  }

  // ── Event-Listener pro Phase ──────────────────────────────────────

  function attachPhaseListeners(trial) {
    // Setup: Session starten
    const startBtn = document.getElementById('arv-start-session-btn');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        startBtn.classList.add('hidden');
        document.getElementById('arv-session-block').classList.remove('hidden');
        startSessionTimer();
        sessionActive = true;
      });
    }

    // Setup: Session beenden
    const endBtn = document.getElementById('arv-end-session-btn');
    if (endBtn) endBtn.addEventListener('click', () => endArvSession(trial));

    // session_done: Fotos hinzufügen
    const photoInput = document.getElementById('arv-photo-input');
    if (photoInput) {
      photoInput.addEventListener('change', async e => {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        try {
          const blobs = await Promise.all(files.map(f =>
            f.arrayBuffer().then(buf => new Blob([buf], { type: f.type }))
          ));
          const updated = await store.updateArvTrial(trial.id, {
            notePhotos: [...(trial.notePhotos || []), ...blobs],
          });
          Object.assign(trial, updated);
          showToast(`${files.length} Foto(s) gespeichert`, 'success');
          renderPhase(trial);
        } catch (err) {
          showToast(`Foto-Fehler: ${err.message}`, 'error');
        }
      });
    }

    // session_done: Judging starten
    const judgeBtn = document.getElementById('arv-judge-btn');
    if (judgeBtn) judgeBtn.addEventListener('click', () => runJudging(trial));

    // judged: Ausgang eingeben
    document.querySelectorAll('.arv-outcome-select-btn').forEach(btn => {
      btn.addEventListener('click', () => resolveTrial(trial, btn.dataset.outcome));
    });

    // Löschen
    const deleteBtn = document.getElementById('arv-delete-btn');
    if (deleteBtn) deleteBtn.addEventListener('click', () => confirmDelete(trial));

    // Aufgelöstes Bild anzeigen
    if (trial.status === 'resolved' && trial.resolvedImageBlob) {
      const img = document.getElementById('arv-resolved-img');
      if (img) img.src = trackUrl(URL.createObjectURL(trial.resolvedImageBlob));
    }
  }

  // ── Session-Timer ─────────────────────────────────────────────────

  function startSessionTimer() {
    sessionElapsed = 0;
    sessionStartedAt = new Date().toISOString();
    const timerEl = document.getElementById('arv-timer');
    if (timerEl) timerEl.textContent = '00:00';
    sessionTimerRef = setInterval(() => {
      sessionElapsed++;
      if (timerEl) timerEl.textContent = formatTimer(sessionElapsed);
    }, 1000);
  }

  function stopSessionTimer() {
    clearInterval(sessionTimerRef);
    sessionTimerRef = null;
  }

  async function endArvSession(trial) {
    stopSessionTimer();
    sessionActive = false;
    const endedAt = new Date().toISOString();
    try {
      const updated = await store.updateArvTrial(trial.id, {
        status: 'session_done',
        sessionStartedAt,
        sessionEndedAt: endedAt,
        durationSeconds: sessionElapsed,
      });
      Object.assign(trial, updated);
      showToast('Session gespeichert', 'success');
      renderPhase(trial);
    } catch (err) {
      showToast(`Speicherfehler: ${err.message}`, 'error');
    }
  }

  // ── Judging ───────────────────────────────────────────────────────

  async function runJudging(trial) {
    const apiKey = getApiKey();
    if (!apiKey) {
      showToast('Anthropic API-Key fehlt. Bitte unter ⚙ eintragen.', 'warning', 5000);
      showApiKeyModal();
      return;
    }

    const btn = document.getElementById('arv-judge-btn');
    if (btn) { btn.disabled = true; btn.textContent = '🤖 KI analysiert…'; }

    try {
      const judgeResult = await judgeWithClaude(
        trial.imageABlob, trial.imageBBlob, trial.notePhotos || [], apiKey
      );
      const updated = await store.updateArvTrial(trial.id, { status: 'judged', judgeResult });
      Object.assign(trial, updated);
      showToast('Beurteilung versiegelt ✓', 'success');
      renderPhase(trial);
    } catch (err) {
      console.error('[ARV] Judging:', err);
      showToast(`KI-Fehler: ${err.message}`, 'error');
      if (btn) { btn.disabled = false; btn.textContent = '🤖 KI-Beurteilung starten'; }
    }
  }

  // ── Auflösung ─────────────────────────────────────────────────────

  async function resolveTrial(trial, actualOutcome) {
    const outcomeLabel = actualOutcome === '1' ? trial.outcome1 : trial.outcome2;
    if (!confirm(`Tatsächlicher Ausgang: „${outcomeLabel}"?\n\nDieser Schritt kann nicht rückgängig gemacht werden.`)) return;

    try {
      // Zuordnung entschlüsseln
      const assignment = await decryptAssignment(
        trial.encryptedAssignment, trial.assignmentIv, trial.id
      );
      const { imageAIsOutcome1 } = assignment;

      // KI-Urteil → vorhergesagter Ausgang
      const pickedImage = trial.judgeResult?.pickedImage; // 'A' oder 'B'
      const predictedOutcome = (pickedImage === 'A') === imageAIsOutcome1 ? '1' : '2';
      const hit = predictedOutcome === actualOutcome;

      // Korrektes Bild bestimmen, falsches verwerfen
      const correctIsA = (actualOutcome === '1') === imageAIsOutcome1;
      const resolvedImageBlob = correctIsA ? trial.imageABlob : trial.imageBBlob;

      // Schlüssel löschen
      eraseKeyLocally(trial.id);

      // Trial aktualisieren: nur korrektes Bild behalten
      const updates = {
        status: 'resolved',
        actualOutcome,
        resolvedAt: new Date().toISOString(),
        hit,
        resolvedImageBlob,
        imageABlob: null,
        imageBBlob: null,
        encryptedAssignment: null,
        assignmentIv: null,
      };
      const updated = await store.updateArvTrial(trial.id, updates);
      Object.assign(trial, updated);

      showToast(hit ? '🎯 Treffer!' : '✗ Fehlschlag', hit ? 'success' : 'warning', 4000);
      await loadAndRenderList();
      openDetail(trial);
    } catch (err) {
      console.error('[ARV] Resolve:', err);
      showToast(`Auflösungsfehler: ${err.message}`, 'error');
    }
  }

  // ── Löschen ───────────────────────────────────────────────────────

  async function confirmDelete(trial) {
    if (!confirm(`Trial ${trial.coordinate} wirklich löschen?`)) return;
    try {
      await store.deleteArvTrial(trial.id);
      eraseKeyLocally(trial.id);
      showToast('Trial gelöscht', 'success');
      await loadAndRenderList();
    } catch (err) {
      showToast(`Löschfehler: ${err.message}`, 'error');
    }
  }

  // ── HTML-Escaping ─────────────────────────────────────────────────

  function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Tab-Aktivierung ───────────────────────────────────────────────

  document.querySelectorAll('.nav-btn').forEach(btn => {
    if (btn.dataset.view === 'arv') btn.addEventListener('click', loadAndRenderList);
  });

  // Initial
  loadAndRenderList();
}
