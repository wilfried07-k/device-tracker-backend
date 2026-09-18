// src/controllers/positionController.js
const geoip = require('geoip-lite');
const db = require('../config/db');
const { redisClient } = require('../config/redis');
const { broadcast } = require('../services/websocket');
const { checkAlerts } = require('../services/alertService');

// Enregistrer une nouvelle position
const savePosition = async (req, res) => {
  const { device_id, latitude, longitude, accuracy, altitude,
          speed, heading, source, wifi_ssid, bluetooth_rssi, battery_level } = req.body;

  if (!device_id || !latitude || !longitude || !source) {
    return res.status(400).json({ error: 'device_id, latitude, longitude, source requis' });
  }

  try {
    // Vérifier que l'appareil appartient à l'utilisateur
    const device = await db.query(
      'SELECT * FROM devices WHERE id = $1 AND user_id = $2',
      [device_id, req.user.id]
    );
    if (!device.rows.length) {
      return res.status(403).json({ error: 'Appareil non autorisé' });
    }

    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    const result = await db.query(
      `INSERT INTO positions
        (device_id, latitude, longitude, accuracy, altitude, speed, heading,
         source, ip_address, wifi_ssid, bluetooth_rssi, battery_level)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [device_id, latitude, longitude, accuracy, altitude, speed, heading,
       source, ipAddress, wifi_ssid, bluetooth_rssi, battery_level]
    );
    const position = result.rows[0];

    // Mettre à jour last_seen de l'appareil
    await db.query(
      'UPDATE devices SET last_seen = NOW() WHERE id = $1',
      [device_id]
    );

    // Mettre en cache Redis (position actuelle)
    await redisClient.setEx(
      `device:${device_id}:current`,
      3600,
      JSON.stringify(position)
    );

    // Diffuser via WebSocket aux clients connectés
    broadcast(req.user.id, { type: 'POSITION_UPDATE', position });

    // Vérifier les alertes géofence
    await checkAlerts(device_id, req.user.id, latitude, longitude);

    res.status(201).json(position);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur enregistrement position' });
  }
};

// Position actuelle (depuis Redis ou DB)
const getCurrentPosition = async (req, res) => {
  const { deviceId } = req.params;
  try {
    // Vérifier propriétaire
    const device = await db.query(
      'SELECT * FROM devices WHERE id = $1 AND user_id = $2',
      [deviceId, req.user.id]
    );
    if (!device.rows.length) return res.status(404).json({ error: 'Appareil introuvable' });

    // Chercher dans Redis d'abord
    const cached = await redisClient.get(`device:${deviceId}:current`);
    if (cached) return res.json(JSON.parse(cached));

    // Sinon chercher en DB
    const result = await db.query(
      'SELECT * FROM positions WHERE device_id = $1 ORDER BY timestamp DESC LIMIT 1',
      [deviceId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Aucune position' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur récupération position' });
  }
};

// Historique des positions
const getHistory = async (req, res) => {
  const { deviceId } = req.params;
  const { from, to, limit = 100, source } = req.query;

  try {
    // Vérifier propriétaire ou partage valide
    const device = await db.query(
      'SELECT * FROM devices WHERE id = $1 AND user_id = $2',
      [deviceId, req.user.id]
    );
    if (!device.rows.length) return res.status(403).json({ error: 'Accès refusé' });

    let query = `SELECT * FROM positions WHERE device_id = $1`;
    const params = [deviceId];
    let idx = 2;

    if (from) { query += ` AND timestamp >= $${idx++}`; params.push(from); }
    if (to)   { query += ` AND timestamp <= $${idx++}`; params.push(to); }
    if (source){ query += ` AND source = $${idx++}`; params.push(source); }

    query += ` ORDER BY timestamp DESC LIMIT $${idx}`;
    params.push(parseInt(limit));

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur récupération historique' });
  }
};

// Géolocalisation par adresse IP
const geolocateIP = async (req, res) => {
  const ip = req.query.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  try {
    const geo = geoip.lookup(ip);
    if (!geo) return res.status(404).json({ error: 'IP non localisable' });
    res.json({
      ip,
      latitude: geo.ll[0],
      longitude: geo.ll[1],
      city: geo.city,
      region: geo.region,
      country: geo.country,
      timezone: geo.timezone,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur géolocalisation IP' });
  }
};

module.exports = { savePosition, getCurrentPosition, getHistory, geolocateIP };
