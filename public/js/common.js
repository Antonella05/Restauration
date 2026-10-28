/* Helpers partagés: stockage auth, appels API, WebSocket temps réel, toasts. */
(function () {
  const TOKEN_KEY = 'resto_token';
  const USER_KEY = 'resto_user';

  const Auth = {
    get token() { return localStorage.getItem(TOKEN_KEY); },
    get user() {
      try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
      catch (e) { return null; }
    },
    set(token, user) {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    },
    clear() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); },
    isLogged() { return !!this.token; },
  };

  async function api(path, options = {}) {
    const opts = Object.assign({ headers: {} }, options);
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers);
    if (Auth.token) opts.headers['Authorization'] = 'Bearer ' + Auth.token;
    if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);

    const res = await fetch('/api' + path, opts);
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Erreur serveur');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function toast(message, type = '') {
    let box = document.getElementById('toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toasts';
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = message;
    box.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3500);
  }

  /* --- WebSocket temps réel avec reconnexion --- */
  function connectRealtime(onEvent, onStatus) {
    let ws = null, retry = 0, closed = false;
    function open() {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${proto}://${location.host}/ws${Auth.token ? '?token=' + encodeURIComponent(Auth.token) : ''}`;
      ws = new WebSocket(url);
      ws.onopen = () => { retry = 0; onStatus && onStatus(true); };
      ws.onmessage = (ev) => {
        try { onEvent(JSON.parse(ev.data)); } catch (e) {}
      };
      ws.onclose = () => {
        onStatus && onStatus(false);
        if (closed) return;
        retry = Math.min(retry + 1, 6);
        setTimeout(open, 500 * retry);
      };
      ws.onerror = () => { try { ws.close(); } catch (e) {} };
    }
    open();
    return { close() { closed = true; try { ws.close(); } catch (e) {} } };
  }

  const STATUS_LABELS = {
    pending: 'En attente', accepted: 'Acceptée', preparing: 'En préparation',
    delivering: 'En livraison', delivered: 'Livrée',
    ready: 'Prête à retirer', picked_up: 'Retirée', no_show: 'Non récupérée',
    cancelled: 'Annulée',
  };
  const STATUS_CLASS = {
    pending: 'st-pending', accepted: 'st-accepted', preparing: 'st-preparing',
    delivering: 'st-delivering', delivered: 'st-delivered',
    ready: 'st-ready', picked_up: 'st-delivered', no_show: 'st-cancelled',
    cancelled: 'st-cancelled',
  };
  const FINAL_STATUSES = ['delivered', 'picked_up', 'no_show', 'cancelled'];
  // Étapes de suivi selon le mode de réception.
  const FLOWS = {
    delivery: ['pending', 'accepted', 'preparing', 'delivering', 'delivered'],
    pickup:   ['pending', 'accepted', 'preparing', 'ready', 'picked_up'],
  };
  const FULFILLMENT_LABELS = { delivery: 'Livraison', pickup: 'Retrait sur place' };

  function fmtMoney(n) { return (n || 0).toLocaleString('fr-FR') + ' FCFA'; }
  function fmtDate(s) {
    if (!s) return '';
    const d = new Date(s.replace(' ', 'T') + 'Z');
    return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function fmtTime(s) {
    if (!s) return '';
    const d = new Date(s.replace(' ', 'T') + 'Z');
    const today = new Date().toDateString() === d.toDateString();
    return (today ? "aujourd'hui" : d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' })) +
      ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  /** Lien carte (OpenStreetMap) vers une position GPS. */
  function mapUrl(lat, lng) {
    return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
  }
  function badge(status) {
    return `<span class="badge ${STATUS_CLASS[status] || ''}">${STATUS_LABELS[status] || status}</span>`;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /* --- Identité du restaurant (nom, logo, couleur) — personnalisable depuis l'espace staff --- */
  function isSafeImage(url) {
    return typeof url === 'string' && (/^https?:\/\//i.test(url) || /^data:image\//i.test(url));
  }
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * f));
    return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  function applyBrand(s) {
    document.querySelectorAll('[data-brand]').forEach((el) => {
      const v = s[el.dataset.brand];
      if (v != null && v !== '') el.textContent = v;
    });
    document.querySelectorAll('[data-brand-logo]').forEach((el) => {
      if (el.dataset.defaultLogo == null) el.dataset.defaultLogo = el.innerHTML;
      if (isSafeImage(s.logo_url)) {
        el.innerHTML = `<img src="${escapeHtml(s.logo_url)}" alt="" />`;
        el.classList.add('has-img');
      } else {
        el.innerHTML = el.dataset.defaultLogo;
        el.classList.remove('has-img');
      }
    });
    if (/^#[0-9a-f]{6}$/i.test(s.primary_color || '')) {
      const root = document.documentElement.style;
      root.setProperty('--accent', s.primary_color);
      root.setProperty('--gold', s.primary_color);
      root.setProperty('--accent-dark', shade(s.primary_color, 0.78));
    }
    const suffix = document.body.dataset.titleSuffix;
    if (s.name && suffix) document.title = s.name + suffix;
  }
  const Brand = {
    settings: null,
    async load() {
      try {
        const { settings } = await api('/settings');
        Brand.settings = settings;
        applyBrand(settings);
      } catch (e) { /* on garde l'identité par défaut */ }
      return Brand.settings;
    },
  };

  window.App = {
    Auth, api, toast, connectRealtime, Brand, applyBrand, isSafeImage,
    STATUS_LABELS, STATUS_CLASS, FINAL_STATUSES, FLOWS, FULFILLMENT_LABELS,
    fmtMoney, fmtDate, fmtTime, mapUrl, badge, escapeHtml,
  };
})();
