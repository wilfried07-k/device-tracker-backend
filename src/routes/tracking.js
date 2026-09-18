// src/routes/tracking.js
const express = require('express');
const router = express.Router();
const geoip = require('geoip-lite');
const db = require('../config/db');
const { broadcast } = require('../services/websocket');

// Lien public scanné via QR code (navigateur web de l'appareil cible)
router.get('/:token', async (req, res) => {
  const { token } = req.params;
  try {
    const device = await db.query(
      `SELECT d.*, u.id as owner_id FROM devices d
       JOIN users u ON d.user_id = u.id
       WHERE d.qr_token = $1 AND d.is_active = true`,
      [token]
    );

    if (!device.rows.length) {
      return res.status(404).send('<h2>Lien invalide ou expiré</h2>');
    }

    const dev = device.rows[0];
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const geo = geoip.lookup(ip);

    if (geo) {
      const [lat, lon] = geo.ll;
      await db.query(
        `INSERT INTO positions
          (device_id, latitude, longitude, source, ip_address)
         VALUES ($1, $2, $3, 'qrcode', $4)`,
        [dev.id, lat, lon, ip]
      );
      await db.query('UPDATE devices SET last_seen = NOW() WHERE id = $1', [dev.id]);

      broadcast(dev.owner_id, {
        type: 'POSITION_UPDATE',
        position: { device_id: dev.id, latitude: lat, longitude: lon, source: 'qrcode', ip }
      });
    }

    // Page HTML minimaliste qui demande la géolocalisation GPS précise
    res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Device Tracker</title>
  <style>
    body { font-family: sans-serif; display:flex; flex-direction:column;
           align-items:center; justify-content:center; min-height:100vh;
           margin:0; background:#f5f5f5; }
    .card { background:white; padding:32px; border-radius:16px;
            box-shadow:0 4px 20px rgba(0,0,0,.1); text-align:center; max-width:320px; }
    h2 { margin:0 0 8px; color:#333; }
    p  { color:#666; margin-bottom:20px; }
    button { background:#4F46E5; color:white; border:none; padding:12px 28px;
             border-radius:8px; font-size:16px; cursor:pointer; }
    .status { color:#4F46E5; margin-top:16px; font-size:14px; }
  </style>
</head>
<body>
  <div class="card">
    <h2> Device Tracker</h2>
    <p>Votre position va être partagée avec le propriétaire de cet appareil.</p>
    <button onclick="shareLocation()">Partager ma position</button>
    <p class="status" id="status"></p>
  </div>
  <script>
    async function shareLocation() {
      const status = document.getElementById('status');
      status.textContent = 'Récupération GPS...';
      if (!navigator.geolocation) {
        status.textContent = 'Géolocalisation non supportée.'; return;
      }
      navigator.geolocation.getCurrentPosition(async (pos) => {
        status.textContent = 'Envoi en cours...';
        try {
          await fetch('/track/${token}/gps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy
            })
          });
          status.textContent = ' Position partagée avec succès !';
        } catch {
          status.textContent = ' Erreur d\'envoi.';
        }
      }, () => { status.textContent = ' Accès GPS refusé.'; });
    }
  </script>
</body>
</html>`);
  } catch (err) {
    console.error(err);
    res.status(500).send('<h2>Erreur serveur</h2>');
  }
});

// Réception position GPS précise depuis la page web
router.post('/:token/gps', async (req, res) => {
  const { token } = req.params;
  const { latitude, longitude, accuracy } = req.body;
  try {
    const device = await db.query(
      `SELECT d.*, u.id as owner_id FROM devices d
       JOIN users u ON d.user_id = u.id
       WHERE d.qr_token = $1 AND d.is_active = true`,
      [token]
    );
    if (!device.rows.length) return res.status(404).json({ error: 'Lien invalide' });

    const dev = device.rows[0];
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    const result = await db.query(
      `INSERT INTO positions (device_id, latitude, longitude, accuracy, source, ip_address)
       VALUES ($1, $2, $3, $4, 'qrcode_gps', $5) RETURNING *`,
      [dev.id, latitude, longitude, accuracy, ip]
    );

    await db.query('UPDATE devices SET last_seen = NOW() WHERE id = $1', [dev.id]);
    broadcast(dev.owner_id, { type: 'POSITION_UPDATE', position: result.rows[0] });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur' });
  }
});

module.exports = router;
