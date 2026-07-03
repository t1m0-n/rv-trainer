/**
 * RV Trainer — App Controller
 * Bootstraps all modules and manages tab navigation.
 */

import { initDrill } from './drill.js';
import { initSession } from './session.js';
import { initJournal } from './journal.js';
import { IndexedDBStore } from './journal-store.js';
import { PicsumProvider } from './target-provider.js';
import { showToast } from './toast.js';
export { showToast };

// ── Service Worker ──────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(reg => {
    console.log('[App] Service Worker registered', reg.scope);
  }).catch(err => {
    console.warn('[App] Service Worker registration failed:', err);
  });
}

// ── Persistent Storage ──────────────────────────────────────────
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

// ── Tab Navigation ──────────────────────────────────────────────
function initNavigation() {
  const navBtns = document.querySelectorAll('.nav-btn');
  const views = document.querySelectorAll('.view');

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetView = btn.dataset.view;
      navBtns.forEach(b => b.classList.toggle('active', b === btn));
      views.forEach(v => v.classList.toggle('active', v.id === `view-${targetView}`));
    });
  });
}

// ── Boot ────────────────────────────────────────────────────────
async function init() {
  requestPersistentStorage(); // Fire and forget

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
  initDrill();
  initSession(targetProvider, store);
  initJournal(store);
}

init();
