// BackScam - content.js
// Heurisztikai pontozás: megpróbálja felismerni az MFA (made-for-advertising)
// jellegű oldalakat futásidőben, statikus lista nélkül.

(() => {
  'use strict';

  // ---- Beállítások (becsült értékek, tesztelés alapján finomítandó) ----
  const THRESHOLD = 55;          // 0-100 skálán ez felett gyanús
  const RECHECK_DELAY_MS = 1500; // ennyit várunk, mielőtt újramérünk
  const TOAST_DURATION_MS = 900; // ennyi ideig látszik a toast, mielőtt elnavigálunk

  const KNOWN_AD_NETWORK_HOSTS = [
    'googlesyndication.com', 'doubleclick.net', 'adnxs.com',
    'taboola.com', 'outbrain.com', 'criteo.com', 'pubmatic.com',
    'rubiconproject.com', 'media.net', 'popads.net',
    'propellerads.com', 'revcontent.com', 'mgid.com', 'adsterra.com'
  ];

  // ---- 1. Hirdetés-sűrűség (0-30 pont) ----
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
    return Math.min(ratio * 20, 30);
  }

  // ---- 2. Ismert ad-network scriptek száma (0-25 pont) ----
  function scoreAdNetworkScripts() {
    const scripts = Array.from(document.querySelectorAll('script[src]'));
    let count = 0;
    scripts.forEach((s) => {
      try {
        const host = new URL(s.src).hostname;
        if (KNOWN_AD_NETWORK_HOSTS.some((h) => host.endsWith(h))) {
          count++;
        }
      } catch (_) { /* érvénytelen URL, kihagyjuk */ }
    });
    return Math.min(count * 5, 25);
  }

  // ---- 3. Agresszív felugró minta (0-20 pont) ----
  function scoreAggressivePopup() {
    const all = document.querySelectorAll('div, section, aside');
    for (const el of all) {
      const style = window.getComputedStyle(el);
      if (style.position !== 'fixed' && style.position !== 'absolute') continue;
      const z = parseInt(style.zIndex, 10) || 0;
      if (z < 1000) continue;

      const rect = el.getBoundingClientRect();
      const coverage = (rect.width * rect.height) / (window.innerWidth * window.innerHeight);
      if (coverage > 0.8) {
        return 20;
      }
    }
    return 0;
  }

  // ---- 4. Tartalom/kattintás arány (0-15 pont) ----
  function scoreContentClickRatio() {
    const textLength = (document.body.innerText || '').trim().length;
    const clickable = document.querySelectorAll('a, button, [onclick]').length;
    if (textLength < 200 && clickable > 15) {
      return 15;
    }
    if (textLength < 500 && clickable > 25) {
      return 10;
    }
    return 0;
  }

  function computeLocalScore() {
    return {
      adDensity: scoreAdDensity(),
      adNetworkScripts: scoreAdNetworkScripts(),
      aggressivePopup: scoreAggressivePopup(),
      contentClickRatio: scoreContentClickRatio()
    };
  }

  function sumScore(parts, redirectScore) {
    return (
      parts.adDensity +
      parts.adNetworkScripts +
      parts.aggressivePopup +
      parts.contentClickRatio +
      redirectScore
    );
  }

  // ---- Toast megjelenítése ----
  function showToast() {
    const toast = document.createElement('div');
    toast.textContent = 'BackScam: gyanús oldal elkerülve';
    Object.assign(toast.style, {
      position: 'fixed',
      top: '16px',
      right: '16px',
      zIndex: '2147483647',
      background: '#222',
      color: '#fff',
      padding: '10px 16px',
      borderRadius: '8px',
      fontFamily: 'sans-serif',
      fontSize: '13px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      opacity: '0',
      transition: 'opacity 0.2s ease-in-out'
    });
    document.documentElement.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; });
    return toast;
  }

  // ---- Fő folyamat ----
  function getRedirectScore() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'GET_REDIRECT_COUNT' }, (response) => {
          if (chrome.runtime.lastError || !response) {
            resolve(0);
            return;
          }
          resolve(Math.min((response.count || 0) * 5, 10));
        });
      } catch (_) {
        resolve(0);
      }
    });
  }

  function triggerEscape() {
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

  async function evaluate() {
    const enabled = await isEnabled();
    if (!enabled) return;

    const localScore1 = computeLocalScore();
    const redirectScore = await getRedirectScore();
    const total1 = sumScore(localScore1, redirectScore);

    if (total1 < THRESHOLD) return; // nem gyanús, nincs teendő

    // Megerősítő újramérés rövid késleltetés után
    setTimeout(() => {
      const localScore2 = computeLocalScore();
      const total2 = sumScore(localScore2, redirectScore);
      if (total2 >= THRESHOLD) {
        triggerEscape();
      }
    }, RECHECK_DELAY_MS);
  }

  // Csak akkor fusson, ha az oldal ténylegesen betöltődött
  if (document.readyState === 'complete') {
    evaluate();
  } else {
    window.addEventListener('load', evaluate, { once: true });
  }
})();
