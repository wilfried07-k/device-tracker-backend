// src/routes/shares.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authenticate } = require('../middleware/auth');
const db = require('../config/db');

router.use(authenticate);

// Créer un lien de partage
router.post('/', async (req, res) => {
  const { device_id, expires_in_hours } = req.body;
  if (!device_id) return res.status(400).json({ error: 'device_id requis' });

  try {
    const device = await db.query(
      'SELECT id FROM devices WHERE id = $1 AND user_id = $2',
      [device_id, req.user.id]
    );
    if (!device.rows.length) return res.status(403).json({ error: 'Accès refusé' });

    const token = uuidv4();
    const expiresAt = expires_in_hours
      ? new Date(Date.now() + expires_in_hours * 3600 * 1000)
      : null;

    const result = await db.query(
      `INSERT INTO shares (device_id, shared_by, token, expires_at)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [device_id, req.user.id, token, expiresAt]
    );
    const share = result.rows[0];
    res.status(201).json({
      ...share,
      share_url: `${process.env.APP_URL}/share/${token}`,
    });
  } catch { res.status(500).json({ error: 'Erreur création partage' }); }
});

// Lister les partages actifs
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT s.*, d.name as device_name
       FROM shares s JOIN devices d ON s.device_id = d.id
       WHERE s.shared_by = $1 AND s.is_active = true
       ORDER BY s.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch { res.status(500).json({ error: 'Erreur' }); }
});

// Révoquer un partage
router.delete('/:id', async (req, res) => {
  try {
    await db.query(
      'UPDATE shares SET is_active = false WHERE id = $1 AND shared_by = $2',
      [req.params.id, req.user.id]
    );
    res.json({ message: 'Partage révoqué' });
  } catch { res.status(500).json({ error: 'Erreur' }); }
});

// Accès public à un partage (pas besoin d'auth)
router.get('/view/:token', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT s.*, d.name as device_name,
        (SELECT row_to_json(p) FROM positions p
         WHERE p.device_id = s.device_id ORDER BY p.timestamp DESC LIMIT 1) AS last_position
       FROM shares s JOIN devices d ON s.device_id = d.id
       WHERE s.token = $1 AND s.is_active = true
       AND (s.expires_at IS NULL OR s.expires_at > NOW())`,
      [req.params.token]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Lien invalide ou expiré' });
    res.json(result.rows[0]);
  } catch { res.status(500).json({ error: 'Erreur' }); }
});

module.exports = router;
