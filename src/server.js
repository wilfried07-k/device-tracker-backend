// src/server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { connectRedis } = require('./config/redis');
const authRoutes = require('./routes/auth');
const deviceRoutes = require('./routes/devices');
const positionRoutes = require('./routes/positions');
const alertRoutes = require('./routes/alerts');
const shareRoutes = require('./routes/shares');
const trackingRoutes = require('./routes/tracking');
const { setupWebSocket } = require('./services/websocket');

const app = express();

// Render est derrière un reverse proxy
app.set('trust proxy', 1);

const server = http.createServer(app);

// WebSocket server
const wss = new WebSocket.Server({ server, path: '/ws' });
setupWebSocket(wss);

// Middlewares sécurité
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
}));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));

// Rate limiting global
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 200,
  message: { error: 'Trop de requêtes, réessayez dans 15 minutes.' },
}));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/positions', positionRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/shares', shareRoutes);
app.use('/track', trackingRoutes); // lien public QR code

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// Error handler global
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Erreur interne du serveur',
  });
});

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await connectRedis();
    server.listen(PORT, () => {
      console.log(`🚀 Serveur démarré sur le port ${PORT}`);
     console.log(`📡 WebSocket disponible sur /ws`);
    });
  } catch (err) {
    console.error('Erreur démarrage:', err);
    process.exit(1);
  }
}

start();