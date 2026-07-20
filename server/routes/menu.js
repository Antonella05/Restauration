'use strict';

const express = require('express');
const db = require('../db');

const router = express.Router();

/** Menu public: catégories + produits disponibles, chargés depuis la base. */
router.get('/', (req, res) => {
  const categories = db.prepare(
    'SELECT * FROM categories ORDER BY sort_order, name'
  ).all();

  const products = db.prepare(
    'SELECT * FROM products WHERE available = 1 ORDER BY name'
  ).all();

  const byCat = categories.map((c) => ({
    ...c,
    products: products.filter((p) => p.category_id === c.id),
  }));

  res.json({ categories: byCat });
});

module.exports = router;
