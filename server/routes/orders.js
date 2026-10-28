'use strict';

const express = require('express');
const db = require('../db');
const { authRequired, requireRole } = require('../auth');
const { getSettings } = require('../settings');
const realtime = require('../realtime');

const router = express.Router();

const STATUSES = [
  'pending', 'accepted', 'preparing',
  'delivering', 'delivered',          // livraison
  'ready', 'picked_up', 'no_show',    // retrait sur place
  'cancelled',
];
const STATUS_LABELS = {
  pending: 'En attente',
  accepted: 'Acceptée',
  preparing: 'En préparation',
  delivering: 'En livraison',
  delivered: 'Livrée',
  ready: 'Prête à retirer',
  picked_up: 'Retirée',
  no_show: 'Non récupérée',
  cancelled: 'Annulée',
};
const FULFILLMENTS = ['delivery', 'pickup'];
const FINAL_STATUSES = ['delivered', 'picked_up', 'no_show', 'cancelled'];
const DELIVERY_ONLY = ['delivering', 'delivered'];
const PICKUP_ONLY = ['ready', 'picked_up', 'no_show'];
// Une commande reste modifiable par le centre d'appels tant qu'elle n'est pas partie / prête.
const EDITABLE_STATUSES = ['pending', 'accepted', 'preparing'];
const STAFF_ROLES = ['callcenter', 'manager', 'admin', 'developer'];

/** Date JS → format SQLite UTC 'YYYY-MM-DD HH:MM:SS' (même format que datetime('now')). */
function toSqlDate(d) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function fmtMoney(n) {
  return (n || 0).toLocaleString('fr-FR') + ' FCFA';
}

function loadOrder(id) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return null;
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id);
  order.modifications = db.prepare(
    'SELECT * FROM order_modifications WHERE order_id = ? ORDER BY id DESC'
  ).all(id);
  order.statusLabel = STATUS_LABELS[order.status] || order.status;
  return order;
}

function parseCoord(v, max) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= max ? n : null;
}

/**
 * CLIENT — Création d'une commande.
 * Le total est recalculé côté serveur à partir des prix en base (jamais
 * depuis le client) pour éviter toute manipulation.
 */
