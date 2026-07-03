/**
 * Screen Wake Lock — hält den Bildschirm während aktiver Sessions wach.
 *
 * Verwendung:
 *   import { acquireWakeLock, releaseWakeLock } from './wakelock.js';
 *   await acquireWakeLock();   // beim Start
 *   releaseWakeLock();         // beim Stop
 *
 * Wiederherstellung nach Tab-Wechsel / App-Wechsel erfolgt automatisch.
 */

import { showToast } from './toast.js';

let wakeLock = null;
let wanted = false;
let toastShown = false;

/**
 * Fordert den Wake Lock an.
 * @returns {Promise<boolean>} true wenn erfolgreich, false wenn nicht verfügbar/fehlgeschlagen.
 */
export async function acquireWakeLock() {
  wanted = true;

  if (!('wakeLock' in navigator)) {
    if (!toastShown) {
      toastShown = true;
      showToast(
        'Bildschirm-Wachhalten nicht verfügbar – ggf. Auto-Sperre verlängern.',
        'warning',
        5000
      );
    }
    return false;
  }

  // Schon aktiv
  if (wakeLock && !wakeLock.released) return true;

  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
    return true;
  } catch (err) {
    // Häufig: Seite nicht sichtbar (benötigt Nutzerinteraktion im Vordergrund)
    console.warn('[WakeLock] Request failed:', err.message);
    return false;
  }
}

/** Gibt den Wake Lock wieder frei. */
export function releaseWakeLock() {
  wanted = false;
  if (wakeLock && !wakeLock.released) {
    wakeLock.release();
    wakeLock = null;
  }
}

// Nach App-Wechsel (visibilitychange) automatisch neu anfordern
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wanted) {
    acquireWakeLock();
  }
});
