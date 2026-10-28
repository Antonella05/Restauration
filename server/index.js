'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');

require('./db');            // initialise le schéma
require('./seed').ensureSeed(); // seed idempotent au démarrage

const authRoutes = require('./routes/auth');
const menuRoutes = require('./routes/menu');
const { router: orderRoutes } = require('./routes/orders');
const productRoutes = require('./routes/products');
const settingsRoutes = require('./routes/settings');
const realtime = require('./realtime');

const app = express();
app.use(express.json({ limit: '2mb' })); // logo importé en data URL
app.use(cookieParser());

// API
app.use('/api/auth', authRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/products', productRoutes);
app.use('/api/settings', settingsRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// Fichiers statiques (front web)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Fallback: renvoyer l'app cliente
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
realtime.init(server);

server.listen(PORT, () => {
  console.log(`\n🍽️  Restaurant MVP — serveur web démarré`);
  console.log(`    Client  : http://localhost:${PORT}/`);
  console.log(`    Staff   : http://localhost:${PORT}/staff.html\n`);
});

module.exports = server;
