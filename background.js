// BackScam - background.js
// Figyeli az átirányítás-láncokat tabonként, és a content.js kérésére
// elviszi a felhasználót a gyanús oldalról.

const redirectCounts = new Map(); // tabId -> count

// Átirányítás-lánc számlálása: ha egy navigáció "client_redirect" vagy
// "server_redirect" minősítéssel érkezik, az azt jelenti, hogy az oldal
// automatikusan (nem felhasználói kattintásra) navigált tovább.
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return; // csak a főkeretet nézzük

  const isRedirect =
    details.transitionQualifiers &&
    (details.transitionQualifiers.includes('client_redirect') ||
      details.transitionQualifiers.includes('server_redirect'));

  if (isRedirect) {
    const current = redirectCounts.get(details.tabId) || 0;
    redirectCounts.set(details.tabId, current + 1);
  } else {
    // Felhasználó általi navigáció (link, cím sáv stb.) -> lánc nullázása
    redirectCounts.set(details.tabId, 0);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  redirectCounts.delete(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab && sender.tab.id;

  if (message.type === 'GET_REDIRECT_COUNT') {
    const count = tabId != null ? (redirectCounts.get(tabId) || 0) : 0;
    sendResponse({ count });
    return; // szinkron válasz, nincs szükség true-ra
  }

  if (message.type === 'CONFIRMED_SCAM') {
    if (tabId == null) return;

    if (message.hasHistory) {
      chrome.tabs.goBack(tabId).catch(() => {
        // ha mégsem sikerült visszalépni, essünk vissza az új tabra
        openFreshTab(tabId);
      });
    } else {
      openFreshTab(tabId);
    }
  }
});

function openFreshTab(tabId) {
  chrome.tabs.update(tabId, { url: 'chrome://new-tab-page' }).catch(() => {
    // ha a chrome://new-tab-page nem elérhető, próbáljunk about:blank-et
    chrome.tabs.update(tabId, { url: 'about:blank' });
  });
}
