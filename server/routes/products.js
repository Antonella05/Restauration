'use strict';

const express = require('express');
const db = require('../db');
const { requireRole } = require('../auth');

const router = express.Router();

// Gestion du catalogue: Développeur (service après installation) + Administrateur.
const manage = requireRole('developer', 'admin');

/** Liste complète (y compris produits indisponibles) pour l'administration. */
router.get('/', manage, (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all();
  const products = db.prepare('SELECT * FROM products ORDER BY category_id, name').all();
  res.json({ categories, products });
});

/** Créer une catégorie. */
router.post('/categories', manage, (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nom de catégorie requis.' });
  const order = parseInt(req.body.sort_order, 10) || 0;
  const info = db.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)').run(name, order);
  res.status(201).json({ category: db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid) });
});

/** Supprimer une catégorie (et ses produits). */
router.delete('/categories/:id', manage, (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(parseInt(req.params.id, 10));
  res.json({ ok: true });
});

/** Créer un produit. */
router.post('/', manage, (req, res) => {
  const categoryId = parseInt(req.body.category_id, 10);
  const name = (req.body.name || '').trim();
  const price = Math.max(0, parseInt(req.body.price, 10) || 0);
  const description = (req.body.description || '').trim();
  const imageUrl = (req.body.image_url || '').trim();
  const available = req.body.available === false || req.body.available === 0 ? 0 : 1;

  if (!categoryId || !name) {
    return res.status(400).json({ error: 'Catégorie et nom requis.' });
  }
  const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId);
  if (!cat) return res.status(400).json({ error: 'Catégorie introuvable.' });

  const info = db.prepare(`
    INSERT INTO products (category_id, name, description, price, image_url, available)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(categoryId, name, description || null, price, imageUrl || null, available);

  res.status(201).json({ product: db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid) });
});

/** Modifier un produit. */
router.put('/:id', manage, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Produit introuvable.' });

  const categoryId = req.body.category_id != null ? parseInt(req.body.category_id, 10) : existing.category_id;
  const name = req.body.name != null ? String(req.body.name).trim() : existing.name;
  const price = req.body.price != null ? Math.max(0, parseInt(req.body.price, 10) || 0) : existing.price;
  const description = req.body.description != null ? String(req.body.description).trim() : existing.description;
  const imageUrl = req.body.image_url != null ? String(req.body.image_url).trim() : existing.image_url;
  const available = req.body.available != null ? (req.body.available ? 1 : 0) : existing.available;

  db.prepare(`
    UPDATE products SET category_id = ?, name = ?, description = ?, price = ?, image_url = ?, available = ?
    WHERE id = ?
  `).run(categoryId, name, description || null, price, imageUrl || null, available, id);

  res.json({ product: db.prepare('SELECT * FROM products WHERE id = ?').get(id) });
});

/** Supprimer un produit. */
router.delete('/:id', manage, (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(parseInt(req.params.id, 10));
  res.json({ ok: true });
});

module.exports = router;
