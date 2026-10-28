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

// Boissons : utiles pour le scénario de remplacement (ex. Coca-Cola indisponible → Panta).
const DRINKS = {
  category: 'Boissons',
  products: [
    { name: 'Coca-Cola 33 cl',      price: 600,  description: 'Canette bien fraîche.' },
    { name: 'Panta 33 cl',          price: 500,  description: "Boisson gazeuse à l'orange." },
    { name: 'Eau minérale 50 cl',   price: 300,  description: 'Eau plate.' },
    { name: 'Jus de bissap',        price: 700,  description: 'Bissap maison, servi frais.' },
  ],
};

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
  DRINKS,
];

// Photos par catégorie (Unsplash). Chargées à l'exécution dans le navigateur.
// Le champ image_url de chaque produit est modifiable depuis l'écran
// « Développeur → Catalogue » : pour changer une photo, il suffit d'y coller
// une autre URL, sans toucher au code.
const U = (id) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=600&q=60`;
const CAT_IMAGE = {
  'Petit déjeuner': U('1525351484163-7529414344d8'),
  'Entrées':        U('1512621776951-a57141f2eefd'),
  'Pizza':          U('1513104890138-7c749659a591'),
  'Sandwich':       U('1528735602780-2552fd46c7af'),
  'Viandes':        U('1544025162-d76694265947'),
  'Glaces':         U('1501443762994-82bd5dab7a72'),
  'Boissons':       U('1622483767028-3f66f32aef97'),
};

const insCatStmt = () => db.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)');
const insProdStmt = () => db.prepare(
  'INSERT INTO products (category_id, name, description, price, image_url, available) VALUES (?, ?, ?, ?, ?, 1)'
);

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
    const insCat = insCatStmt();
    const insProd = insProdStmt();
    MENU.forEach((cat, idx) => {
      const info = insCat.run(cat.category, idx);
      const image = CAT_IMAGE[cat.category] || null;
      for (const p of cat.products) {
        insProd.run(info.lastInsertRowid, p.name, p.description, p.price, image);
      }
    });
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('seed_drinks', '1')").run();
  }

  // Bases créées avant l'ajout des boissons : on les ajoute une seule fois
  // (un drapeau évite de les recréer si le restaurant les supprime ensuite).
  const drinksSeeded = db.prepare("SELECT value FROM settings WHERE key = 'seed_drinks'").get();
  if (!drinksSeeded) {
    const hasCat = db.prepare('SELECT id FROM categories WHERE name = ?').get(DRINKS.category);
    if (!hasCat) {
      const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories').get().m;
      const info = insCatStmt().run(DRINKS.category, maxOrder + 1);
      const insProd = insProdStmt();
      for (const p of DRINKS.products) {
        insProd.run(info.lastInsertRowid, p.name, p.description, p.price, CAT_IMAGE[DRINKS.category]);
      }
    }
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('seed_drinks', '1')").run();
  }
}

if (require.main === module) {
  ensureSeed();
  console.log('Seed terminé.');
}

module.exports = { ensureSeed };
