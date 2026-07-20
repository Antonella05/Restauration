'use strict';

const express = require('express');
const db = require('../db');
const { authRequired, requireRole } = require('../auth');
const realtime = require('../realtime');

const router = express.Router();

const STATUSES = ['pending', 'accepted', 'preparing', 'delivering', 'delivered', 'cancelled'];
const STATUS_LABELS = {
  pending: 'En attente',
  accepted: 'Acceptée',
  preparing: 'En préparation',
  delivering: 'En livraison',
  delivered: 'Livrée',
  cancelled: 'Annulée',
};

function loadOrder(id) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return null;
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id);
  order.statusLabel = STATUS_LABELS[order.status] || order.status;
  return order;
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

  if (!items.length) return res.status(400).json({ error: 'Le panier est vide.' });
  if (!name || !phone) return res.status(400).json({ error: 'Nom et contact requis.' });

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
      INSERT INTO orders (customer_id, customer_name, customer_phone, comment, payment_method, status, total)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).run(req.user.id, name, phone, comment || null, paymentMethod, total);

    const orderId = info.lastInsertRowid;
    const insItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const r of resolved) {
      insItem.run(orderId, r.product.id, r.product.name, r.product.price, r.qty);
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

/** STAFF — Liste des commandes (filtre statut optionnel). */
router.get('/', requireRole('callcenter', 'manager', 'admin', 'developer'), (req, res) => {
  const status = req.query.status;
  let rows;
  if (status && STATUSES.includes(status)) {
    rows = db.prepare('SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC').all(status);
  } else {
    rows = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
  }
  const orders = rows.map((o) => loadOrder(o.id));
  res.json({ orders });
});

/** Détail d'une commande (staff, ou client propriétaire). */
router.get('/:id', authRequired, (req, res) => {
  const order = loadOrder(parseInt(req.params.id, 10));
  if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
  const isStaff = ['callcenter', 'manager', 'admin', 'developer'].includes(req.user.role);
  if (!isStaff && order.customer_id !== req.user.id) {
    return res.status(403).json({ error: 'Accès non autorisé.' });
  }
  res.json({ order });
});

/**
 * STAFF — Mise à jour du statut.
 * - Call center: accepter (pending→accepted) ou annuler.
 * - Gérant/Admin: faire avancer la commande (préparation → livraison → livrée) ou annuler.
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

  db.prepare(`
    UPDATE orders SET status = ?, cancel_reason = ?, updated_at = datetime('now') WHERE id = ?
  `).run(newStatus, newStatus === 'cancelled' ? (cancelReason || null) : null, id);

  const updated = loadOrder(id);
  realtime.broadcast(
    { type: 'order:update', order: updated, by: req.user.role },
    { customerId: updated.customer_id }
  );

  res.json({ order: updated });
});

module.exports = { router, STATUS_LABELS, STATUSES };
