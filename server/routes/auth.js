'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, authRequired, ROLE_LABELS } = require('../auth');

const router = express.Router();

/**
 * Connexion CLIENT — version simplifiée MVP (nom + téléphone, sans mot de passe),
 * conforme au cahier des charges. Crée le compte client s'il n'existe pas.
 */
router.post('/client-login', (req, res) => {
  const name = (req.body.name || '').trim();
  const phone = (req.body.phone || '').trim();
  if (!name || !phone) {
    return res.status(400).json({ error: 'Nom et téléphone requis.' });
  }

  let user = db.prepare(
    "SELECT * FROM users WHERE role = 'client' AND phone = ?"
  ).get(phone);

  if (!user) {
    const info = db.prepare(
      "INSERT INTO users (role, name, phone) VALUES ('client', ?, ?)"
    ).run(name, phone);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  } else if (user.name !== name) {
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, user.id);
    user.name = name;
  }

  const token = signToken(user);
  res.json({
    token,
    user: { id: user.id, role: user.role, name: user.name, phone: user.phone },
  });
});

/**
 * Connexion STAFF — login + mot de passe.
 * Rôles: callcenter, manager, admin, developer.
 */
router.post('/login', (req, res) => {
  const username = (req.body.username || '').trim().toLowerCase();
  const password = req.body.password || '';
  if (!username || !password) {
    return res.status(400).json({ error: 'Identifiant et mot de passe requis.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Identifiants incorrects.' });
  }

  const token = signToken(user);
  res.json({
    token,
    user: {
      id: user.id,
      role: user.role,
      name: user.name,
      roleLabel: ROLE_LABELS[user.role] || user.role,
    },
  });
});

/** Renvoie l'utilisateur courant à partir du token. */
router.get('/me', authRequired, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      role: req.user.role,
      name: req.user.name,
      roleLabel: ROLE_LABELS[req.user.role] || req.user.role,
    },
  });
});

module.exports = router;
