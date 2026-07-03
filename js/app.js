/**
 * RV Trainer — App Controller
 * Bootstraps all modules and manages tab navigation.
 */

import { initDrill }   from './drill.js';
import { initSession } from './session.js';
import { initArv }     from './arv.js';
import { initJournal } from './journal.js';
import { IndexedDBStore }  from './journal-store.js';
import { PicsumProvider }  from './target-provider.js';
import { showToast }       from './toast.js';
export { showToast };

// ── Service Worker + Update-Banner ─────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(reg => {
    console.log('[App] SW registered', reg.scope);

    // Zeigt den Update-Banner wenn ein neuer SW wartet
    function onUpdateReady(worker) {
      showUpdateBanner(() => {
        // Nutzer hat "Neu laden" geklickt → SW übernehmen lassen
        worker.postMessage({ type: 'SKIP_WAITING' });
      });
    }

    // Fall 1: SW wartet bereits beim Laden (z.B. nach hartem Reload)
    if (reg.waiting) {
      onUpdateReady(reg.waiting);
    }

    // Fall 2: Neuer SW installiert sich während die App läuft
    reg.addEventListener('updatefound', () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          onUpdateReady(installing);
        }
      });
    });

    // Fall 3: Sobald der neue SW übernimmt → Seite neu laden
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) { refreshing = true; window.location.reload(); }
    });

  }).catch(err => {
    console.warn('[App] SW registration failed:', err);
  });
}

function showUpdateBanner(onReload) {
  // Schon ein Banner aktiv?
  if (document.getElementById('update-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'update-banner';
  banner.innerHTML = `
    <span>Update verfügbar</span>
    <button id="update-reload-btn">Neu laden</button>
    <button id="update-dismiss-btn" aria-label="Schließen">✕</button>
  `;
  document.body.appendChild(banner);

  document.getElementById('update-reload-btn').addEventListener('click', () => {
    banner.remove();
    onReload();
  });
  document.getElementById('update-dismiss-btn').addEventListener('click', () => {
    banner.remove();
  });
}

// ── Persistent Storage ──────────────────────────────────────────────
async function requestPersistentStorage() {
  if (!navigator.storage || !navigator.storage.persist) return;
  try {
    const granted = await navigator.storage.persist();
    if (!granted) {
      console.warn('[App] Persistent storage not granted');
      showToast(
        'Daten könnten vom Browser gelöscht werden. Bitte "Zum Startbildschirm" hinzufügen für dauerhaften Speicher.',
        'warning',
        6000
      );
    }
  } catch (err) {
    console.warn('[App] storage.persist() error:', err);
  }
}

// ── Tab Navigation ──────────────────────────────────────────────────
function initNavigation() {
  const navBtns = document.querySelectorAll('.nav-btn');
  const views   = document.querySelectorAll('.view');
  const main    = document.getElementById('main');

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetView = btn.dataset.view;
      navBtns.forEach(b => b.classList.toggle('active', b === btn));
      views.forEach(v => v.classList.toggle('active', v.id === `view-${targetView}`));
      // Scroll zurücksetzen wenn Tab gewechselt wird
      if (main) main.scrollTop = 0;
    });
  });
}

// ── Boot ────────────────────────────────────────────────────────────
async function init() {
  requestPersistentStorage(); // fire and forget

  const store = new IndexedDBStore();
  try {
    await store.open();
  } catch (err) {
    showToast(`Datenbankfehler: ${err.message}`, 'error', 8000);
    console.error('[App] DB open failed:', err);
    return;
  }

  const targetProvider = new PicsumProvider();

  initNavigation();
  initDrill(store);
  initSession(targetProvider, store);
  initArv(targetProvider, store);
  initJournal(store);
}

init();
