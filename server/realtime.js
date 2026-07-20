'use strict';

const { WebSocketServer } = require('ws');
const { verifyToken } = require('./auth');

/**
 * Hub temps réel basé sur WebSocket.
 * Les clients staff (callcenter/manager/admin/developer) reçoivent tous les
 * événements de commande. Un client final ne reçoit que les événements liés
 * à ses propres commandes (par téléphone / id).
 */
let wss = null;

function init(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    // Le token est passé en query string: /ws?token=...
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const payload = token ? verifyToken(token) : null;

    ws.meta = payload
      ? { role: payload.role, userId: payload.id }
      : { role: 'guest', userId: null };

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => {});
    ws.send(JSON.stringify({ type: 'connected', role: ws.meta.role }));
  });

  // Ping périodique pour nettoyer les connexions mortes.
  const interval = setInterval(() => {
    if (!wss) return;
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      try { ws.ping(); } catch (e) {}
    });
  }, 30000);

  wss.on('close', () => clearInterval(interval));
}

const STAFF_ROLES = ['callcenter', 'manager', 'admin', 'developer'];

/**
 * Diffuse un événement.
 * @param {object} event  { type, order, ... }
 * @param {object} opts   { customerId } pour cibler aussi le client concerné
 */
function broadcast(event, opts = {}) {
  if (!wss) return;
  const data = JSON.stringify(event);
  wss.clients.forEach((ws) => {
    if (ws.readyState !== ws.OPEN) return;
    const m = ws.meta || {};
    const isStaff = STAFF_ROLES.includes(m.role);
    const isTargetClient =
      m.role === 'client' && opts.customerId && m.userId === opts.customerId;
    if (isStaff || isTargetClient) {
      try { ws.send(data); } catch (e) {}
    }
  });
}

module.exports = { init, broadcast };