router.post('/', authRequired, (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const comment = (req.body.comment || '').trim();
  const paymentMethod = req.body.payment_method === 'mobile_money' ? 'mobile_money' : 'cash';
  const name = (req.body.customer_name || req.user.name || '').trim();
  const phone = (req.body.customer_phone || '').trim();
  const fulfillment = FULFILLMENTS.includes(req.body.fulfillment) ? req.body.fulfillment : 'delivery';
  const settings = getSettings();

  if (!items.length) return res.status(400).json({ error: 'Le panier est vide.' });
  if (!name || !phone) return res.status(400).json({ error: 'Nom et contact requis.' });
  if (settings[fulfillment + '_enabled'] !== '1') {
    return res.status(400).json({
      error: fulfillment === 'pickup' ? 'Le retrait sur place n\'est pas proposé.' : 'La livraison n\'est pas proposée.',
    });
  }

  // Livraison : adresse et/ou position GPS.
  let address = null, lat = null, lng = null, accuracy = null;
  if (fulfillment === 'delivery') {
    address = (req.body.delivery_address || '').trim().slice(0, 500) || null;
    lat = parseCoord(req.body.latitude, 90);
    lng = parseCoord(req.body.longitude, 180);
    if (lat === null || lng === null) { lat = null; lng = null; }
    accuracy = lat !== null ? parseCoord(req.body.location_accuracy, 1e6) : null;
    if (!address && lat === null) {
      return res.status(400).json({ error: 'Indiquez l\'adresse de livraison ou partagez votre position.' });
    }
  }

  // Retrait : heure souhaitée (optionnelle — sinon « dès que possible »).
  let pickupTime = null;
  if (fulfillment === 'pickup' && req.body.pickup_time) {
    const t = new Date(req.body.pickup_time);
    const now = Date.now();
    if (Number.isNaN(t.getTime())) return res.status(400).json({ error: 'Heure de retrait invalide.' });
    if (t.getTime() < now - 5 * 60000) return res.status(400).json({ error: 'L\'heure de retrait est déjà passée.' });
    if (t.getTime() > now + 7 * 86400000) return res.status(400).json({ error: 'Le retrait doit être prévu dans les 7 jours.' });
    pickupTime = toSqlDate(t);
  }

  // Résolution des produits + calcul du total côté serveur.
  const getProduct = db.prepare('SELECT * FROM products WHERE id = ? AND available = 1');
  const resolved = [];
  for (const it of items) {
    const product = getProduct.get(it.product_id);
    if (!product) continue;
    const qty = Math.max(1, parseInt(it.quantity, 10) || 1);
    resolved.push({ product, qty });
  }
  if (!resolved.length) {
    return res.status(400).json({ error: 'Aucun article valide dans le panier.' });
  }

  const total = resolved.reduce((s, r) => s + r.product.price * r.qty, 0);

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO orders (customer_id, customer_name, customer_phone, comment, payment_method, status, total,
                          fulfillment, delivery_address, latitude, longitude, location_accuracy, pickup_time)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)
    `).run(req.user.id, name, phone, comment || null, paymentMethod, total,
      fulfillment, address, lat, lng, accuracy, pickupTime);

    const orderId = info.lastInsertRowid;
    const insItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const r of resolved) {
      insItem.run(orderId, r.product.id, r.product.name, r.product.price, r.qty);
    }

    // Mémorise les informations du client pour ses prochaines commandes.
    if (req.user.role === 'client' && req.body.remember !== false) {
      if (fulfillment === 'delivery') {
        db.prepare('UPDATE users SET address = ?, latitude = ?, longitude = ?, fulfillment = ? WHERE id = ?')
          .run(address, lat, lng, fulfillment, req.user.id);
      } else {
        db.prepare('UPDATE users SET fulfillment = ? WHERE id = ?').run(fulfillment, req.user.id);
      }
    }
    return orderId;
  });

  const orderId = tx();
  const order = loadOrder(orderId);

  // Notification temps réel: nouvelle commande pour tout le staff (+ push call center).
  realtime.broadcast({ type: 'order:new', order }, { customerId: order.customer_id });

  res.status(201).json({ order });
});

/** CLIENT — Ses propres commandes (suivi temps réel). */
router.get('/mine', authRequired, (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC'
  ).all(req.user.id);
  const orders = rows.map((o) => loadOrder(o.id));
  res.json({ orders });
});

/**
 * Bornes UTC d'une journée locale.
 * @param {string} date  'YYYY-MM-DD' (jour local)
 * @param {number} tz    décalage local en minutes par rapport à UTC (ex. +60 pour le Bénin)
 */
function dayRange(date, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const start = Date.UTC(y, m - 1, d) - tz * 60000;
  return [toSqlDate(new Date(start)), toSqlDate(new Date(start + 86400000))];
}

function dayStats(date, tz) {
  const [from, to] = dayRange(date, tz);
  const completed = db.prepare(`
    SELECT status, COUNT(*) AS n, COALESCE(SUM(total), 0) AS amount FROM orders
    WHERE status IN ('delivered', 'picked_up', 'no_show', 'cancelled')
      AND COALESCE(completed_at, updated_at) >= ? AND COALESCE(completed_at, updated_at) < ?
    GROUP BY status
  `).all(from, to);
  const by = Object.fromEntries(completed.map((r) => [r.status, r]));
  const created = db.prepare(`
    SELECT fulfillment, COUNT(*) AS n FROM orders
    WHERE created_at >= ? AND created_at < ? GROUP BY fulfillment
  `).all(from, to);
  const cr = Object.fromEntries(created.map((r) => [r.fulfillment, r.n]));
  const n = (s) => (by[s] ? by[s].n : 0);
  const amount = (s) => (by[s] ? by[s].amount : 0);
  return {
    date,
    delivered: n('delivered'),
    picked_up: n('picked_up'),
    no_show: n('no_show'),
    cancelled: n('cancelled'),
    revenue: amount('delivered') + amount('picked_up'),
    revenue_delivery: amount('delivered'),
    revenue_pickup: amount('picked_up'),
    created_delivery: cr.delivery || 0,
    created_pickup: cr.pickup || 0,
    created_total: (cr.delivery || 0) + (cr.pickup || 0),
  };
}

/**
 * GÉRANT / ADMIN — Statistiques d'une journée donnée :
 * commandes livrées, retirées sur place, non récupérées, recettes,
 * + historique des 7 jours précédant la date choisie.
 */
router.get('/stats', requireRole('manager', 'admin'), (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '')
    ? req.query.date
    : new Date().toISOString().slice(0, 10);
  const tz = Math.max(-840, Math.min(840, parseInt(req.query.tz, 10) || 0));

  const day = dayStats(date, tz);

  const [y, m, d] = date.split('-').map(Number);
  const history = [];
  for (let i = 6; i >= 0; i--) {
    const dt = new Date(Date.UTC(y, m - 1, d - i));
    const s = dayStats(dt.toISOString().slice(0, 10), tz);
    history.push({ date: s.date, delivered: s.delivered, picked_up: s.picked_up, revenue: s.revenue });
  }

  const [from, to] = dayRange(date, tz);
  const top = db.prepare(`
    SELECT oi.product_name AS name, SUM(oi.quantity) AS qty FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.created_at >= ? AND o.created_at < ? AND o.status NOT IN ('cancelled')
    GROUP BY oi.product_name ORDER BY qty DESC LIMIT 6
  `).all(from, to);

  const inProgress = db.prepare(`
    SELECT COUNT(*) AS n FROM orders WHERE status NOT IN ('delivered', 'picked_up', 'no_show', 'cancelled')
  `).get().n;

  res.json({ day, history, top, in_progress: inProgress });
});

/** STAFF — Liste des commandes (filtres statut / mode de réception optionnels). */
router.get('/', requireRole(...STAFF_ROLES), (req, res) => {
  const where = [];
  const params = [];
  if (STATUSES.includes(req.query.status)) { where.push('status = ?'); params.push(req.query.status); }
  if (FULFILLMENTS.includes(req.query.fulfillment)) { where.push('fulfillment = ?'); params.push(req.query.fulfillment); }
  const rows = db.prepare(
    `SELECT id FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`
  ).all(...params);
  const orders = rows.map((o) => loadOrder(o.id));
  res.json({ orders });
});

/** Détail d'une commande (staff, ou client propriétaire). */
router.get('/:id', authRequired, (req, res) => {
  const order = loadOrder(parseInt(req.params.id, 10));
  if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
  const isStaff = STAFF_ROLES.includes(req.user.role);
  if (!isStaff && order.customer_id !== req.user.id) {
    return res.status(403).json({ error: 'Accès non autorisé.' });
  }
  res.json({ order });
});

/**
 * STAFF — Mise à jour du statut.
 * - Call center: accepter (pending→accepted) ou annuler.
 * - Gérant/Admin: faire avancer la commande ou l'annuler.
 *     livraison : préparation → livraison → livrée
 *     retrait   : préparation → prête à retirer → retirée (ou non récupérée)
 */
router.patch('/:id/status', requireRole('callcenter', 'manager', 'admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const newStatus = req.body.status;
  const cancelReason = (req.body.cancel_reason || '').trim();

  if (!STATUSES.includes(newStatus)) {
    return res.status(400).json({ error: 'Statut invalide.' });
  }

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable.' });

  // Règles de rôle.
  if (req.user.role === 'callcenter') {
    const allowed = ['accepted', 'cancelled'];
    if (!allowed.includes(newStatus)) {
      return res.status(403).json({ error: 'Le call center peut seulement accepter ou annuler.' });
    }
  }

  // Règles de cohérence.
  if (FINAL_STATUSES.includes(order.status)) {
    return res.status(400).json({ error: 'Cette commande est déjà clôturée.' });
  }
  if (order.fulfillment === 'pickup' && DELIVERY_ONLY.includes(newStatus)) {
    return res.status(400).json({ error: 'Commande à retirer sur place : pas de livraison.' });
  }
  if (order.fulfillment !== 'pickup' && PICKUP_ONLY.includes(newStatus)) {
    return res.status(400).json({ error: 'Commande en livraison : statut de retrait non applicable.' });
  }
  if (newStatus === 'no_show' && order.status !== 'ready') {
    return res.status(400).json({ error: 'Seule une commande prête peut être déclarée non récupérée.' });
  }

  const reason = newStatus === 'cancelled' ? (cancelReason || null)
    : newStatus === 'no_show' ? (cancelReason || 'Commande non récupérée par le client.')
    : null;

  db.prepare(`
    UPDATE orders SET status = ?, cancel_reason = ?, updated_at = datetime('now'),
      ready_at = CASE WHEN ? = 'ready' THEN datetime('now') ELSE ready_at END,
      completed_at = CASE WHEN ? IN ('delivered', 'picked_up', 'no_show', 'cancelled') THEN datetime('now') ELSE completed_at END
    WHERE id = ?
  `).run(newStatus, reason, newStatus, newStatus, id);

  const updated = loadOrder(id);
  realtime.broadcast(
    { type: 'order:update', order: updated, by: req.user.role },
    { customerId: updated.customer_id }
  );

  res.json({ order: updated });
});

/**
 * STAFF — Modification d'une commande après échange avec le client
 * (remplacement d'un produit indisponible, ajout, retrait, quantités).
 *
 * Corps : {
 *   items: [{ product_id, quantity, replaces? }],   // nouvelle composition complète
 *   note: "Coca-Cola indisponible, remplacé par Panta",
 *   client_agreed: true                             // accord du client obligatoire
 * }
 * - Un article déjà présent conserve son prix d'origine.
 * - Un nouvel article (ou un produit de remplacement) est facturé à son prix actuel.
 * - Le total est recalculé côté serveur ; le client est notifié et doit en prendre connaissance.
 */
router.put('/:id/items', requireRole('callcenter', 'manager', 'admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const order = loadOrder(id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable.' });

  if (!EDITABLE_STATUSES.includes(order.status)) {
    return res.status(400).json({ error: 'Cette commande ne peut plus être modifiée (' + order.statusLabel + ').' });
  }
  if (req.body.client_agreed !== true) {
    return res.status(400).json({ error: 'L\'accord du client est requis avant toute modification.' });
  }
  const note = (req.body.note || '').trim().slice(0, 500);
  const input = Array.isArray(req.body.items) ? req.body.items : [];
  if (!input.length) {
    return res.status(400).json({ error: 'La commande doit contenir au moins un article. Pour tout retirer, annulez-la.' });
  }

  // Lignes existantes, par produit.
  const oldByProduct = new Map();
  for (const it of order.items) {
    const key = it.product_id != null ? it.product_id : 'name:' + it.product_name;
    const prev = oldByProduct.get(key);
    if (prev) prev.quantity += it.quantity;
    else oldByProduct.set(key, { ...it });
  }

  // Nouvelle composition (fusion des doublons).
  const getProduct = db.prepare('SELECT * FROM products WHERE id = ?');
  const next = new Map();
  for (const it of input) {
    const pid = parseInt(it.product_id, 10);
    const qty = Math.min(99, Math.max(1, parseInt(it.quantity, 10) || 1));
    if (!pid) continue;
    const replaces = it.replaces != null ? parseInt(it.replaces, 10) : null;
    if (next.has(pid)) { next.get(pid).quantity += qty; continue; }

    const old = oldByProduct.get(pid);
    if (old) {
      next.set(pid, { product_id: pid, product_name: old.product_name, unit_price: old.unit_price, quantity: qty, replaces });
    } else {
      const product = getProduct.get(pid);
      if (!product) return res.status(400).json({ error: 'Produit introuvable (#' + pid + ').' });
      if (!product.available) return res.status(400).json({ error: product.name + ' est indisponible.' });
      next.set(pid, { product_id: pid, product_name: product.name, unit_price: product.price, quantity: qty, replaces });
    }
  }
  if (!next.size) return res.status(400).json({ error: 'Aucun article valide.' });

  // Description lisible des changements (affichée au client et dans l'historique).
  const changes = [];
  const replacedOld = new Set();
  for (const n of next.values()) {
    if (oldByProduct.has(n.product_id)) continue;
    const old = n.replaces != null ? oldByProduct.get(n.replaces) : null;
    if (old && !next.has(n.replaces)) {
      replacedOld.add(n.replaces);
      changes.push(`Remplacé : ${old.quantity} × ${old.product_name} (${fmtMoney(old.unit_price)}) → ${n.quantity} × ${n.product_name} (${fmtMoney(n.unit_price)})`);
    } else {
      changes.push(`Ajouté : ${n.quantity} × ${n.product_name} (${fmtMoney(n.unit_price)})`);
    }
  }
  for (const [key, old] of oldByProduct) {
    if (replacedOld.has(key)) continue;
    const n = next.get(key);
    if (!n) changes.push(`Retiré : ${old.quantity} × ${old.product_name}`);
    else if (n.quantity !== old.quantity) changes.push(`Quantité : ${old.product_name} ${old.quantity} → ${n.quantity}`);
  }
  if (!changes.length) return res.status(400).json({ error: 'Aucune modification à enregistrer.' });

  const newTotal = [...next.values()].reduce((s, n) => s + n.unit_price * n.quantity, 0);

  db.transaction(() => {
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(id);
    const insItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity) VALUES (?, ?, ?, ?, ?)
    `);
    for (const n of next.values()) insItem.run(id, n.product_id, n.product_name, n.unit_price, n.quantity);

    db.prepare(`
      UPDATE orders SET total = ?, modified_at = datetime('now'), updated_at = datetime('now'), client_ack = 0
      WHERE id = ?
    `).run(newTotal, id);

    db.prepare(`
      INSERT INTO order_modifications (order_id, user_id, user_name, summary, note, old_total, new_total)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.user.id, req.user.name, changes.join('\n'), note || null, order.total, newTotal);
  })();

  const updated = loadOrder(id);
  realtime.broadcast(
    { type: 'order:update', order: updated, by: req.user.role, modified: true },
    { customerId: updated.customer_id }
  );
  res.json({ order: updated });
});

/** CLIENT — Confirme avoir pris connaissance des modifications de sa commande. */
router.post('/:id/ack', authRequired, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
  if (order.customer_id !== req.user.id) return res.status(403).json({ error: 'Accès non autorisé.' });

  db.prepare('UPDATE orders SET client_ack = 1 WHERE id = ?').run(id);
  const updated = loadOrder(id);
  realtime.broadcast({ type: 'order:update', order: updated, by: 'client' }, { customerId: updated.customer_id });
  res.json({ order: updated });
});

module.exports = { router, STATUS_LABELS, STATUSES };
