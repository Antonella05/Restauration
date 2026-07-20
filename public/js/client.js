/* Interface CLIENT : menu, panier, commande, suivi temps réel. */
(function () {
  const { Auth, api, toast, connectRealtime, fmtMoney, fmtDate, badge, escapeHtml, STATUS_LABELS } = App;

  const $ = (s) => document.querySelector(s);
  let menu = [];          // catégories + produits
  let activeCat = null;
  let cart = [];          // { product, qty }
  let myOrders = [];
  let rt = null;

  /* ---------- Démarrage ---------- */
  function boot() {
    const user = Auth.user;
    if (!Auth.isLogged() || !user || user.role !== 'client') {
      showLogin();
    } else {
      showApp();
    }
  }

  function showLogin() {
    $('#loginScreen').classList.remove('hidden');
    $('#app').classList.add('hidden');
    $('#cartFab').classList.add('hidden');
  }

  async function showApp() {
    $('#loginScreen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#cartFab').classList.remove('hidden');
    $('#userName').textContent = Auth.user.name;
    loadCart();
    await loadMenu();
    await loadOrders();
    startRealtime();
  }

  /* ---------- Connexion ---------- */
  $('#clientLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#cName').value.trim();
    const phone = $('#cPhone').value.trim();
    try {
      const { token, user } = await api('/auth/client-login', { method: 'POST', body: { name, phone } });
      Auth.set(token, user);
      showApp();
      toast('Bienvenue ' + user.name + ' !', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });

  $('#logoutBtn').addEventListener('click', () => {
    Auth.clear();
    if (rt) rt.close();
    location.reload();
  });

  /* ---------- Navigation ---------- */
  document.querySelectorAll('.topbar nav button[data-view]').forEach((b) => {
    b.addEventListener('click', () => setView(b.dataset.view));
  });
  function setView(view) {
    document.querySelectorAll('.topbar nav button[data-view]').forEach((b) =>
      b.classList.toggle('active', b.dataset.view === view));
    $('#viewMenu').classList.toggle('hidden', view !== 'menu');
    $('#viewOrders').classList.toggle('hidden', view !== 'orders');
    if (view === 'orders') loadOrders();
  }

  /* ---------- Menu ---------- */
  async function loadMenu() {
    try {
      const { categories } = await api('/menu');
      menu = categories.filter((c) => c.products.length);
      if (!activeCat && menu.length) activeCat = menu[0].id;
      renderCatTabs();
      renderProducts();
    } catch (err) { toast('Impossible de charger le menu', 'error'); }
  }

  function renderCatTabs() {
    $('#catTabs').innerHTML = menu.map((c) =>
      `<button class="${c.id === activeCat ? 'active' : ''}" data-cat="${c.id}">${escapeHtml(c.name)}</button>`
    ).join('');
    document.querySelectorAll('#catTabs button').forEach((b) =>
      b.addEventListener('click', () => { activeCat = parseInt(b.dataset.cat, 10); renderCatTabs(); renderProducts(); }));
  }

  function renderProducts() {
    const cat = menu.find((c) => c.id === activeCat);
    if (!cat) { $('#products').innerHTML = '<div class="empty">Aucun produit.</div>'; return; }
    $('#products').innerHTML = cat.products.map((p) => {
      const inCart = cart.find((c) => c.product.id === p.id);
      return `
      <div class="card product">
        <img src="${escapeHtml(p.image_url || '')}" alt="${escapeHtml(p.name)}" />
        <div class="body">
          <h3>${escapeHtml(p.name)}</h3>
          <div class="desc">${escapeHtml(p.description || '')}</div>
          <div class="foot">
            <span class="price">${fmtMoney(p.price)}</span>
            ${inCart
              ? `<div class="qty">
                   <button data-dec="${p.id}">−</button>
                   <span>${inCart.qty}</span>
                   <button data-inc="${p.id}">+</button>
                 </div>`
              : `<button class="btn small" data-add="${p.id}">Commander</button>`}
          </div>
        </div>
      </div>`;
    }).join('');

    $('#products').querySelectorAll('[data-add]').forEach((b) =>
      b.addEventListener('click', () => addToCart(parseInt(b.dataset.add, 10))));
    $('#products').querySelectorAll('[data-inc]').forEach((b) =>
      b.addEventListener('click', () => changeQty(parseInt(b.dataset.inc, 10), 1)));
    $('#products').querySelectorAll('[data-dec]').forEach((b) =>
      b.addEventListener('click', () => changeQty(parseInt(b.dataset.dec, 10), -1)));
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
  function updateCartUI() { $('#cartCount').textContent = cartCount(); }

  /* ---------- Tiroir ---------- */
  let drawerOpen = false;
  let checkoutMode = false;
  let payMethod = 'cash';

  function openDrawer() { drawerOpen = true; $('#drawer').classList.add('open'); $('#drawerOverlay').classList.add('open'); }
  function closeDrawer() { drawerOpen = false; checkoutMode = false; $('#drawer').classList.remove('open'); $('#drawerOverlay').classList.remove('open'); }
  $('#cartFab').addEventListener('click', () => { checkoutMode = false; renderCart(); openDrawer(); });
  $('#drawerClose').addEventListener('click', closeDrawer);
  $('#drawerOverlay').addEventListener('click', closeDrawer);

  function renderCart() {
    $('#drawerTitle').textContent = 'Votre panier';
    if (!cart.length) {
      $('#drawerContent').innerHTML = '<div class="empty">Votre panier est vide.</div>';
      $('#drawerFooter').innerHTML = '';
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
    $('#drawerContent').querySelectorAll('[data-inc]').forEach((b) =>
      b.addEventListener('click', () => changeQty(parseInt(b.dataset.inc, 10), 1)));
    $('#drawerContent').querySelectorAll('[data-dec]').forEach((b) =>
      b.addEventListener('click', () => changeQty(parseInt(b.dataset.dec, 10), -1)));

    $('#drawerFooter').innerHTML = `
      <div class="cart-total"><span>Total</span><span>${fmtMoney(cartTotal())}</span></div>
      <button class="btn block" id="toCheckout">Commander</button>`;
    $('#toCheckout').addEventListener('click', renderCheckout);
  }

  function renderCheckout() {
    checkoutMode = true;
    payMethod = 'cash';
    $('#drawerTitle').textContent = 'Finaliser la commande';
    $('#drawerContent').innerHTML = `
      <div class="field">
        <label>Nom</label>
        <input id="coName" type="text" value="${escapeHtml(Auth.user.name)}" />
      </div>
      <div class="field">
        <label>Téléphone / contact</label>
        <input id="coPhone" type="tel" value="${escapeHtml(Auth.user.phone || '')}" placeholder="Ex. 90 00 00 00" />
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
        ℹ️ Au MVP, le paiement Mobile Money est affiché mais la commande est enregistrée en
        « paiement à la livraison ». La transaction automatisée arrive en Phase 2.
      </p>`;

    $('#drawerContent').querySelectorAll('[data-pay]').forEach((el) =>
      el.addEventListener('click', () => {
        payMethod = el.dataset.pay;
        $('#drawerContent').querySelectorAll('[data-pay]').forEach((x) =>
          x.classList.toggle('active', x === el));
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
      $('#ordersList').innerHTML = '<div class="empty">Vous n\'avez pas encore de commande.</div>';
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
        // Met à jour la commande concernée si c'est la mienne.
        loadOrders();
        if (ev.type === 'order:update' && ev.order && ev.order.customer_id === Auth.user.id) {
          toast('Commande #' + ev.order.id + ' : ' + STATUS_LABELS[ev.order.status], 'success');
        }
      }
    }, (live) => {
      $('#rtDot').classList.toggle('live', live);
    });
  }

  boot();
})();
