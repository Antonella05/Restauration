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

// Photos provisoires libres de droits (Unsplash), en attendant les photos du restaurant.
// Le champ image_url de chaque produit est modifiable depuis l'écran
// « Développeur → Catalogue » : pour changer une photo, il suffit d'y coller
// une autre URL, sans toucher au code.
const U = (id) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=800&q=70`;
const CAT_IMAGE = {
  'Petit déjeuner': U('1525351484163-7529414344d8'),
  'Entrées':        U('1512621776951-a57141f2eefd'),
  'Pizza':          U('1513104890138-7c749659a591'),
  'Sandwich':       U('1528735602780-2552fd46c7af'),
  'Viandes':        U('1555939594-58d7cb561ad1'),
  'Glaces':         U('1488900128323-21503983a07e'),
  'Boissons':       U('1595981267035-7b04ca84a82d'),
};
const PRODUCT_IMAGE = {
  'Bouillie de mil':    U('1571748982800-fa51082c2224'),
  'Omelette complète':  U('1510693206972-df098062cb71'),
  'Café + Croissant':   U('1555507036-ab1f4038808a'),
  'Salade César':       U('1550304943-4f24f54ddde9'),
  'Avocat crevettes':   U('1565680018434-b513d5e5fd47'),
  'Pizza Margherita':   U('1574071318508-1cdbab80d002'),
  'Pizza Reine':        U('1513104890138-7c749659a591'),
  'Pizza 4 fromages':   U('1593560708920-61dd98c46a4e'),
  'Sandwich poulet':    U('1528735602780-2552fd46c7af'),
  'Shawarma bœuf':      U('1529006557810-274b9b2fc783'),
  'Poulet braisé':      U('1532550907401-a500c9a57435'),
  'Brochettes de bœuf': U('1555939594-58d7cb561ad1'),
  'Poisson braisé':     U('1519708227418-c8fd9a32b7a2'),
  'Glace vanille':      U('1497034825429-c343d7c6a68f'),
  'Glace chocolat':     U('1563805042-7684c019e1cb'),
  'Coupe fruits':       U('1490474418585-ba9bad8fd0ea'),
  'Coca-Cola 33 cl':    U('1554866585-cd94860890b7'),
  'Panta 33 cl':        U('1600271886742-f049cd451bba'),
  'Eau minérale 50 cl': U('1548839140-29a749e1cf4d'),
  'Jus de bissap':      U('1595981267035-7b04ca84a82d'),
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
        insProd.run(info.lastInsertRowid, p.name, p.description, p.price, PRODUCT_IMAGE[p.name] || image);
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
        insProd.run(info.lastInsertRowid, p.name, p.description, p.price, PRODUCT_IMAGE[p.name] || CAT_IMAGE[DRINKS.category]);
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
