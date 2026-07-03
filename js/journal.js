/**
 * Journal Modul
 * Zeigt alle gespeicherten Sessions, Statistiken und ermöglicht Export.
 */

import { showToast } from './toast.js';
import { openLightbox } from './lightbox.js';

// Track created object URLs to revoke them on cleanup
const activeObjectUrls = [];

function revokeObjectUrl(url) {
  if (url && url.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
}

function createObjectUrl(blob) {
  const url = URL.createObjectURL(blob);
  activeObjectUrls.push(url);
  return url;
}

function formatDate(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function scoreToStars(score) {
  if (score == null || score === 0) return '—';
  return '⭐'.repeat(score);
}

function renderStats(stats, container) {
  const totalEl = container.querySelector('#stat-total');
  const avgEl = container.querySelector('#stat-avg');
  const bestEl = container.querySelector('#stat-best');

  if (totalEl) totalEl.textContent = stats.totalSessions;
  if (avgEl) avgEl.textContent = stats.averageScore != null
    ? stats.averageScore.toFixed(1)
    : '—';
  if (bestEl) bestEl.textContent = stats.bestScore != null
    ? stats.bestScore + '/5'
    : '—';
}

function buildSessionCard(session) {
  const card = document.createElement('div');
  card.className = 'session-card';
  card.dataset.id = session.id;

  if (session.type === 'drill') {
    const count = session.drillLog?.length ?? 0;
    card.innerHTML = `
      <div class="session-thumb-placeholder" style="font-size:26px">🎯</div>
      <div class="session-info">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
          <span class="journal-type-badge drill-badge">Drill</span>
        </div>
        <div class="session-date">${formatDate(session.startedAt)}</div>
        <div class="session-meta">
          <span class="session-score" style="color:var(--text-muted)">${count} Ansagen</span>
          <span class="session-duration">${formatDuration(session.durationSeconds)}</span>
        </div>
      </div>
    `;
    return card;
  }

  // RV-Session
  let thumbHtml = '';
  if (session.targetBlob) {
    const url = createObjectUrl(session.targetBlob);
    thumbHtml = `<img class="session-thumb" src="${url}" alt="Target" loading="lazy">`;
  } else {
    thumbHtml = `<div class="session-thumb-placeholder">👁</div>`;
  }

  const stars = session.score > 0
    ? `<span class="stars">${'⭐'.repeat(session.score)}</span>`
    : '<span style="color:var(--text-muted)">keine Bewertung</span>';

  card.innerHTML = `
    ${thumbHtml}
    <div class="session-info">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
        <span class="journal-type-badge rv-badge">RV</span>
        <span class="session-coordinate" style="margin-bottom:0">${session.coordinate}</span>
      </div>
      <div class="session-date">${formatDate(session.startedAt)}</div>
      <div class="session-meta">
        <span class="session-score">${stars}</span>
        <span class="session-duration">${formatDuration(session.durationSeconds)}</span>
      </div>
    </div>
  `;

  return card;
}

function buildDrillModalContent(session, onPhotoAdded, onDelete) {
  const div = document.createElement('div');
  const log = session.drillLog || [];
  const durationStr = formatDuration(session.durationSeconds);

  const logRowsHtml = log.map(e => {
    const ts = new Date(e.timestamp).toLocaleTimeString('de-DE', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    return `<div class="drill-log-row">
      <span class="drill-log-nr">${e.nr}.</span>
      <span class="drill-log-label">${e.label}</span>
      <span class="drill-log-time">${ts}</span>
    </div>`;
  }).join('') || '<span style="font-size:13px;color:var(--text-muted)">Kein Protokoll</span>';

  div.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
      <span class="journal-type-badge drill-badge">Drill</span>
      <span style="font-size:13px;color:var(--text-muted)">${formatDate(session.startedAt)}</span>
    </div>
    <div class="modal-date" style="margin-bottom:14px">Dauer: ${durationStr} · ${log.length} Ansagen</div>

    <!-- Foto + Protokoll nebeneinander -->
    <div class="drill-split-layout">
      <div class="drill-split-photos">
        <div class="modal-label" style="margin-bottom:6px">Kritzel-Blatt</div>
        <div id="drill-modal-photo-grid" class="drill-photo-col"></div>
        <label class="photo-upload-label" style="margin-top:8px;display:inline-flex">
          📷 Fotos
          <input type="file" accept="image/*" capture="environment" multiple id="modal-drill-photo-input">
        </label>
      </div>
      <div class="drill-split-log">
        <div class="modal-label" style="margin-bottom:6px">Protokoll</div>
        <div class="drill-log-list drill-log-modal">${logRowsHtml}</div>
      </div>
    </div>

    <div class="modal-actions" style="margin-top:16px">
      <button class="btn-danger" id="modal-delete-btn">🗑 Löschen</button>
    </div>
  `;

  // Fotos rendern + Lightbox verdrahten
  const photoGrid = div.querySelector('#drill-modal-photo-grid');
  function renderPhotos(photos) {
    photoGrid.innerHTML = '';
    if (!photos || photos.length === 0) {
      photoGrid.innerHTML = '<span style="font-size:12px;color:var(--text-muted)">Keine Fotos</span>';
      return;
    }
    photos.forEach((blob, i) => {
      const url = createObjectUrl(blob);
      const img = document.createElement('img');
      img.className = 'drill-photo-thumb lb-trigger';
      img.src = url;
      img.alt = `Foto ${i + 1}`;
      img.addEventListener('click', () => openLightbox(url, { log }));
      photoGrid.appendChild(img);
    });
  }
  renderPhotos(session.notePhotos);

  div.querySelector('#modal-drill-photo-input').addEventListener('change', async e => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    const blobs = await Promise.all(files.map(f => f.arrayBuffer().then(buf => new Blob([buf], { type: f.type }))));
    await onPhotoAdded(blobs);
  });
  div.querySelector('#modal-delete-btn').addEventListener('click', () => onDelete());

  return div;
}

function buildModalContent(session, onPhotoAdded, onDelete) {
  if (session.type === 'drill') return buildDrillModalContent(session, onPhotoAdded, onDelete);

  const div = document.createElement('div');

  div.innerHTML = `
    <div class="modal-coordinate">${session.coordinate}</div>
    <div class="modal-date">${formatDate(session.startedAt)}</div>

    <div id="rv-modal-target-wrap"></div>

    <div class="modal-section">
      <div class="modal-label">Bewertung</div>
      <div class="modal-stars">${scoreToStars(session.score)}</div>
      <div style="font-size:13px;color:var(--text-muted);margin-top:2px">${session.score}/5</div>
    </div>

    <div class="modal-section">
      <div class="modal-label">Dauer</div>
      <div class="modal-value">${formatDuration(session.durationSeconds)}</div>
    </div>

    ${session.notes ? `
    <div class="modal-section">
      <div class="modal-label">Notizen</div>
      <div class="modal-value">${session.notes.replace(/\n/g, '<br>')}</div>
    </div>` : ''}

    <div class="modal-section">
      <div class="modal-label">Notizfotos</div>
      <div id="rv-modal-photos"></div>
      <label class="photo-upload-label" style="margin-top:8px">
        📷 Fotos hinzufügen
        <input type="file" accept="image/*" capture="environment" multiple id="modal-photo-input">
      </label>
    </div>

    <div class="modal-actions">
      <button class="btn-danger" id="modal-delete-btn">🗑 Löschen</button>
    </div>
  `;

  // Target image — klickbar für Lightbox
  const targetWrap = div.querySelector('#rv-modal-target-wrap');
  if (session.targetBlob) {
    const targetUrl = createObjectUrl(session.targetBlob);
    const img = document.createElement('img');
    img.className = 'modal-image lb-trigger';
    img.src = targetUrl;
    img.alt = `Target ${session.coordinate}`;
    img.addEventListener('click', () => openLightbox(targetUrl));
    targetWrap.appendChild(img);
  } else {
    targetWrap.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:32px">Kein Bild</div>';
  }

  // Notizfotos — klickbar für Lightbox
  const photosEl = div.querySelector('#rv-modal-photos');
  if (session.notePhotos && session.notePhotos.length > 0) {
    const grid = document.createElement('div');
    grid.className = 'photo-grid';
    session.notePhotos.forEach((blob, i) => {
      const url = createObjectUrl(blob);
      const img = document.createElement('img');
      img.className = 'photo-thumb lb-trigger';
      img.src = url;
      img.alt = `Notizfoto ${i + 1}`;
      img.addEventListener('click', () => openLightbox(url));
      grid.appendChild(img);
    });
    photosEl.appendChild(grid);
  } else {
    photosEl.innerHTML = '<div style="font-size:13px;color:var(--text-muted)">Keine Fotos</div>';
  }

  // Photo upload handler
  div.querySelector('#modal-photo-input').addEventListener('change', async e => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    const blobs = await Promise.all(files.map(f => f.arrayBuffer().then(buf => new Blob([buf], { type: f.type }))));
    await onPhotoAdded(blobs);
  });

  div.querySelector('#modal-delete-btn').addEventListener('click', () => onDelete());

  return div;
}

async function loadJSZip() {
  // JSZip is loaded via CDN script tag in index.html
  if (typeof JSZip === 'undefined') {
    throw new Error('JSZip nicht verfügbar. Bitte Internetverbindung prüfen.');
  }
  return JSZip;
}

async function exportZip(sessions) {
  const JSZip = await loadJSZip();
  const zip = new JSZip();

  // Serialize sessions without blobs, referencing filenames instead
  const sessionsMeta = sessions.map(s => ({
    id: s.id,
    coordinate: s.coordinate,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    durationSeconds: s.durationSeconds,
    score: s.score,
    notes: s.notes,
    targetFile: s.targetBlob ? `targets/${s.id}.jpg` : null,
    targetMetadata: s.targetMetadata,
    photoFiles: (s.notePhotos || []).map((_, i) => `photos/${s.id}_${i}.jpg`),
  }));

  zip.file('journal.json', JSON.stringify(sessionsMeta, null, 2));

  // Add target images
  for (const session of sessions) {
    if (session.targetBlob) {
      zip.folder('targets').file(`${session.id}.jpg`, session.targetBlob);
    }
    if (session.notePhotos) {
      session.notePhotos.forEach((blob, i) => {
        zip.folder('photos').file(`${session.id}_${i}.jpg`, blob);
      });
    }
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rv-journal-${new Date().toISOString().slice(0, 10)}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function initJournal(store) {
  const container = document.getElementById('view-journal');
  if (!container) return;

  container.innerHTML = `
    <div class="journal-container">
      <div class="journal-header">
        <h1 class="screen-title">Journal</h1>
        <div class="stats-bar">
          <div class="stat-item">
            <span class="stat-num" id="stat-total">0</span>
            <span class="stat-lbl">Sessions</span>
          </div>
          <div class="stat-item">
            <span class="stat-num" id="stat-avg">—</span>
            <span class="stat-lbl">Ø Score</span>
          </div>
          <div class="stat-item">
            <span class="stat-num" id="stat-best">—</span>
            <span class="stat-lbl">Beste</span>
          </div>
        </div>
        <div class="journal-actions">
          <button id="journal-export-btn" class="btn-secondary btn-sm">📦 Export ZIP</button>
        </div>
      </div>

      <div id="journal-list" class="session-list"></div>

      <!-- Detail Modal -->
      <div id="journal-modal" class="modal hidden">
        <div class="modal-backdrop"></div>
        <div class="modal-content">
          <button class="modal-close">✕</button>
          <div id="modal-body"></div>
        </div>
      </div>
    </div>
  `;

  let allSessions = [];

  async function loadAndRender() {
    try {
      const [sessions, stats] = await Promise.all([
        store.getAllSessions(),
        store.getStats(),
      ]);
      allSessions = sessions;
      renderStats(stats, container);
      renderList(sessions);
    } catch (err) {
      console.error('[Journal] Load failed:', err);
      showToast(`Fehler beim Laden: ${err.message}`, 'error');
    }
  }

  function renderList(sessions) {
    const list = document.getElementById('journal-list');
    if (!list) return;
    list.innerHTML = '';

    if (sessions.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📓</div>
          <p>Noch keine Sessions gespeichert.</p>
        </div>
      `;
      return;
    }

    sessions.forEach(session => {
      const card = buildSessionCard(session);
      card.addEventListener('click', () => openModal(session));
      list.appendChild(card);
    });
  }

  function openModal(session) {
    const modal = document.getElementById('journal-modal');
    const modalBody = document.getElementById('modal-body');
    if (!modal || !modalBody) return;

    modalBody.innerHTML = '';

    const content = buildModalContent(
      session,
      async (newBlobs) => {
        try {
          const existing = session.notePhotos || [];
          await store.updateSession(session.id, { notePhotos: [...existing, ...newBlobs] });
          showToast(`${newBlobs.length} Foto(s) gespeichert`, 'success');
          // Reload session and re-render modal
          const updated = await store.getSession(session.id);
          Object.assign(session, updated);
          modalBody.innerHTML = '';
          modalBody.appendChild(buildModalContent(updated,
            async () => {},
            async () => confirmDelete(session)
          ));
        } catch (err) {
          showToast(`Foto-Fehler: ${err.message}`, 'error');
        }
      },
      () => confirmDelete(session)
    );

    modalBody.appendChild(content);
    modal.classList.remove('hidden');
  }

  async function confirmDelete(session) {
    if (!confirm(`Session ${session.coordinate} wirklich löschen?`)) return;
    try {
      await store.deleteSession(session.id);
      closeModal();
      showToast('Session gelöscht', 'success');
      await loadAndRender();
    } catch (err) {
      showToast(`Fehler beim Löschen: ${err.message}`, 'error');
    }
  }

  function closeModal() {
    const modal = document.getElementById('journal-modal');
    if (modal) modal.classList.add('hidden');
  }

  // Modal close handlers
  container.querySelector('.modal-close').addEventListener('click', closeModal);
  container.querySelector('.modal-backdrop').addEventListener('click', closeModal);

  // Export
  document.getElementById('journal-export-btn').addEventListener('click', async () => {
    if (allSessions.length === 0) {
      showToast('Keine Sessions zum Exportieren', 'warning');
      return;
    }
    const btn = document.getElementById('journal-export-btn');
    btn.disabled = true;
    btn.textContent = 'Exportiere…';
    try {
      await exportZip(allSessions);
      showToast('Export erstellt ✓', 'success');
    } catch (err) {
      showToast(`Export-Fehler: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '📦 Export ZIP';
    }
  });

  // Reload when tab becomes active
  document.querySelectorAll('.nav-btn').forEach(btn => {
    if (btn.dataset.view === 'journal') {
      btn.addEventListener('click', loadAndRender);
    }
  });

  // Initial load
  loadAndRender();
}
