// src/controllers/deviceController.js
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const db = require('../config/db');

// Lister les appareils de l'utilisateur
const getDevices = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT d.*,
        (SELECT row_to_json(p) FROM positions p
         WHERE p.device_id = d.id ORDER BY p.timestamp DESC LIMIT 1) AS last_position
       FROM devices d WHERE d.user_id = $1 ORDER BY d.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur récupération appareils' });
  }
};

// Créer un appareil
const createDevice = async (req, res) => {
  const { name, type, identifier } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'Nom et type requis' });

  try {
    const qrToken = uuidv4();
    const trackingLink = `${process.env.APP_URL}/track/${qrToken}`;

    // Générer QR code en base64
    const qrCodeImage = await QRCode.toDataURL(trackingLink);

    const result = await db.query(
      `INSERT INTO devices (user_id, name, type, identifier, qr_token, tracking_link)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.user.id, name, type, identifier || null, qrToken, trackingLink]
    );
    res.status(201).json({ ...result.rows[0], qr_code_image: qrCodeImage });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur création appareil' });
  }
};

// Modifier un appareil
const updateDevice = async (req, res) => {
  const { id } = req.params;
  const { name, type, identifier, is_active } = req.body;
  try {
    const result = await db.query(
      `UPDATE devices SET name = COALESCE($1, name),
        type = COALESCE($2, type),
        identifier = COALESCE($3, identifier),
        is_active = COALESCE($4, is_active)
       WHERE id = $5 AND user_id = $6 RETURNING *`,
      [name, type, identifier, is_active, id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Appareil introuvable' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur mise à jour' });
  }
};

// Supprimer un appareil
const deleteDevice = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      'DELETE FROM devices WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Appareil introuvable' });
    res.json({ message: 'Appareil supprimé' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur suppression' });
  }
};

// Regénérer QR code
const regenerateQR = async (req, res) => {
  const { id } = req.params;
  try {
    const qrToken = uuidv4();
    const trackingLink = `${process.env.APP_URL}/track/${qrToken}`;
    const qrCodeImage = await QRCode.toDataURL(trackingLink);

    const result = await db.query(
      `UPDATE devices SET qr_token = $1, tracking_link = $2
       WHERE id = $3 AND user_id = $4 RETURNING *`,
      [qrToken, trackingLink, id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Appareil introuvable' });
    res.json({ ...result.rows[0], qr_code_image: qrCodeImage });
  } catch (err) {
    res.status(500).json({ error: 'Erreur régénération QR' });
  }
};

module.exports = { getDevices, createDevice, updateDevice, deleteDevice, regenerateQR };
