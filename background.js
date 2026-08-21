// BackScam - background.js (v0.2)
// Figyeli: 1) automatikus átirányítás-láncokat, 2) kattintásra nyíló extra
// tabokat/ablakokat ("popup-visszaélés"), 3) kattintás célja vs tényleges
// navigáció eltérését ("bait-and-switch"). A content.js ezekből az
// adatokból egészíti ki a saját DOM-alapú pontszámát.

const POPUP_WINDOW_MS = 15000; // ennyi ideig számítanak "friss" popup-nyitásnak
const CLICK_MATCH_WINDOW_MS = 4000; // kattintás és navigáció közti max eltérés

const redirectCounts = new Map();   // tabId -> automatikus redirect-lánc hossza
const popupTimestamps = new Map();  // tabId -> [timestamp, ...] (kattintásra nyílt új tabok)
const lastClickedLink = new Map();  // tabId -> { href, time }
const baitSwitchFlags = new Map();  // tabId -> bool (egyszer használatos jelzés)

// ---- 1. Automatikus átirányítás-lánc figyelése ----
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return; // csak a főkeret

  const isAutoRedirect =
    details.transitionQualifiers &&
    (details.transitionQualifiers.includes('client_redirect') ||
      details.transitionQualifiers.includes('server_redirect'));

  if (isAutoRedirect) {
    const current = redirectCounts.get(details.tabId) || 0;
    redirectCounts.set(details.tabId, current + 1);
  } else {
    redirectCounts.set(details.tabId, 0);
  }

  // ---- 3. Bait-and-switch ellenőrzés ----
  // Ha nemrég volt egy rögzített linkkattintás ezen a tabon, és a most
  // betöltött oldal domainje NEM egyezik a kattintott link domainjével,
  // az gyanús jel (de önmagában nem dönt, csak pontot ad hozzá).
  const clicked = lastClickedLink.get(details.tabId);
  if (clicked && Date.now() - clicked.time < CLICK_MATCH_WINDOW_MS) {
    try {
      const clickedHost = new URL(clicked.href).hostname;
      const committedHost = new URL(details.url).hostname;
      if (clickedHost !== committedHost) {
        baitSwitchFlags.set(details.tabId, true);
      }
    } catch (_) { /* érvénytelen URL, kihagyjuk */ }
  }
  lastClickedLink.delete(details.tabId);
});

// ---- 2. Kattintásra nyíló extra tab/ablak figyelése ----
chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
  const list = popupTimestamps.get(details.sourceTabId) || [];
  list.push(Date.now());
  popupTimestamps.set(details.sourceTabId, list);
});

function pruneOldPopups(tabId) {
  const now = Date.now();
  const list = (popupTimestamps.get(tabId) || []).filter(
    (t) => now - t < POPUP_WINDOW_MS
  );
  popupTimestamps.set(tabId, list);
  return list.length;
}

chrome.tabs.onRemoved.addListener((tabId) => {
  redirectCounts.delete(tabId);
  popupTimestamps.delete(tabId);
  lastClickedLink.delete(tabId);
  baitSwitchFlags.delete(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab && sender.tab.id;

  if (message.type === 'LINK_CLICKED') {
    if (tabId != null && message.href) {
      lastClickedLink.set(tabId, { href: message.href, time: Date.now() });
    }
    return; // nincs válasz szükséges
  }

  if (message.type === 'GET_SUSPICION_EXTRAS') {
    if (tabId == null) {
      sendResponse({ redirectScore: 0, popupScore: 0, baitSwitch: false });
      return;
    }

    const redirectCount = redirectCounts.get(tabId) || 0;
    const redirectScore = Math.min(redirectCount * 5, 10);

    const popupCount = pruneOldPopups(tabId);
    let popupScore = 0;
    if (popupCount >= 3) popupScore = 20;
    else if (popupCount === 2) popupScore = 12;
    else if (popupCount === 1) popupScore = 5;

    const baitSwitch = baitSwitchFlags.get(tabId) || false;
    if (baitSwitch) baitSwitchFlags.delete(tabId); // egyszer használatos

    sendResponse({ redirectScore, popupScore, baitSwitch });
    return;
  }

  if (message.type === 'CONFIRMED_SCAM') {
    if (tabId == null) return;

    if (message.hasHistory) {
      chrome.tabs.goBack(tabId).catch(() => {
        openFreshTab(tabId);
      });
    } else {
      openFreshTab(tabId);
    }
  }
});

function openFreshTab(tabId) {
  chrome.tabs.update(tabId, { url: 'chrome://new-tab-page' }).catch(() => {
    chrome.tabs.update(tabId, { url: 'about:blank' });
  });
}
