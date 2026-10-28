'use strict';

const express = require('express');
const { requireRole } = require('../auth');
const { getSettings, updateSettings } = require('../settings');
const realtime = require('../realtime');

const router = express.Router();

/** Public : identité et informations du restaurant (affichées côté client et staff). */
router.get('/', (req, res) => {
  res.json({ settings: getSettings() });
});

/** Personnalisation : Administrateur + Développeur (paramétrage à l'installation). */
router.put('/', requireRole('admin', 'developer'), (req, res) => {
  try {
    const settings = updateSettings(req.body || {});
    realtime.broadcast({ type: 'settings:update' });
    res.json({ settings });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
