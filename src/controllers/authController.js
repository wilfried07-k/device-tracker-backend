// src/controllers/authController.js

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { sendSMS } = require('../services/sms');
const { sendEmail } = require('../services/email');

// =====================================================
// GÉNÉRATION OTP
// =====================================================
const generateOTP = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

// =====================================================
// INSCRIPTION
// =====================================================
const register = async (req, res) => {
  const { name, email, password, phone } = req.body;

  try {
    // Vérification des champs obligatoires
    if (!name || !email || !password) {
      return res.status(400).json({
        error: 'Le nom, l\'email et le mot de passe sont obligatoires',
      });
    }

    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPhone = phone ? phone.trim() : null;
    const phoneCheck = normalizedPhone ?? '';

    // Vérifier si l'email ou le téléphone existe déjà
    const existing = await db.query(
      `SELECT id, email, phone
       FROM users
       WHERE email = $1
          OR (phone IS NOT NULL AND phone = $2)
       LIMIT 1`,
      [normalizedEmail, phoneCheck]
    );

    if (existing.rows.length > 0) {
      const existingUser = existing.rows[0];

      // Email déjà utilisé
      if (existingUser.email === normalizedEmail) {
        return res.status(409).json({
          error: 'Cet email est déjà utilisé',
        });
      }

      // Téléphone déjà utilisé
      if (
        normalizedPhone &&
        existingUser.phone === normalizedPhone
      ) {
        return res.status(409).json({
          error: 'Ce numéro de téléphone est déjà utilisé',
        });
      }
    }

    // Hash du mot de passe
    const hash = await bcrypt.hash(password, 12);

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
        normalizedName,
        normalizedEmail,
        hash,
        normalizedPhone,
      ]
    );

    const user = result.rows[0];

    // Vérifier JWT_SECRET
    if (!process.env.JWT_SECRET) {
      console.error('❌ JWT_SECRET non configuré');

      return res.status(500).json({
        error: 'Configuration serveur JWT manquante',
      });
    }

    // Génération du token JWT
    const token = jwt.sign(
      {
        userId: user.id,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
      }
    );

    console.log('✅ Inscription réussie :', user.email);

    return res.status(201).json({
      message: 'Inscription réussie',
      user,
      token,
    });

  } catch (err) {
    console.error('❌ ERREUR INSCRIPTION :', err);

    // Gestion des doublons PostgreSQL
    if (err.code === '23505') {

      if (err.constraint === 'users_phone_key') {
        return res.status(409).json({
          error: 'Ce numéro de téléphone est déjà utilisé',
        });
      }

      if (err.constraint === 'users_email_key') {
        return res.status(409).json({
          error: 'Cet email est déjà utilisé',
        });
      }

      return res.status(409).json({
        error: 'Ces informations existent déjà',
      });
    }

    return res.status(500).json({
      error: 'Erreur lors de l\'inscription',
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

    const normalizedEmail = email.trim().toLowerCase();

    const result = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [normalizedEmail]
    );

    if (!result.rows.length) {
      return res.status(401).json({
        error: 'Identifiants incorrects',
      });
    }

    const user = result.rows[0];

    // Vérifier le mot de passe
    const valid = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!valid) {
      return res.status(401).json({
        error: 'Identifiants incorrects',
      });
    }

    // Vérifier JWT_SECRET
    if (!process.env.JWT_SECRET) {
      console.error('❌ JWT_SECRET non configuré');

      return res.status(500).json({
        error: 'Configuration serveur JWT manquante',
      });
    }

    // Génération du token
    const token = jwt.sign(
      {
        userId: user.id,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
      }
    );

    // Ne jamais retourner le hash du mot de passe
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
    // Supprimer les anciens OTP SMS
    await db.query(
      `DELETE FROM otp_verifications
       WHERE identifier = $1
       AND type = $2`,
      [phone, 'sms']
    );

    // Enregistrer le nouvel OTP
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

    // Envoyer le SMS
    await sendSMS(
      phone,
      `Votre code de vérification Device Tracker : ${code}. Valable 10 minutes.`
    );

    return res.json({
      message: 'Code SMS envoyé',
    });

  } catch (err) {
    console.error('❌ ERREUR ENVOI SMS :', err);

    return res.status(500).json({
      error: 'Erreur envoi SMS',
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

  const normalizedEmail = email.trim().toLowerCase();

  const code = generateOTP();

  const expiresAt = new Date(
    Date.now() + 15 * 60 * 1000
  );

  try {
    // Supprimer les anciens OTP email
    await db.query(
      `DELETE FROM otp_verifications
       WHERE identifier = $1
       AND type = $2`,
      [normalizedEmail, 'email']
    );

    // Enregistrer le nouvel OTP
    await db.query(
      `INSERT INTO otp_verifications (
        identifier,
        code,
        type,
        expires_at
      )
      VALUES ($1, $2, 'email', $3)`,
      [
        normalizedEmail,
        code,
        expiresAt,
      ]
    );

    // Envoyer l'email
    await sendEmail(
      normalizedEmail,
      'Votre code de vérification',
      `
        <h2>Device Tracker</h2>

        <p>
          Votre code de vérification est :
          <strong style="font-size:24px">
            ${code}
          </strong>
        </p>

        <p>
          Ce code est valable pendant 15 minutes.
        </p>
      `
    );

    return res.json({
      message: 'Code email envoyé',
    });

  } catch (err) {
    console.error('❌ ERREUR ENVOI EMAIL :', err);

    return res.status(500).json({
      error: 'Erreur envoi email',
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

    // Marquer l'OTP comme utilisé
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