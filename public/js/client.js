/* Interface CLIENT : landing, menu, panier, commande, suivi temps réel. */
(function () {
  const { Auth, api, toast, connectRealtime, fmtMoney, fmtDate, badge, escapeHtml, STATUS_LABELS } = App;

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  let menu = [];          // catégories + produits
  let activeCat = null;
  let cart = [];          // { product, qty }
  let myOrders = [];
  let rt = null;
  let pendingAfterLogin = null;   // action à exécuter après connexion

  function isClient() {
    const u = Auth.user;
    return Auth.isLogged() && u && u.role === 'client';
  }

  /* ---------- Démarrage ---------- */
  async function boot() {
    loadCart();
    refreshAuthUI();
    await loadMenu();
    startRealtime();
    if (isClient()) loadOrders();
  }

  /* ---------- Auth UI (navbar) ---------- */
  function refreshAuthUI() {
    const logged = isClient();
    $('#loginBtn').classList.toggle('hidden', logged);
    $('#logoutBtn').classList.toggle('hidden', !logged);
    $('#userChip').classList.toggle('hidden', !logged);
    $('#navOrders').classList.toggle('hidden', !logged);
    if (logged) $('#userName').textContent = Auth.user.name;
  }

  /* ---------- Modale de connexion ---------- */
  function openLogin(opts = {}) {
    $('#loginTitle').textContent = opts.title || 'Bienvenue !';
    $('#loginSub').textContent = opts.sub ||
      'Entrez votre nom et votre numéro pour commander et suivre votre commande en temps réel.';
    $('#loginOverlay').classList.add('open');
    setTimeout(() => $('#cName').focus(), 50);
  }
  function closeLogin() { $('#loginOverlay').classList.remove('open'); pendingAfterLogin = null; }
  $('#loginBtn').addEventListener('click', () => openLogin());
  $('#loginClose').addEventListener('click', closeLogin);
  $('#loginOverlay').addEventListener('click', (e) => { if (e.target === $('#loginOverlay')) closeLogin(); });

  $('#clientLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#cName').value.trim();
    const phone = $('#cPhone').value.trim();
    if (!name || !phone) { toast('Nom et téléphone requis', 'error'); return; }
    try {
      const { token, user } = await api('/auth/client-login', { method: 'POST', body: { name, phone } });
      Auth.set(token, user);
      $('#loginOverlay').classList.remove('open');
      refreshAuthUI();
      startRealtime();       // reconnexion authentifiée (suivi ciblé)
      loadOrders();
      toast('Bienvenue ' + user.name + ' !', 'success');
      const next = pendingAfterLogin; pendingAfterLogin = null;
      if (typeof next === 'function') next();
    } catch (err) { toast(err.message, 'error'); }
  });

  $('#logoutBtn').addEventListener('click', () => {
    Auth.clear();
    if (rt) rt.close();
    refreshAuthUI();
    setView('home');
    startRealtime();
    toast('À bientôt !');
  });

  /* ---------- Navigation ---------- */
  function setView(view) {
    $('#viewHome').classList.toggle('hidden', view !== 'home');
    $('#viewOrders').classList.toggle('hidden', view !== 'orders');
    if (view === 'orders') loadOrders();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $$('[data-view]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    const v = b.dataset.view;
    if (v === 'orders' && !isClient()) {
      pendingAfterLogin = () => setView('orders');
      openLogin({ title: 'Vos commandes', sub: 'Connectez-vous pour retrouver et suivre vos commandes.' });
      return;
    }
    setView(v);
  }));

  // Défilement doux (liens ancre + boutons data-scroll)
  function smoothTo(sel) {
    setView('home');
    const el = document.querySelector(sel);
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }
  $$('[data-scroll]').forEach((b) => b.addEventListener('click', () => smoothTo(b.dataset.scroll)));
  $$('.nav-links a[data-nav]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault(); smoothTo(a.getAttribute('href'));
  }));

  // Navbar ombrée au défilement
  window.addEventListener('scroll', () => {
    $('#navbar').classList.toggle('scrolled', window.scrollY > 20);
  });

  /* ---------- Menu ---------- */
  async function loadMenu() {
    try {
      const { categories } = await api('/menu');
      menu = categories.filter((c) => c.products.length);
      if (!activeCat && menu.length) activeCat = menu[0].id;
      renderCatCards();
      renderFeatured();
      renderCatTabs();
      renderProducts();
    } catch (err) { toast('Impossible de charger le menu', 'error'); }
  }

  function renderCatCards() {
    $('#catCards').innerHTML = menu.map((c) => `
      <button class="cat-card" data-gocat="${c.id}">
        <span class="cc-name">${escapeHtml(c.name)}</span>
        <span class="cc-count">${c.products.length} plat${c.products.length > 1 ? 's' : ''}</span>
        <span class="cc-go">Voir la sélection →</span>
      </button>`).join('');
    $$('#catCards [data-gocat]').forEach((b) => b.addEventListener('click', () => {
      activeCat = parseInt(b.dataset.gocat, 10);
      renderCatTabs(); renderProducts();
      smoothTo('#menu');
    }));
  }

  function renderFeatured() {
    // Un plat mis en avant par catégorie (jusqu'à 4).
    const picks = [];
    for (const c of menu) { if (c.products[0]) picks.push(c.products[0]); }
    const featured = picks.slice(0, 4);
    $('#featured').innerHTML = featured.map(productCard).join('');
    bindProductButtons('#featured');
  }

  function productCard(p) {
    const inCart = cart.find((c) => c.product.id === p.id);
    return `
      <div class="product">
        <div class="body">
          <div class="p-head">
            <h3>${escapeHtml(p.name)}</h3>
            <span class="leader"></span>
            <span class="price">${fmtMoney(p.price)}</span>
          </div>
          ${p.description ? `<div class="desc">${escapeHtml(p.description)}</div>` : ''}
          <div class="actions">
            ${inCart
              ? `<div class="qty">
                   <button data-dec="${p.id}">−</button>
                   <span>${inCart.qty}</span>
                   <button data-inc="${p.id}">+</button>
                 </div>`
              : `<button class="add-btn" data-add="${p.id}">+ Ajouter</button>`}
          </div>
        </div>
      </div>`;
  }

  function bindProductButtons(scope) {
    $$(`${scope} [data-add]`).forEach((b) =>
      b.addEventListener('click', () => addToCart(parseInt(b.dataset.add, 10))));
    $$(`${scope} [data-inc]`).forEach((b) =>
      b.addEventListener('click', () => changeQty(parseInt(b.dataset.inc, 10), 1)));
    $$(`${scope} [data-dec]`).forEach((b) =>
      b.addEventListener('click', () => changeQty(parseInt(b.dataset.dec, 10), -1)));
  }

  function renderCatTabs() {
    $('#catTabs').innerHTML = menu.map((c) =>
      `<button class="${c.id === activeCat ? 'active' : ''}" data-cat="${c.id}">${escapeHtml(c.name)}</button>`
    ).join('');
    $$('#catTabs button').forEach((b) =>
      b.addEventListener('click', () => { activeCat = parseInt(b.dataset.cat, 10); renderCatTabs(); renderProducts(); }));
  }

  function renderProducts() {
    const cat = menu.find((c) => c.id === activeCat);
    if (!cat) { $('#products').innerHTML = '<div class="empty">Aucun produit.</div>'; return; }
    $('#products').innerHTML = cat.products.map(productCard).join('');
    bindProductButtons('#products');
    // rafraîchir aussi la section vedette (états +/-)
    renderFeatured();
  }

  function findProduct(id) {
    for (const c of menu) { const p = c.products.find((x) => x.id === id); if (p) return p; }
    return null;
  }

  /* ---------- Panier ---------- */
  function loadCart() {
    try { cart = JSON.parse(localStorage.getItem('resto_cart') || '[]'); }
    catch (e) { cart = []; }
    updateCartUI();
  }
  function saveCart() { localStorage.setItem('resto_cart', JSON.stringify(cart)); }

  function addToCart(id) {
    const product = findProduct(id);
    if (!product) return;
    const line = cart.find((c) => c.product.id === id);
    if (line) line.qty++; else cart.push({ product, qty: 1 });
    saveCart(); updateCartUI(); renderProducts();
    toast(product.name + ' ajouté au panier', 'success');
    bumpCart();
  }
  function changeQty(id, delta) {
    const line = cart.find((c) => c.product.id === id);
    if (!line) return;
    line.qty += delta;
    if (line.qty <= 0) cart = cart.filter((c) => c.product.id !== id);
    saveCart(); updateCartUI(); renderProducts();
    if (drawerOpen) renderCart();
  }
  function cartTotal() { return cart.reduce((s, c) => s + c.product.price * c.qty, 0); }
  function cartCount() { return cart.reduce((s, c) => s + c.qty, 0); }
  function updateCartUI() {
    const n = cartCount();
    $('#cartCount').textContent = n;
    $('#cartFab').classList.toggle('has-items', n > 0);
  }
  function bumpCart() {
    const fab = $('#cartFab');
    fab.classList.remove('bump'); void fab.offsetWidth; fab.classList.add('bump');
  }

  /* ---------- Tiroir ---------- */
  let drawerOpen = false;
  let payMethod = 'cash';

  function openDrawer() { drawerOpen = true; $('#drawer').classList.add('open'); $('#drawerOverlay').classList.add('open'); }
  function closeDrawer() { drawerOpen = false; $('#drawer').classList.remove('open'); $('#drawerOverlay').classList.remove('open'); }
  $('#cartFab').addEventListener('click', () => { renderCart(); openDrawer(); });
  $('#drawerClose').addEventListener('click', closeDrawer);
  $('#drawerOverlay').addEventListener('click', closeDrawer);

  function renderCart() {
    $('#drawerTitle').textContent = 'Votre panier';
    if (!cart.length) {
      $('#drawerContent').innerHTML = `
        <div class="empty">
          <div style="font-size:2.4rem">🛒</div>
          <p>Votre panier est vide.</p>
          <button class="btn secondary small" id="emptyBrowse">Parcourir le menu</button>
        </div>`;
      $('#drawerFooter').innerHTML = '';
      const b = $('#emptyBrowse'); if (b) b.addEventListener('click', () => { closeDrawer(); smoothTo('#menu'); });
      return;
    }
    $('#drawerContent').innerHTML = cart.map((c) => `
      <div class="cart-line">
        <div class="info">
          <strong>${escapeHtml(c.product.name)}</strong><br/>
          <span class="muted">${fmtMoney(c.product.price)}</span>
        </div>
        <div class="qty">
          <button data-dec="${c.product.id}">−</button>
          <span>${c.qty}</span>
          <button data-inc="${c.product.id}">+</button>
        </div>
      </div>`).join('');
    bindProductButtons('#drawerContent');

    $('#drawerFooter').innerHTML = `
      <div class="cart-total"><span>Total</span><span>${fmtMoney(cartTotal())}</span></div>
      <button class="btn block" id="toCheckout">Commander →</button>`;
    $('#toCheckout').addEventListener('click', goCheckout);
  }

  function goCheckout() {
    if (!isClient()) {
      pendingAfterLogin = () => { openDrawer(); renderCheckout(); };
      $('#drawer').classList.remove('open'); // laisse l'overlay pour la modale
      openLogin({ title: 'Presque prêt !', sub: 'Entrez votre nom et votre contact pour finaliser la commande.' });
      return;
    }
    renderCheckout();
  }

  function renderCheckout() {
    payMethod = 'cash';
    $('#drawerTitle').textContent = 'Finaliser la commande';
    const u = Auth.user || {};
    $('#drawerContent').innerHTML = `
      <div class="field">
        <label>Nom</label>
        <input id="coName" type="text" value="${escapeHtml(u.name || '')}" />
      </div>
      <div class="field">
        <label>Téléphone / contact</label>
        <input id="coPhone" type="tel" value="${escapeHtml(u.phone || '')}" placeholder="Ex. 90 00 00 00" />
      </div>
      <div class="field">
        <label>Commentaire (optionnel)</label>
        <textarea id="coComment" placeholder="Ex. sans oignons, sonner à l'interphone…"></textarea>
      </div>
      <div class="field">
        <label>Mode de paiement</label>
        <div class="radio-row">
          <div class="radio-card active" data-pay="cash">💵 Cash<small>À la livraison</small></div>
          <div class="radio-card" data-pay="mobile_money">📱 Mobile Money<small>Bientôt disponible</small></div>
        </div>
      </div>
      <div class="card" style="padding:12px;background:#f6f1ea;border:none">
        <div class="between flex"><span class="muted">Articles</span><span>${cartCount()}</span></div>
        <div class="cart-total" style="margin:6px 0 0"><span>Total</span><span>${fmtMoney(cartTotal())}</span></div>
      </div>
      <p class="muted" style="font-size:.8rem;margin-top:10px">
        ℹ️ Le paiement Mobile Money est affiché mais la commande est enregistrée en
        « paiement à la livraison ». La transaction automatisée arrive en Phase 2.
      </p>`;

    $$('#drawerContent [data-pay]').forEach((el) =>
      el.addEventListener('click', () => {
        payMethod = el.dataset.pay;
        $$('#drawerContent [data-pay]').forEach((x) => x.classList.toggle('active', x === el));
      }));

    $('#drawerFooter').innerHTML = `
      <button class="btn secondary" id="backCart" style="margin-bottom:8px">← Retour au panier</button>
      <button class="btn block success" id="placeOrder">Valider la commande</button>`;
    $('#backCart').addEventListener('click', renderCart);
    $('#placeOrder').addEventListener('click', placeOrder);
  }

  async function placeOrder() {
    const name = $('#coName').value.trim();
    const phone = $('#coPhone').value.trim();
    const comment = $('#coComment').value.trim();
    if (!name || !phone) { toast('Nom et contact requis', 'error'); return; }

    const items = cart.map((c) => ({ product_id: c.product.id, quantity: c.qty }));
    $('#placeOrder').disabled = true;
    try {
      const { order } = await api('/orders', {
        method: 'POST',
        body: { items, comment, payment_method: payMethod, customer_name: name, customer_phone: phone },
      });
      cart = []; saveCart(); updateCartUI(); renderProducts();
      closeDrawer();
      toast('Commande #' + order.id + ' envoyée ! Suivez-la dans « Mes commandes ».', 'success');
      await loadOrders();
      setView('orders');
    } catch (err) {
      toast(err.message, 'error');
    } finally { $('#placeOrder').disabled = false; }
  }

  /* ---------- Mes commandes + suivi ---------- */
  async function loadOrders() {
    if (!isClient()) return;
    try {
      const { orders } = await api('/orders/mine');
      myOrders = orders;
      renderOrders();
      const active = orders.filter((o) => !['delivered', 'cancelled'].includes(o.status)).length;
      $('#ordersDot').innerHTML = active ? `<span class="cart-badge">${active}</span>` : '';
    } catch (err) { /* non connecté */ }
  }

  const FLOW = ['pending', 'accepted', 'preparing', 'delivering', 'delivered'];
  function renderTimeline(status) {
    if (status === 'cancelled') {
      return `<div class="badge st-cancelled" style="margin:8px 0">Commande annulée</div>`;
    }
    const idx = FLOW.indexOf(status);
    return `<div class="timeline">` + FLOW.map((st, i) => {
      const cls = i < idx ? 'done' : (i === idx ? 'current' : '');
      return `<div class="tl-step ${cls}">
        <div class="dot-col"><div class="dot"></div>${i < FLOW.length - 1 ? '<div class="bar"></div>' : ''}</div>
        <div class="label"><div class="t">${STATUS_LABELS[st]}</div></div>
      </div>`;
    }).join('') + `</div>`;
  }

  function renderOrders() {
    if (!myOrders.length) {
      $('#ordersList').innerHTML = `
        <div class="empty">
          <div style="font-size:2.4rem">🍽️</div>
          <p>Vous n'avez pas encore de commande.</p>
          <button class="btn small" data-scroll="#menu">Découvrir le menu</button>
        </div>`;
      const b = $('#ordersList [data-scroll]');
      if (b) b.addEventListener('click', () => smoothTo('#menu'));
      return;
    }
    $('#ordersList').innerHTML = myOrders.map((o) => `
      <div class="card order-card">
        <div class="head">
          <div>
            <div class="oid">Commande #${o.id}</div>
            <div class="muted" style="font-size:.85rem">${fmtDate(o.created_at)}</div>
          </div>
          ${badge(o.status)}
        </div>
        <ul>${o.items.map((it) => `<li>${it.quantity} × ${escapeHtml(it.product_name)} — ${fmtMoney(it.unit_price * it.quantity)}</li>`).join('')}</ul>
        ${o.comment ? `<div class="muted" style="font-size:.85rem">💬 ${escapeHtml(o.comment)}</div>` : ''}
        <div class="between flex mt">
          <span class="muted">Paiement : ${o.payment_method === 'mobile_money' ? 'Mobile Money' : 'Cash à la livraison'}</span>
          <strong>${fmtMoney(o.total)}</strong>
        </div>
        ${o.status === 'cancelled' && o.cancel_reason ? `<div class="muted mt" style="font-size:.85rem">Motif : ${escapeHtml(o.cancel_reason)}</div>` : ''}
        ${renderTimeline(o.status)}
      </div>`).join('');
  }

  /* ---------- Temps réel ---------- */
  function startRealtime() {
    if (rt) rt.close();
    rt = connectRealtime((ev) => {
      if (ev.type === 'order:update' || ev.type === 'order:new') {
        if (isClient()) loadOrders();
        if (ev.type === 'order:update' && ev.order && Auth.user && ev.order.customer_id === Auth.user.id) {
          toast('Commande #' + ev.order.id + ' : ' + STATUS_LABELS[ev.order.status], 'success');
        }
      }
    }, (live) => {
      $('#rtDot').classList.toggle('live', live);
    });
  }

  boot();
})();
