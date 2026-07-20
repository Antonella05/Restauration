/* Interface STAFF : call center, gérant, admin, développeur. */
(function () {
  const { Auth, api, toast, connectRealtime, fmtMoney, fmtDate, badge, escapeHtml, STATUS_LABELS } = App;
  const $ = (s) => document.querySelector(s);

  // Onglets autorisés par rôle.
  const TABS_BY_ROLE = {
    callcenter: [{ id: 'orders', label: 'Commandes' }],
    manager:    [{ id: 'orders', label: 'Commandes' }, { id: 'dash', label: 'Tableau de bord' }],
    admin:      [{ id: 'orders', label: 'Commandes' }, { id: 'dash', label: 'Tableau de bord' }, { id: 'catalog', label: 'Catalogue' }],
    developer:  [{ id: 'catalog', label: 'Catalogue' }],
  };

  let orders = [];
  let catalog = { categories: [], products: [] };
  let rt = null;
  let currentTab = null;

  function boot() {
    const user = Auth.user;
    if (!Auth.isLogged() || !user || user.role === 'client') { showLogin(); return; }
    showApp();
  }

  function showLogin() { $('#loginScreen').classList.remove('hidden'); $('#app').classList.add('hidden'); }

  async function showApp() {
    $('#loginScreen').classList.add('hidden');
    $('#app').classList.remove('hidden');
    const user = Auth.user;
    $('#roleLabel').textContent = user.roleLabel || user.role;

    const tabs = TABS_BY_ROLE[user.role] || [];
    $('#staffNav').innerHTML = tabs.map((t, i) =>
      `<button data-tab="${t.id}" class="${i === 0 ? 'active' : ''}">${t.label}</button>`).join('');
    $('#staffNav').querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => setTab(b.dataset.tab)));

    startRealtime();
    setTab(tabs[0] ? tabs[0].id : 'orders');
  }

  $('#staffLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { token, user } = await api('/auth/login', {
        method: 'POST',
        body: { username: $('#username').value.trim(), password: $('#password').value },
      });
      Auth.set(token, user);
      showApp();
      toast('Connecté — ' + (user.roleLabel || user.role), 'success');
    } catch (err) { toast(err.message, 'error'); }
  });

  $('#logoutBtn').addEventListener('click', () => { Auth.clear(); if (rt) rt.close(); location.reload(); });

  function setTab(tab) {
    currentTab = tab;
    $('#staffNav').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $('#viewOrders').classList.toggle('hidden', tab !== 'orders');
    $('#viewDash').classList.toggle('hidden', tab !== 'dash');
    $('#viewCatalog').classList.toggle('hidden', tab !== 'catalog');
    if (tab === 'orders') loadOrders();
    if (tab === 'dash') loadOrders().then(renderDash);
    if (tab === 'catalog') loadCatalog();
  }

  /* ---------- Commandes ---------- */
  $('#refreshOrders').addEventListener('click', () => loadOrders());
  $('#statusFilter').addEventListener('change', () => loadOrders());

  async function loadOrders() {
    try {
      const status = $('#statusFilter').value;
      const { orders: list } = await api('/orders' + (status ? '?status=' + status : ''));
      orders = list;
      renderOrders();
      renderStatBar();
      if (currentTab === 'dash') renderDash();
    } catch (err) { toast(err.message, 'error'); }
  }

  function renderStatBar() {
    // Barre de compteurs basée sur TOUTES les commandes chargées (filtre visuel simple).
    const counts = { pending: 0, accepted: 0, preparing: 0, delivering: 0, delivered: 0, cancelled: 0 };
    orders.forEach((o) => { counts[o.status] = (counts[o.status] || 0) + 1; });
    const cells = [
      ['En attente', counts.pending, 'st-pending'],
      ['Acceptées', counts.accepted, 'st-accepted'],
      ['En préparation', counts.preparing, 'st-preparing'],
      ['En livraison', counts.delivering, 'st-delivering'],
      ['Livrées', counts.delivered, 'st-delivered'],
    ];
    $('#statBar').innerHTML = cells.map(([l, n]) =>
      `<div class="card stat"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('');
  }

  const role = () => Auth.user.role;

  function actionButtons(o) {
    const r = role();
    const btns = [];
    if (['delivered', 'cancelled'].includes(o.status)) return '';

    // Call center : accepter / annuler une commande en attente.
    if (r === 'callcenter') {
      if (o.status === 'pending') {
        btns.push(`<button class="btn success small" data-act="accepted" data-id="${o.id}">✓ Accepter</button>`);
        btns.push(`<button class="btn danger small" data-act="cancel" data-id="${o.id}">✕ Annuler</button>`);
      }
    }

    // Gérant / Admin : faire avancer la commande.
    if (r === 'manager' || r === 'admin') {
      const next = {
        pending: 'preparing', accepted: 'preparing',
        preparing: 'delivering', delivering: 'delivered',
      }[o.status];
      if (next) {
        btns.push(`<button class="btn small" data-act="${next}" data-id="${o.id}">→ ${STATUS_LABELS[next]}</button>`);
      }
      btns.push(`<button class="btn danger small" data-act="cancel" data-id="${o.id}">Annuler</button>`);
    }
    return `<div class="actions">${btns.join('')}</div>`;
  }

  function renderOrders() {
    if (!orders.length) {
      $('#ordersContainer').innerHTML = '<div class="empty">Aucune commande.</div>';
      return;
    }
    $('#ordersContainer').innerHTML = orders.map((o) => `
      <div class="card order-card" data-order="${o.id}">
        <div class="head">
          <div>
            <span class="oid">Commande #${o.id}</span>
            <span class="muted"> · ${fmtDate(o.created_at)}</span><br/>
            <span class="muted">👤 ${escapeHtml(o.customer_name)} · 📞 ${escapeHtml(o.customer_phone)}</span>
          </div>
          ${badge(o.status)}
        </div>
        <ul>${o.items.map((it) => `<li>${it.quantity} × ${escapeHtml(it.product_name)} — ${fmtMoney(it.unit_price * it.quantity)}</li>`).join('')}</ul>
        ${o.comment ? `<div class="muted" style="font-size:.86rem">💬 ${escapeHtml(o.comment)}</div>` : ''}
        <div class="between flex mt">
          <span class="muted">${o.payment_method === 'mobile_money' ? '📱 Mobile Money' : '💵 Cash à la livraison'}</span>
          <strong>${fmtMoney(o.total)}</strong>
        </div>
        ${o.status === 'cancelled' && o.cancel_reason ? `<div class="muted mt" style="font-size:.85rem">Motif : ${escapeHtml(o.cancel_reason)}</div>` : ''}
        ${actionButtons(o)}
      </div>`).join('');

    $('#ordersContainer').querySelectorAll('[data-act]').forEach((b) =>
      b.addEventListener('click', () => handleAction(parseInt(b.dataset.id, 10), b.dataset.act)));
  }

  async function handleAction(id, act) {
    let body;
    if (act === 'cancel') {
      const reason = prompt('Motif de l\'annulation (optionnel) :') || '';
      body = { status: 'cancelled', cancel_reason: reason };
    } else {
      body = { status: act };
    }
    try {
      await api('/orders/' + id + '/status', { method: 'PATCH', body });
      toast('Commande #' + id + ' → ' + STATUS_LABELS[body.status], 'success');
      loadOrders();
    } catch (err) { toast(err.message, 'error'); }
  }

  /* ---------- Tableau de bord ---------- */
  function renderDash() {
    const total = orders.length;
    const delivered = orders.filter((o) => o.status === 'delivered');
    const active = orders.filter((o) => !['delivered', 'cancelled'].includes(o.status));
    const revenue = delivered.reduce((s, o) => s + o.total, 0);
    const today = new Date().toISOString().slice(0, 10);
    const todayOrders = orders.filter((o) => (o.created_at || '').slice(0, 10) === today);

    $('#dashStats').innerHTML = [
      ['Commandes (total)', total],
      ['En cours', active.length],
      ['Livrées', delivered.length],
      ['Recettes livrées', fmtMoney(revenue)],
      ['Aujourd\'hui', todayOrders.length],
    ].map(([l, n]) => `<div class="card stat"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('');

    // Produits les plus commandés.
    const tally = {};
    orders.forEach((o) => o.items.forEach((it) => {
      tally[it.product_name] = (tally[it.product_name] || 0) + it.quantity;
    }));
    const top = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 6);
    $('#dashDetail').innerHTML = top.length
      ? '<strong>Produits les plus commandés</strong><ul>' +
        top.map(([n, q]) => `<li>${escapeHtml(n)} — ${q} commandé(s)</li>`).join('') + '</ul>'
      : '<p class="muted">Pas encore de données.</p>';
  }

  /* ---------- Catalogue (développeur / admin) ---------- */
  async function loadCatalog() {
    try {
      catalog = await api('/products');
      renderCatalog();
    } catch (err) { toast(err.message, 'error'); }
  }

  function renderCatalog() {
    $('#catManage').innerHTML = catalog.categories.map((c) =>
      `<span class="badge" style="background:#efe8df;color:#2b2118">${escapeHtml(c.name)}
        <button class="close-x" style="font-size:1rem" data-delcat="${c.id}" title="Supprimer">×</button></span>`).join('') ||
      '<span class="muted">Aucune catégorie</span>';
    $('#catManage').querySelectorAll('[data-delcat]').forEach((b) =>
      b.addEventListener('click', () => deleteCategory(parseInt(b.dataset.delcat, 10))));

    const catName = (id) => (catalog.categories.find((c) => c.id === id) || {}).name || '—';
    $('#productRows').innerHTML = catalog.products.map((p) => `
      <tr>
        <td><strong>${escapeHtml(p.name)}</strong><br/><span class="muted" style="font-size:.82rem">${escapeHtml(p.description || '')}</span></td>
        <td>${escapeHtml(catName(p.category_id))}</td>
        <td>${fmtMoney(p.price)}</td>
        <td>${p.available ? '✅' : '⛔'}</td>
        <td class="flex">
          <button class="btn secondary small" data-edit="${p.id}">Modifier</button>
          <button class="btn danger small" data-del="${p.id}">Suppr.</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="5" class="empty">Aucun produit.</td></tr>';

    $('#productRows').querySelectorAll('[data-edit]').forEach((b) =>
      b.addEventListener('click', () => openProductForm(parseInt(b.dataset.edit, 10))));
    $('#productRows').querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', () => deleteProduct(parseInt(b.dataset.del, 10))));
  }

  $('#addCatBtn').addEventListener('click', async () => {
    const name = $('#newCatName').value.trim();
    if (!name) return;
    try { await api('/products/categories', { method: 'POST', body: { name } }); $('#newCatName').value = ''; loadCatalog(); }
    catch (err) { toast(err.message, 'error'); }
  });

  async function deleteCategory(id) {
    if (!confirm('Supprimer cette catégorie et tous ses produits ?')) return;
    try { await api('/products/categories/' + id, { method: 'DELETE' }); loadCatalog(); }
    catch (err) { toast(err.message, 'error'); }
  }

  async function deleteProduct(id) {
    if (!confirm('Supprimer ce produit ?')) return;
    try { await api('/products/' + id, { method: 'DELETE' }); loadCatalog(); toast('Produit supprimé', 'success'); }
    catch (err) { toast(err.message, 'error'); }
  }

  $('#newProductBtn').addEventListener('click', () => openProductForm(null));

  function openProductForm(id) {
    const p = id ? catalog.products.find((x) => x.id === id) : null;
    $('#drawerTitle').textContent = p ? 'Modifier le produit' : 'Nouveau produit';
    $('#drawerContent').innerHTML = `
      <div class="field"><label>Nom</label><input id="pName" value="${escapeHtml(p ? p.name : '')}" /></div>
      <div class="field"><label>Catégorie</label>
        <select id="pCat">${catalog.categories.map((c) =>
          `<option value="${c.id}" ${p && p.category_id === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Prix (FCFA)</label><input id="pPrice" type="number" min="0" value="${p ? p.price : 0}" /></div>
      <div class="field"><label>Description</label><textarea id="pDesc">${escapeHtml(p ? (p.description || '') : '')}</textarea></div>
      <div class="field"><label>Image (URL, optionnel)</label><input id="pImg" value="${escapeHtml(p ? (p.image_url || '') : '')}" placeholder="https://…" /></div>
      <div class="field"><label><input id="pAvail" type="checkbox" ${!p || p.available ? 'checked' : ''} style="width:auto"/> Disponible à la vente</label></div>`;
    $('#drawerFooter').innerHTML = `<button class="btn block" id="saveProduct">${p ? 'Enregistrer' : 'Créer'}</button>`;
    $('#saveProduct').addEventListener('click', () => saveProduct(id));
    openDrawer();
  }

  async function saveProduct(id) {
    const body = {
      name: $('#pName').value.trim(),
      category_id: parseInt($('#pCat').value, 10),
      price: parseInt($('#pPrice').value, 10) || 0,
      description: $('#pDesc').value.trim(),
      image_url: $('#pImg').value.trim(),
      available: $('#pAvail').checked,
    };
    if (!body.name || !body.category_id) { toast('Nom et catégorie requis', 'error'); return; }
    try {
      if (id) await api('/products/' + id, { method: 'PUT', body });
      else await api('/products', { method: 'POST', body });
      closeDrawer(); loadCatalog(); toast('Enregistré', 'success');
    } catch (err) { toast(err.message, 'error'); }
  }

  /* ---------- Tiroir ---------- */
  function openDrawer() { $('#drawer').classList.add('open'); $('#drawerOverlay').classList.add('open'); }
  function closeDrawer() { $('#drawer').classList.remove('open'); $('#drawerOverlay').classList.remove('open'); }
  $('#drawerClose').addEventListener('click', closeDrawer);
  $('#drawerOverlay').addEventListener('click', closeDrawer);

  /* ---------- Temps réel ---------- */
  function startRealtime() {
    if (rt) rt.close();
    rt = connectRealtime((ev) => {
      if (ev.type === 'order:new') {
        toast('🔔 Nouvelle commande #' + ev.order.id + ' — ' + ev.order.customer_name, 'success');
        if (currentTab === 'orders') loadOrders();
        if (currentTab === 'dash') loadOrders();
      } else if (ev.type === 'order:update') {
        if (currentTab === 'orders' || currentTab === 'dash') loadOrders();
      }
    }, (live) => { $('#rtDot').classList.toggle('live', live); });
  }

  boot();
})();
