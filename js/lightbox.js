/**
 * Lightbox — Vollbild-Bildanzeige mit Pinch-Zoom, Pan und Swipe-to-Close.
 *
 * Verwendung:
 *   import { openLightbox } from './lightbox.js';
 *   openLightbox(url);
 *   openLightbox(url, { log: drillLogArray });  // Drill-Log als Panel
 */

/**
 * @param {string} src        — Bild-URL (object-URL oder extern)
 * @param {object} opts
 * @param {Array}  opts.log   — Drill-Log [{nr, label, timestamp}], optional
 */
export function openLightbox(src, { log = null } = {}) {
  // ── Overlay aufbauen ────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.className = 'lb-overlay';

  const hasLog = Array.isArray(log) && log.length > 0;

  overlay.innerHTML = `
    <button class="lb-close" aria-label="Schließen">✕</button>
    ${hasLog ? `<button class="lb-log-toggle" aria-label="Protokoll">📋</button>` : ''}
    <div class="lb-viewport">
      <img class="lb-img" src="${src}" alt="Vollbild" draggable="false">
    </div>
    ${hasLog ? `
    <div class="lb-log-panel" id="lb-log-panel">
      <div class="lb-log-header">
        <span>Protokoll · ${log.length} Ansagen</span>
        <button class="lb-log-hide">✕</button>
      </div>
      <div class="lb-log-scroll">
        ${log.map(e => {
          const ts = new Date(e.timestamp).toLocaleTimeString('de-DE', {
            hour: '2-digit', minute: '2-digit', second: '2-digit',
          });
          return `<div class="drill-log-row">
            <span class="drill-log-nr">${e.nr}.</span>
            <span class="drill-log-label">${e.label}</span>
            <span class="drill-log-time">${ts}</span>
          </div>`;
        }).join('')}
      </div>
    </div>` : ''}
  `;

  document.body.appendChild(overlay);
  // Trigger reflow so CSS transition fires
  requestAnimationFrame(() => overlay.classList.add('lb-visible'));

  const img       = overlay.querySelector('.lb-img');
  const viewport  = overlay.querySelector('.lb-viewport');
  const logPanel  = overlay.querySelector('#lb-log-panel');
  const logToggle = overlay.querySelector('.lb-log-toggle');
  const logHide   = overlay.querySelector('.lb-log-hide');

  // ── Zoom / Pan state ────────────────────────────────────────────────
  let scale = 1, tx = 0, ty = 0;
  const pointers = new Map();
  let lastDist = 0, lastMidX = 0, lastMidY = 0;
  let swipeStartX = 0, swipeStartY = 0;
  let lastTapTime = 0;

  function applyTransform(animated = false) {
    img.style.transition = animated ? 'transform 0.25s ease' : 'none';
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  }

  function clampTranslation() {
    // Erlaubt Panning nur wenn hineingezoomt
    if (scale <= 1) { tx = 0; ty = 0; }
  }

  function dist(p1, p2) {
    return Math.hypot(p2.clientX - p1.clientX, p2.clientY - p1.clientY);
  }

  // ── Pointer Events ───────────────────────────────────────────────────
  viewport.addEventListener('pointerdown', e => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    viewport.setPointerCapture(e.pointerId);

    if (pointers.size === 1) {
      swipeStartX = e.clientX;
      swipeStartY = e.clientY;
    }
    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      lastDist = dist(
        { clientX: pts[0].x, clientY: pts[0].y },
        { clientX: pts[1].x, clientY: pts[1].y }
      );
      lastMidX = (pts[0].x + pts[1].x) / 2;
      lastMidY = (pts[0].y + pts[1].y) / 2;
    }
  });

  viewport.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      // Pan
      tx += e.clientX - prev.x;
      ty += e.clientY - prev.y;
      applyTransform();
    } else if (pointers.size === 2) {
      // Pinch-Zoom + Pan
      const pts = [...pointers.values()];
      const p1 = { clientX: pts[0].x, clientY: pts[0].y };
      const p2 = { clientX: pts[1].x, clientY: pts[1].y };
      const d  = dist(p1, p2);
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;

      scale = Math.min(Math.max(scale * (d / lastDist), 0.5), 6);
      tx += midX - lastMidX;
      ty += midY - lastMidY;

      lastDist = d; lastMidX = midX; lastMidY = midY;
      applyTransform();
    }
  });

  viewport.addEventListener('pointerup', e => {
    const wasOne = pointers.size === 1;
    const endX = e.clientX, endY = e.clientY;
    pointers.delete(e.pointerId);

    if (wasOne && scale <= 1.15) {
      const dy = endY - swipeStartY;
      const dx = Math.abs(endX - swipeStartX);
      if (dy > 80 && dx < 70) { close(); return; }
    }

    // Clamp nach Zoom-Ende
    clampTranslation();
    applyTransform();
  });

  viewport.addEventListener('pointercancel', e => pointers.delete(e.pointerId));

  // ── Doppeltipp: Zoom zurücksetzen ────────────────────────────────────
  viewport.addEventListener('click', () => {
    const now = Date.now();
    if (now - lastTapTime < 300) {
      scale = 1; tx = 0; ty = 0;
      applyTransform(true);
    }
    lastTapTime = now;
  });

  // ── Log-Panel ────────────────────────────────────────────────────────
  if (logToggle && logPanel) {
    logToggle.addEventListener('click', () => {
      logPanel.classList.toggle('lb-log-visible');
    });
  }
  if (logHide && logPanel) {
    logHide.addEventListener('click', () => logPanel.classList.remove('lb-log-visible'));
  }

  // ── Schließen ─────────────────────────────────────────────────────────
  function close() {
    overlay.classList.remove('lb-visible');
    setTimeout(() => overlay.remove(), 280);
  }

  overlay.querySelector('.lb-close').addEventListener('click', close);

  // ESC-Taste (Desktop-Fallback)
  const onKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
}
