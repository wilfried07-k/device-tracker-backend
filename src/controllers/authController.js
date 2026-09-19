// src/controllers/authController.js

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { sendSMS } = require('../services/sms');
const { sendEmail } = require('../services/email');

const generateOTP = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

// =====================================================
// INSCRIPTION
// =====================================================
const register = async (req, res) => {
  const { name, email, password, phone } = req.body;

  console.log('📥 INSCRIPTION REÇUE');

  try {
    // Vérification des champs obligatoires
    if (!name || !email || !password) {
      return res.status(400).json({
        error: 'Le nom, l\'email et le mot de passe sont obligatoires',
      });
    }

    console.log('🔎 Vérification de l\'email...');

    // Vérifier si l'utilisateur existe déjà
    const existing = await db.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existing.rows.length > 0) {
      console.log('⚠️ Email déjà utilisé');

      return res.status(409).json({
        error: 'Email déjà utilisé',
      });
    }

    console.log('🔐 Hash du mot de passe...');

    // Hash du mot de passe
    const hash = await bcrypt.hash(password, 12);

    console.log('💾 Création de l\'utilisateur...');

    // Création de l'utilisateur
    const result = await db.query(
      `INSERT INTO users (
        name,
        email,
        password_hash,
        phone
      )
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, email, phone`,
      [
        name.trim(),
        email.trim().toLowerCase(),
        hash,
        phone || null,
      ]
    );

    const user = result.rows[0];

    console.log('✅ Utilisateur créé :', user.id);

    // Vérifier que JWT_SECRET existe
    if (!process.env.JWT_SECRET) {
      console.error('❌ JWT_SECRET n\'est pas configuré');

      return res.status(500).json({
        error: 'Configuration serveur JWT manquante',
      });
    }

    console.log('🔑 Génération du token...');

    // Génération du JWT
    const token = jwt.sign(
      {
        userId: user.id,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
      }
    );

    console.log('🎉 Inscription terminée avec succès');

    return res.status(201).json({
      message: 'Inscription réussie',
      user,
      token,
    });

  } catch (err) {
    console.error('❌ ERREUR INSCRIPTION :', err);

    // Erreur PostgreSQL : email déjà utilisé
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'Cet email ou numéro de téléphone est déjà utilisé',
      });
    }

    return res.status(500).json({
      error: 'Erreur lors de l\'inscription',
      details: err.message,
    });
  }
};

// =====================================================
// CONNEXION
// =====================================================
const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!email || !password) {
      return res.status(400).json({
        error: 'Email et mot de passe obligatoires',
      });
    }

    const result = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [email.trim().toLowerCase()]
    );

    if (!result.rows.length) {
      return res.status(401).json({
        error: 'Identifiants incorrects',
      });
    }

    const user = result.rows[0];

    const valid = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!valid) {
      return res.status(401).json({
        error: 'Identifiants incorrects',
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        error: 'Configuration serveur JWT manquante',
      });
    }

    const token = jwt.sign(
      {
        userId: user.id,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
      }
    );

    // Ne jamais envoyer le hash du mot de passe
    const {
      password_hash,
      ...safeUser
    } = user;

    return res.json({
      message: 'Connexion réussie',
      user: safeUser,
      token,
    });

  } catch (err) {
    console.error('❌ ERREUR CONNEXION :', err);

    return res.status(500).json({
      error: 'Erreur connexion',
      details: err.message,
    });
  }
};

// =====================================================
// ENVOYER OTP PAR SMS
// =====================================================
const sendSMSOTP = async (req, res) => {
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({
      error: 'Numéro requis',
    });
  }

  const code = generateOTP();
  const expiresAt = new Date(
    Date.now() + 10 * 60 * 1000
  );

  try {
    await db.query(
      `DELETE FROM otp_verifications
       WHERE identifier = $1
       AND type = $2`,
      [phone, 'sms']
    );

    await db.query(
      `INSERT INTO otp_verifications (
        identifier,
        code,
        type,
        expires_at
      )
      VALUES ($1, $2, 'sms', $3)`,
      [phone, code, expiresAt]
    );

    await sendSMS(
      phone,
      `Votre code de vérification Device Tracker : ${code}. Valable 10 minutes.`
    );

    return res.json({
      message: 'Code SMS envoyé',
    });

  } catch (err) {
    console.error('❌ ERREUR SMS OTP :', err);

    return res.status(500).json({
      error: 'Erreur envoi SMS',
      details: err.message,
    });
  }
};

// =====================================================
// ENVOYER OTP PAR EMAIL
// =====================================================
const sendEmailOTP = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      error: 'Email requis',
    });
  }

  const code = generateOTP();
  const expiresAt = new Date(
    Date.now() + 15 * 60 * 1000
  );

  try {
    await db.query(
      `DELETE FROM otp_verifications
       WHERE identifier = $1
       AND type = $2`,
      [email, 'email']
    );

    await db.query(
      `INSERT INTO otp_verifications (
        identifier,
        code,
        type,
        expires_at
      )
      VALUES ($1, $2, 'email', $3)`,
      [email, code, expiresAt]
    );

    await sendEmail(
      email,
      'Votre code de vérification',
      `
        <h2>Device Tracker</h2>
        <p>
          Votre code de vérification est :
          <strong style="font-size:24px">${code}</strong>
        </p>
        <p>Ce code est valable 15 minutes.</p>
      `
    );

    return res.json({
      message: 'Code email envoyé',
    });

  } catch (err) {
    console.error('❌ ERREUR EMAIL OTP :', err);

    return res.status(500).json({
      error: 'Erreur envoi email',
      details: err.message,
    });
  }
};

// =====================================================
// VÉRIFIER OTP
// =====================================================
const verifyOTP = async (req, res) => {
  const {
    identifier,
    code,
    type,
  } = req.body;

  try {
    if (!identifier || !code || !type) {
      return res.status(400).json({
        error: 'Identifier, code et type sont obligatoires',
      });
    }

    const result = await db.query(
      `SELECT *
       FROM otp_verifications
       WHERE identifier = $1
       AND code = $2
       AND type = $3
       AND expires_at > NOW()
       AND used = false`,
      [
        identifier,
        code,
        type,
      ]
    );

    if (!result.rows.length) {
      return res.status(400).json({
        error: 'Code invalide ou expiré',
      });
    }

    await db.query(
      `UPDATE otp_verifications
       SET used = true
       WHERE id = $1`,
      [result.rows[0].id]
    );

    return res.json({
      verified: true,
      identifier,
    });

  } catch (err) {
    console.error('❌ ERREUR VÉRIFICATION OTP :', err);

    return res.status(500).json({
      error: 'Erreur vérification OTP',
      details: err.message,
    });
  }
};

// =====================================================
// EXPORTS
// =====================================================
module.exports = {
  register,
  login,
  sendSMSOTP,
  sendEmailOTP,
  verifyOTP,
};