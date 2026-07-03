/**
 * Toast notification utility — shared between modules.
 * Avoids circular imports by being a standalone module.
 */

/**
 * @param {string} message
 * @param {'info'|'success'|'error'|'warning'} type
 * @param {number} duration ms
 */
export function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) {
    console.warn('[Toast]', message);
    return;
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
