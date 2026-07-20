'use strict';

const bcrypt = require('bcryptjs');
const db = require('./db');

/**
 * Seed idempotent : comptes staff de démonstration + menu de départ.
 * N'insère rien si les données existent déjà.
 */
const STAFF = [
  { role: 'admin',      name: 'Administrateur',            username: 'admin',      password: 'admin123' },
  { role: 'manager',    name: 'Gérant du restaurant',      username: 'gerant',     password: 'gerant123' },
  { role: 'callcenter', name: 'Agent call center',         username: 'callcenter', password: 'call123' },
  { role: 'developer',  name: 'Développeur',               username: 'dev',        password: 'dev123' },
];

const MENU = [
  {
    category: 'Petit déjeuner',
    products: [
      { name: 'Bouillie de mil',      price: 500,  description: 'Bouillie chaude épicée, servie avec du pain.' },
      { name: 'Omelette complète',    price: 1500, description: 'Omelette 3 œufs, oignons, tomates, pain.' },
      { name: 'Café + Croissant',     price: 1000, description: 'Café au lait et croissant beurré.' },
    ],
  },
  {
    category: 'Entrées',
    products: [
      { name: 'Salade César',         price: 2500, description: 'Salade, poulet grillé, croûtons, parmesan.' },
      { name: 'Avocat crevettes',     price: 3000, description: 'Demi-avocat garni de crevettes et sauce cocktail.' },
    ],
  },
  {
    category: 'Pizza',
    products: [
      { name: 'Pizza Margherita',     price: 4000, description: 'Tomate, mozzarella, basilic.' },
      { name: 'Pizza Reine',          price: 5000, description: 'Tomate, jambon, champignons, fromage.' },
      { name: 'Pizza 4 fromages',     price: 5500, description: 'Mozzarella, chèvre, bleu, parmesan.' },
    ],
  },
  {
    category: 'Sandwich',
    products: [
      { name: 'Sandwich poulet',      price: 2000, description: 'Pain, poulet grillé, crudités, sauce.' },
      { name: 'Shawarma bœuf',        price: 2500, description: 'Bœuf mariné, légumes, sauce ail.' },
    ],
  },
  {
    category: 'Viandes',
    products: [
      { name: 'Poulet braisé',        price: 3500, description: 'Demi-poulet braisé, attiéké ou frites.' },
      { name: 'Brochettes de bœuf',   price: 3000, description: 'Brochettes grillées, sauce piquante.' },
      { name: 'Poisson braisé',       price: 4000, description: 'Poisson entier braisé, alloco.' },
    ],
  },
  {
    category: 'Glaces',
    products: [
      { name: 'Glace vanille',        price: 1000, description: '2 boules vanille.' },
      { name: 'Glace chocolat',       price: 1000, description: '2 boules chocolat.' },
      { name: 'Coupe fruits',         price: 1800, description: 'Glace et fruits frais de saison.' },
    ],
  },
];

// Images d'illustration (SVG data-URI par catégorie) — placeholders légers, sans réseau.
function placeholder(label, color) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='260'><rect width='400' height='260' fill='${color}'/><text x='50%' y='50%' fill='white' font-family='sans-serif' font-size='26' text-anchor='middle' dominant-baseline='middle'>${label}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
const CAT_COLORS = {
  'Petit déjeuner': '#e67e22', 'Entrées': '#27ae60', 'Pizza': '#c0392b',
  'Sandwich': '#8e44ad', 'Viandes': '#a04000', 'Glaces': '#2980b9',
};

function ensureSeed() {
  // Staff
  const insStaff = db.prepare(
    'INSERT INTO users (role, name, username, password_hash) VALUES (?, ?, ?, ?)'
  );
  for (const s of STAFF) {
    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(s.username);
    if (!exists) {
      insStaff.run(s.role, s.name, s.username, bcrypt.hashSync(s.password, 10));
    }
  }

  // Menu
  const catCount = db.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
  if (catCount === 0) {
    const insCat = db.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)');
    const insProd = db.prepare(
      'INSERT INTO products (category_id, name, description, price, image_url, available) VALUES (?, ?, ?, ?, ?, 1)'
    );
    MENU.forEach((cat, idx) => {
      const info = insCat.run(cat.category, idx);
      const color = CAT_COLORS[cat.category] || '#555';
      for (const p of cat.products) {
        insProd.run(info.lastInsertRowid, p.name, p.description, p.price, placeholder(p.name, color));
      }
    });
  }
}

if (require.main === module) {
  ensureSeed();
  console.log('Seed terminé.');
}

module.exports = { ensureSeed };
