// src/controllers/authController.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const { sendSMS } = require('../services/sms');
const { sendEmail } = require('../services/email');

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// Inscription
const register = async (req, res) => {
  const { name, email, password, phone } = req.body;
  try {
    const existing = await db.query(
      'SELECT id FROM users WHERE email = $1', [email]
    );
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Email déjà utilisé' });
    }
    const hash = await bcrypt.hash(password, 12);
    const result = await db.query(
      `INSERT INTO users (name, email, password_hash, phone)
       VALUES ($1, $2, $3, $4) RETURNING id, name, email, phone`,
      [name, email, hash, phone || null]
    );
    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN,
    });
    res.status(201).json({ user, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de l\'inscription' });
  }
};

// Connexion
const login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await db.query(
      'SELECT * FROM users WHERE email = $1', [email]
    );
    if (!result.rows.length) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Identifiants incorrects' });

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN,
    });
    const { password_hash, ...safeUser } = user;
    res.json({ user: safeUser, token });
  } catch (err) {
    res.status(500).json({ error: 'Erreur connexion' });
  }
};

// Envoyer OTP par SMS
const sendSMSOTP = async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Numéro requis' });

  const code = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

  try {
    // Supprimer anciens OTPs
    await db.query(
      'DELETE FROM otp_verifications WHERE identifier = $1 AND type = $2',
      [phone, 'sms']
    );
    await db.query(
      `INSERT INTO otp_verifications (identifier, code, type, expires_at)
       VALUES ($1, $2, 'sms', $3)`,
      [phone, code, expiresAt]
    );
    await sendSMS(phone, `Votre code de vérification Device Tracker : ${code}. Valable 10 minutes.`);
    res.json({ message: 'Code SMS envoyé' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur envoi SMS' });
  }
};

// Envoyer OTP par Email
const sendEmailOTP = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requis' });

  const code = generateOTP();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min

  try {
    await db.query(
      'DELETE FROM otp_verifications WHERE identifier = $1 AND type = $2',
      [email, 'email']
    );
    await db.query(
      `INSERT INTO otp_verifications (identifier, code, type, expires_at)
       VALUES ($1, $2, 'email', $3)`,
      [email, code, expiresAt]
    );
    await sendEmail(email, 'Votre code de vérification', `
      <h2>Device Tracker</h2>
      <p>Votre code de vérification est : <strong style="font-size:24px">${code}</strong></p>
      <p>Ce code est valable 15 minutes.</p>
    `);
    res.json({ message: 'Code email envoyé' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur envoi email' });
  }
};

// Vérifier OTP
const verifyOTP = async (req, res) => {
  const { identifier, code, type } = req.body;
  try {
    const result = await db.query(
      `SELECT * FROM otp_verifications
       WHERE identifier = $1 AND code = $2 AND type = $3
       AND expires_at > NOW() AND used = false`,
      [identifier, code, type]
    );
    if (!result.rows.length) {
      return res.status(400).json({ error: 'Code invalide ou expiré' });
    }
    await db.query(
      'UPDATE otp_verifications SET used = true WHERE id = $1',
      [result.rows[0].id]
    );
    // Lier l'identifiant à l'appareil si besoin (géré côté client)
    res.json({ verified: true, identifier });
  } catch (err) {
    res.status(500).json({ error: 'Erreur vérification OTP' });
  }
};

module.exports = { register, login, sendSMSOTP, sendEmailOTP, verifyOTP };
