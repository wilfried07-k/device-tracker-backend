// src/services/websocket.js
const jwt = require('jsonwebtoken');

// Map userId -> Set de connexions WS
const connections = new Map();

const setupWebSocket = (wss) => {
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'ws://localhost');
    const token = url.searchParams.get('token');

    if (!token) { ws.close(4001, 'Token manquant'); return; }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const userId = decoded.userId;

      if (!connections.has(userId)) connections.set(userId, new Set());
      connections.get(userId).add(ws);

      console.log(`📡 WS connecté: user ${userId}`);

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'PING') ws.send(JSON.stringify({ type: 'PONG' }));
        } catch {}
      });

      ws.on('close', () => {
        connections.get(userId)?.delete(ws);
        if (connections.get(userId)?.size === 0) connections.delete(userId);
        console.log(`📡 WS déconnecté: user ${userId}`);
      });

      ws.on('error', (err) => console.error('WS error:', err));
      ws.send(JSON.stringify({ type: 'CONNECTED', userId }));
    } catch {
      ws.close(4001, 'Token invalide');
    }
  });
};

const broadcast = (userId, data) => {
  const userConns = connections.get(userId);
  if (!userConns) return;
  const message = JSON.stringify(data);
  for (const ws of userConns) {
    if (ws.readyState === 1) ws.send(message); // 1 = OPEN
  }
};

module.exports = { setupWebSocket, broadcast };
