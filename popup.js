// BackScam - popup.js
const toggle = document.getElementById('toggle');
const status = document.getElementById('status');

function render(enabled) {
  toggle.checked = enabled;
  status.textContent = enabled
    ? 'Aktív - figyeli a gyanús oldalakat'
    : 'Kikapcsolva';
}

chrome.storage.local.get(['enabled'], (result) => {
  // alapértelmezés: bekapcsolva
  const enabled = result.enabled !== false;
  render(enabled);
});

toggle.addEventListener('change', () => {
  const enabled = toggle.checked;
  chrome.storage.local.set({ enabled });
  render(enabled);
});
