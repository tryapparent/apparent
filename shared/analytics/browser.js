// Small explicit-events client: no SDK, autocapture, replay, cookies or URL
// forwarding. Inert on private/share routes and before an affirmative choice.
const KEY = 'apparent.product-analytics.v1';
const ROUTES = new Set(['/', '/connect', '/hosted', '/connect/device', '/hosted/device', '/connect/shares', '/hosted/shares']);
const HOSTS = new Set(['https://eu.i.posthog.com']);
const SOURCES = new Set(['google', 'bing', 'duckduckgo', 'github', 'linkedin', 'newsletter', 'reddit', 'x']);
const MEDIUMS = new Set(['organic', 'cpc', 'email', 'social', 'referral']);
const MAX_AGE = 180 * 86400000;
export function startAnalytics(config) {
  if (typeof window === 'undefined' || config.enabled !== true || !HOSTS.has(config.host) || !/^phc_[a-zA-Z0-9_]+$/.test(config.token || '') || !['production', 'synthetic', 'development'].includes(config.environment)) return;
  const route = location.pathname.replace(/\/$/, '') || '/';
  if (!ROUTES.has(route) || navigator.globalPrivacyControl === true || navigator.doNotTrack === '1') return;
  let choice = null, anonymous = null, account = null, identified = null, linkedAccount = null, lastPage = null, consentAt = null;
  let sessionKnown = route === '/';
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (stored && ['allow', 'deny'].includes(stored.choice) && Number.isFinite(stored.at) && stored.at <= Date.now() && Date.now() - stored.at < MAX_AGE) {
      choice = stored.choice;
      consentAt = stored.at;
      if (/^anon:[a-f0-9-]{36}$/.test(stored.id || '')) anonymous = stored.id;
      if (/^account:[a-f0-9]{64}$/.test(stored.account || '')) linkedAccount = stored.account;
    }
  } catch { return; } // No persistent choice means no tracking.
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({choice, at: consentAt, ...(choice === 'allow' ? {id: anonymous, account: linkedAccount} : {})})); return true; }
    catch { choice = 'deny'; anonymous = null; return false; }
  }
  function permitted() {
    if (choice !== 'allow') return false;
    const now = Date.now();
    const suppressed = navigator.globalPrivacyControl === true || navigator.doNotTrack === '1';
    if (suppressed || !Number.isFinite(consentAt) || consentAt > now || now - consentAt >= MAX_AGE) {
      choice = suppressed ? 'deny' : null;
      anonymous = null; identified = null; linkedAccount = null; lastPage = null; consentAt = null;
      render();
      return false;
    }
    return true;
  }
  function send(event, properties = {}, distinct = identified || anonymous) {
    if (!permitted() || !distinct) return;
    // Property callers are local, fixed below. Never spread request, DOM text,
    // href, referrer, query, account/session DTO, exception or navigator objects.
    const body = JSON.stringify({api_key: config.token, event, uuid: crypto.randomUUID(), timestamp: new Date().toISOString(), properties: {
      distinct_id: distinct, environment: config.environment, actor: 'browser', $geoip_disable: true, $ip: null,
      $process_person_profile: !!identified, ...properties,
    }});
    fetch(config.host + '/capture/', {method: 'POST', body, headers: {'Content-Type': 'text/plain'}, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', keepalive: true}).catch(() => {});
  }
  function identify() {
    if (!permitted() || !account || account === identified) return;
    if (linkedAccount && linkedAccount !== account) anonymous = 'anon:' + crypto.randomUUID();
    linkedAccount = account;
    if (!save()) return;
    identified = account;
    send('$identify', {$anon_distinct_id: anonymous, $process_person_profile: true}, account);
  }
  function pageview() {
    if (lastPage === route || !sessionKnown || !permitted()) return;
    if (!anonymous) { anonymous = 'anon:' + crypto.randomUUID(); if (!save()) return; }
    identify();
    const params = new URLSearchParams(location.search);
    let source = 'direct';
    try {
      const domain = new URL(document.referrer).hostname.replace(/^www\./, '');
      if (domain !== location.hostname) source = domain.endsWith('.google.com') || domain === 'google.com' ? 'google' : [...SOURCES].find(s => domain === s + '.com' || domain === s + '.org') || 'other';
    } catch { /* no referrer */ }
    if (params.has('utm_source')) source = SOURCES.has(params.get('utm_source')) ? params.get('utm_source') : 'other';
    const medium = MEDIUMS.has(params.get('utm_medium')) ? params.get('utm_medium') : 'unspecified';
    send('$pageview', {page: route, acquisition_source: source, acquisition_medium: medium});
    lastPage = route;
  }
  const host = document.createElement('aside');
  host.setAttribute('aria-label', 'Analytics preferences');
  host.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:1000;max-width:calc(100vw - 32px)';
  const shadow = host.attachShadow({mode: 'open'});
  shadow.innerHTML = `<style>:host{font:14px/1.5 system-ui,sans-serif;color:#f5f5f5}section{box-sizing:border-box;width:min(420px,calc(100vw - 32px));padding:20px;border:1px solid #555;border-radius:12px;background:#191919;box-shadow:0 8px 40px #0005}h2{font-size:16px;margin:0 0 8px}p{margin:0 0 16px}nav{display:flex;gap:8px;flex-wrap:wrap}button{font:inherit;min-height:40px;padding:8px 14px;background:#252525;color:inherit;border:1px solid #777;border-radius:6px;cursor:pointer}button:focus-visible{outline:3px solid #f9c7b4;outline-offset:3px}.settings{min-height:32px;padding:4px 8px;font-size:12px}</style><div></div>`;
  const panel = shadow.querySelector('div');
  let previousFocus;
  function render(open = choice === null) {
    if (!open) {
      panel.innerHTML = '<button class="settings" type="button">Analytics settings</button>';
      panel.querySelector('button').onclick = () => { previousFocus = document.activeElement; render(true); panel.querySelector('button').focus(); };
      return;
    }
    panel.innerHTML = '<section role="region" aria-label="Optional website analytics"><h2>Help us understand what works?</h2><p>With your permission, EU-hosted PostHog counts visits and download clicks and links them to your Connect account when you sign in. We do not send recording content, filenames, email addresses or share links. Your choice lasts 180 days.</p><nav aria-label="Analytics choice"><button type="button" data-choice="deny">No thanks</button><button type="button" data-choice="allow">Allow analytics</button></nav></section>';
    panel.querySelectorAll('[data-choice]').forEach(button => { button.onclick = () => {
      choice = button.dataset.choice;
      consentAt = Date.now();
      if (choice === 'deny') { anonymous = null; identified = null; linkedAccount = null; lastPage = null; }
      else anonymous ||= 'anon:' + crypto.randomUUID();
      if (!save()) choice = 'deny';
      render(false); pageview();
      if (previousFocus?.isConnected) previousFocus.focus(); else panel.querySelector('button').focus();
    }; });
  }
  document.body.append(host); render(); pageview();
  document.addEventListener('click', event => {
    const link = event.target instanceof Element ? event.target.closest('a') : null;
    if (!link || choice !== 'allow') return;
    let url; try { url = new URL(link.href); } catch { return; }
    if (url.origin !== 'https://github.com' || !/^\/tryapparent\/apparent\/releases(?:\/|$)/.test(url.pathname)) return;
    const platform = ['mac', 'linux'].includes(link.dataset.downloadPlatform) ? link.dataset.downloadPlatform : /\.dmg$/.test(url.pathname) ? 'mac' : /\.AppImage$/.test(url.pathname) ? 'linux' : 'unspecified';
    send('app_download_clicked', {platform, download_target: /\/download\//.test(url.pathname) ? 'installer' : 'release_listing'});
  }, true);
  window.addEventListener('apparent:analytics-account', event => {
    const next = typeof event.detail === 'string' && /^account:[a-f0-9]{64}$/.test(event.detail) ? event.detail : null;
    if (account && account !== next && choice === 'allow') { anonymous = 'anon:' + crypto.randomUUID(); identified = null; linkedAccount = null; save(); }
    if (!next && linkedAccount && choice === 'allow') { anonymous = 'anon:' + crypto.randomUUID(); identified = null; linkedAccount = null; save(); }
    account = next; sessionKnown = true; identify(); pageview();
  });
  window.addEventListener('storage', event => {
    if (event.key !== KEY && event.key !== null) return;
    // Another tab's withdrawal takes effect before the next event. Do not
    // automatically opt in this tab or silently merge another user's identity.
    choice = 'deny'; anonymous = null; identified = null; linkedAccount = null; lastPage = null; render(false);
  });
}
