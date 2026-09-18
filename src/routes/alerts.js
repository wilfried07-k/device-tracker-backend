// src/routes/alerts.js
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const db = require('../config/db');

router.use(authenticate);

// Lister les alertes
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT a.*, d.name as device_name FROM alerts a
       JOIN devices d ON a.device_id = d.id
       WHERE a.user_id = $1 ORDER BY a.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Erreur' }); }
});

// Créer une alerte
router.post('/', async (req, res) => {
  const { device_id, type, name, config } = req.body;
  if (!device_id || !type || !name || !config) {
    return res.status(400).json({ error: 'Champs requis manquants' });
  }
  try {
    const result = await db.query(
      `INSERT INTO alerts (user_id, device_id, type, name, config)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.id, device_id, type, name, JSON.stringify(config)]
    );
    res.status(201).json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Erreur création alerte' }); }
});

// Activer/désactiver
router.patch('/:id/toggle', async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE alerts SET is_active = NOT is_active
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Alerte introuvable' });
    res.json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Erreur' }); }
});

// Supprimer
router.delete('/:id', async (req, res) => {
  try {
    await db.query(
      'DELETE FROM alerts WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ message: 'Alerte supprimée' });
  } catch { res.status(500).json({ error: 'Erreur' }); }
});

// Historique événements
router.get('/events', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT ae.*, a.name as alert_name, d.name as device_name
       FROM alert_events ae
       JOIN alerts a ON ae.alert_id = a.id
       JOIN devices d ON ae.device_id = d.id
       WHERE a.user_id = $1 ORDER BY ae.triggered_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Erreur' }); }
});

module.exports = router;
