// BackScam - content.js (v0.2)
// Folyamatos (nem egyszeri) DOM-alapú megfigyelés, hogy a késleltetve
// betöltődő és a mozgó/eltűnő ("flash") reklámokat is elkapja.

(() => {
  'use strict';

  // ---- Beállítások (becsült értékek, tesztelés alapján finomítandó) ----
  const THRESHOLD = 55;                // 0-100+ skálán ez felett gyanús
  const MONITOR_DURATION_MS = 13000;   // ennyi ideig figyeljük az oldalt betöltés után
  const CHECK_INTERVAL_MS = 2000;      // ennyi időnként újraszámoljuk a pontszámot
  const TOAST_DURATION_MS = 1500;      // ennyi ideig látszik az értesítés navigálás előtt

  const KNOWN_AD_NETWORK_HOSTS = [
    'googlesyndication.com', 'doubleclick.net', 'adnxs.com',
    'taboola.com', 'outbrain.com', 'criteo.com', 'pubmatic.com',
    'rubiconproject.com', 'media.net', 'popads.net',
    'propellerads.com', 'revcontent.com', 'mgid.com', 'adsterra.com'
  ];

  // ---------------------------------------------------------------------
  // DOM-alapú pontszám-jellemzők (minden mérésnél újraszámolva)
  // ---------------------------------------------------------------------

  function isAdLikeElement(el) {
    if (!(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    const classId = (el.className + ' ' + el.id).toLowerCase();
    const looksAdNamed = /\bad-|-ad\b|advert|banner|promo/.test(classId);
    const isPositioned = style.position === 'fixed' || style.position === 'absolute';
    const area = rect.width * rect.height;
    const viewportArea = window.innerWidth * window.innerHeight;
    const sizable = area / viewportArea > 0.05; // legalább 5% a viewportból

    return (looksAdNamed && sizable) || (isPositioned && sizable && el.tagName === 'IFRAME');
  }

  // 1. Hirdetés-sűrűség (0-20 pont)
  function scoreAdDensity() {
    const viewportArea = window.innerWidth * window.innerHeight;
    if (viewportArea <= 0) return 0;

    const candidates = document.querySelectorAll(
      'iframe, [class*="ad-" i], [id*="ad-" i], [class*="advert" i], [id*="advert" i]'
    );

    let adArea = 0;
    candidates.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        adArea += rect.width * rect.height;
      }
    });

    const ratio = Math.min(adArea / viewportArea, 1.5);
    return Math.min(ratio * 13, 20);
  }

  // 2. Ismert ad-network scriptek száma (0-15 pont)
  function scoreAdNetworkScripts() {
    const scripts = Array.from(document.querySelectorAll('script[src]'));
    let count = 0;
    scripts.forEach((s) => {
      try {
        const host = new URL(s.src).hostname;
        if (KNOWN_AD_NETWORK_HOSTS.some((h) => host.endsWith(h))) {
          count++;
        }
      } catch (_) { /* érvénytelen URL */ }
    });
    return Math.min(count * 3, 15);
  }

  // 3. Agresszív, teljes képernyős felugró (0-15 pont)
  function scoreAggressivePopup() {
    const all = document.querySelectorAll('div, section, aside');
    for (const el of all) {
      const style = window.getComputedStyle(el);
      if (style.position !== 'fixed' && style.position !== 'absolute') continue;
      const z = parseInt(style.zIndex, 10) || 0;
      if (z < 1000) continue;

      const rect = el.getBoundingClientRect();
      const coverage = (rect.width * rect.height) / (window.innerWidth * window.innerHeight);
      if (coverage > 0.8) return 15;
    }
    return 0;
  }

  // 4. Tartalom/kattintás arány (0-10 pont)
  function scoreContentClickRatio() {
    const textLength = (document.body.innerText || '').trim().length;
    const clickable = document.querySelectorAll('a, button, [onclick]').length;
    if (textLength < 200 && clickable > 15) return 10;
    if (textLength < 500 && clickable > 25) return 7;
    return 0;
  }

  // 5. Széléhez tapadó, becsúszó jellegű sávok/bannerek (0-15 pont)
  // Ezek jellemzően alulról/oldalról "becsúszó" reklámok, amik akkor is
  // gyanúsak, ha épp nem tűnnek el (statikus mérésnél is elkaphatók).
  function scoreEdgeAnchoredBanners() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const candidates = document.querySelectorAll('div, section, aside, iframe');
    let hits = 0;

    for (const el of candidates) {
      const style = window.getComputedStyle(el);
      if (style.position !== 'fixed' && style.position !== 'sticky') continue;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const area = rect.width * rect.height;
      if (area / (vw * vh) < 0.04) continue; // túl kicsi, nem számít bannernek

      const touchesBottom = rect.bottom >= vh - 5;
      const touchesLeft = rect.left <= 5;
      const touchesRight = rect.right >= vw - 5;
      const touchesTop = rect.top <= 5;

      if (touchesBottom || touchesLeft || touchesRight || touchesTop) {
        hits++;
      }
      if (hits >= 3) break;
    }

    return Math.min(hits * 6, 15);
  }

  function computeLocalScore() {
    return (
      scoreAdDensity() +
      scoreAdNetworkScripts() +
      scoreAggressivePopup() +
      scoreContentClickRatio() +
      scoreEdgeAnchoredBanners()
    );
  }

  // ---------------------------------------------------------------------
  // Mozgó / megjelenő-eltűnő ("flash") reklámok követése MutationObserverrel
  // Ez azért kell, mert egy két ellenőrzés közt (2 mp) simán meg is
  // jelenhet, el is tűnhet egy ilyen elem - ezt csak folyamatos figyeléssel
  // lehet elkapni.
  // ---------------------------------------------------------------------
  const trackedNodes = new Set();
  let transientHits = 0;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (isAdLikeElement(node)) {
          trackedNodes.add(node);
        }
      });
    }
  });

  function checkTransientAds() {
    for (const node of trackedNodes) {
      if (!node.isConnected) {
        transientHits++;
        trackedNodes.delete(node);
      }
    }
  }

  function scoreTransientAdActivity() {
    return Math.min(transientHits * 8, 15);
  }

  // ---------------------------------------------------------------------
  // Kattintás-követés (bait-and-switch észleléshez a background.js-ben)
  // ---------------------------------------------------------------------
  document.addEventListener(
    'click',
    (event) => {
      const link = event.target.closest && event.target.closest('a[href]');
      if (!link) return;
      try {
        const absoluteHref = new URL(link.getAttribute('href'), window.location.href).href;
        chrome.runtime.sendMessage({ type: 'LINK_CLICKED', href: absoluteHref });
      } catch (_) { /* érvénytelen URL, kihagyjuk */ }
    },
    true
  );

  // ---------------------------------------------------------------------
  // Toast megjelenítése - nagy, feltűnő sáv az oldal tetején
  // ---------------------------------------------------------------------
  function showToast() {
    const bar = document.createElement('div');
    bar.setAttribute('role', 'alert');
    Object.assign(bar.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      zIndex: '2147483647',
      background: 'linear-gradient(90deg, #d92c2c, #ff7a1a)',
      color: '#fff',
      padding: '14px 20px',
      fontFamily: 'sans-serif',
      fontSize: '16px',
      fontWeight: '600',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      boxShadow: '0 3px 10px rgba(0,0,0,0.4)',
      transform: 'translateY(-100%)',
      transition: 'transform 0.25s ease-out'
    });

    const icon = document.createElement('span');
    icon.textContent = '⚠️';
    icon.style.fontSize = '20px';

    const text = document.createElement('span');
    text.textContent = 'BackScam: gyanús oldal elkerülve';

    bar.appendChild(icon);
    bar.appendChild(text);
    document.documentElement.appendChild(bar);

    requestAnimationFrame(() => { bar.style.transform = 'translateY(0)'; });
    return bar;
  }

  // ---------------------------------------------------------------------
  // Fő folyamat: folyamatos megfigyelés MONITOR_DURATION_MS-ig
  // ---------------------------------------------------------------------
  function getExtras() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'GET_SUSPICION_EXTRAS' }, (response) => {
          if (chrome.runtime.lastError || !response) {
            resolve({ redirectScore: 0, popupScore: 0, baitSwitch: false });
            return;
          }
          resolve(response);
        });
      } catch (_) {
        resolve({ redirectScore: 0, popupScore: 0, baitSwitch: false });
      }
    });
  }

  function triggerEscape() {
    observer.disconnect();
    const toast = showToast();
    setTimeout(() => {
      toast.remove();
      chrome.runtime.sendMessage({
        type: 'CONFIRMED_SCAM',
        hasHistory: window.history.length > 1
      });
    }, TOAST_DURATION_MS);
  }

  function isEnabled() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(['enabled'], (result) => {
          resolve(result.enabled !== false); // alapértelmezés: bekapcsolva
        });
      } catch (_) {
        resolve(true);
      }
    });
  }

  async function monitor() {
    const enabled = await isEnabled();
    if (!enabled) return;

    observer.observe(document.documentElement, { childList: true, subtree: true });

    let elapsed = 0;
    let stopped = false;

    const tick = async () => {
      if (stopped) return;

      checkTransientAds();
      const localScore = computeLocalScore() + scoreTransientAdActivity();
      const extras = await getExtras();

      const baitSwitchBonus = extras.baitSwitch ? 35 : 0;
      const total = localScore + extras.redirectScore + extras.popupScore + baitSwitchBonus;

      if (total >= THRESHOLD) {
        stopped = true;
        clearInterval(intervalId);
        triggerEscape();
        return;
      }

      elapsed += CHECK_INTERVAL_MS;
      if (elapsed >= MONITOR_DURATION_MS) {
        stopped = true;
        clearInterval(intervalId);
        observer.disconnect();
      }
    };

    const intervalId = setInterval(tick, CHECK_INTERVAL_MS);
    tick(); // azonnali első mérés is
  }

  if (document.readyState === 'complete') {
    monitor();
  } else {
    window.addEventListener('load', monitor, { once: true });
  }
})();
