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
    delivering: 'En livraison', delivered: 'Livrée', cancelled: 'Annulée',
  };
  const STATUS_CLASS = {
    pending: 'st-pending', accepted: 'st-accepted', preparing: 'st-preparing',
    delivering: 'st-delivering', delivered: 'st-delivered', cancelled: 'st-cancelled',
  };

  function fmtMoney(n) { return (n || 0).toLocaleString('fr-FR') + ' FCFA'; }
  function fmtDate(s) {
    if (!s) return '';
    const d = new Date(s.replace(' ', 'T') + 'Z');
    return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function badge(status) {
    return `<span class="badge ${STATUS_CLASS[status] || ''}">${STATUS_LABELS[status] || status}</span>`;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  window.App = { Auth, api, toast, connectRealtime, STATUS_LABELS, STATUS_CLASS, fmtMoney, fmtDate, badge, escapeHtml };
})();
