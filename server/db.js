'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'restaurant.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Schéma de la base.
 * Rôles: 'client', 'callcenter', 'manager', 'admin', 'developer'
 * Statuts commande: 'pending', 'accepted', 'preparing',
 *   livraison : 'delivering' → 'delivered'
 *   retrait   : 'ready' → 'picked_up' (ou 'no_show' si non récupérée)
 *   'cancelled'
 */
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  role          TEXT NOT NULL,
  name          TEXT NOT NULL,
  phone         TEXT,
  username      TEXT UNIQUE,
  password_hash TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  price       INTEGER NOT NULL DEFAULT 0,       -- prix en FCFA (entier)
  image_url   TEXT,
  available   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id    INTEGER REFERENCES users(id),
  customer_name  TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  comment        TEXT,
  payment_method TEXT NOT NULL DEFAULT 'cash',   -- 'cash' | 'mobile_money'
  status         TEXT NOT NULL DEFAULT 'pending',
  cancel_reason  TEXT,
  total          INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   INTEGER REFERENCES products(id),
  product_name TEXT NOT NULL,
  unit_price   INTEGER NOT NULL,
  quantity     INTEGER NOT NULL DEFAULT 1
);

-- Paramètres du restaurant (identité visuelle, informations, règles) : clé / valeur.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Historique des modifications d'une commande par le centre d'appels.
CREATE TABLE IF NOT EXISTS order_modifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id),
  user_name   TEXT,
  summary     TEXT NOT NULL,                     -- description lisible des changements
  note        TEXT,                              -- motif / commentaire de l'agent
  old_total   INTEGER NOT NULL,
  new_total   INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_mods_order ON order_modifications(order_id);
`);

/** Migration douce : ajoute une colonne si elle n'existe pas encore (bases déjà créées). */
function addColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Informations mémorisées du client (commandes récurrentes).
addColumn('users', 'address', 'TEXT');
addColumn('users', 'latitude', 'REAL');
addColumn('users', 'longitude', 'REAL');
addColumn('users', 'fulfillment', 'TEXT');           // dernier mode de réception choisi

// Mise en avant sur la page d'accueil.
addColumn('products', 'featured', 'INTEGER NOT NULL DEFAULT 0');

// Mode de réception : 'delivery' (livraison) | 'pickup' (retrait sur place).
addColumn('orders', 'fulfillment', "TEXT NOT NULL DEFAULT 'delivery'");
addColumn('orders', 'delivery_address', 'TEXT');
addColumn('orders', 'latitude', 'REAL');
addColumn('orders', 'longitude', 'REAL');
addColumn('orders', 'location_accuracy', 'REAL');
addColumn('orders', 'pickup_time', 'TEXT');          // heure de retrait souhaitée (UTC), NULL = dès que possible
addColumn('orders', 'ready_at', 'TEXT');             // commande prête à retirer
addColumn('orders', 'completed_at', 'TEXT');         // livrée ou retirée (statistiques du jour)
addColumn('orders', 'modified_at', 'TEXT');          // dernière modification par le centre d'appels
addColumn('orders', 'client_ack', 'INTEGER NOT NULL DEFAULT 1'); // 0 = modification non encore lue par le client

db.exec('CREATE INDEX IF NOT EXISTS idx_orders_completed ON orders(completed_at)');

module.exports = db;
