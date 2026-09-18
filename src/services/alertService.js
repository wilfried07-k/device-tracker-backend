// src/services/alertService.js
const db = require('../config/db');
const { sendSMS } = require('./sms');
const { sendEmail } = require('./email');
const { broadcast } = require('./websocket');

// Calcul distance Haversine en mètres
const haversineDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371000;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
};

const checkAlerts = async (deviceId, userId, latitude, longitude) => {
  try {
    const alerts = await db.query(
      `SELECT * FROM alerts
       WHERE device_id = $1 AND user_id = $2 AND is_active = true`,
      [deviceId, userId]
    );

    for (const alert of alerts.rows) {
      const config = alert.config;

      if (alert.type === 'geofence_exit' || alert.type === 'geofence_enter') {
        const dist = haversineDistance(
          latitude, longitude,
          config.center_lat, config.center_lng
        );
        const isInside = dist <= config.radius_meters;
        const shouldTrigger =
          (alert.type === 'geofence_exit' && !isInside) ||
          (alert.type === 'geofence_enter' && isInside);

        if (shouldTrigger) {
          const message = alert.type === 'geofence_exit'
            ? ` Appareil "${alert.name}" a quitté la zone "${config.zone_name || 'définie'}"`
            : ` Appareil "${alert.name}" est entré dans la zone "${config.zone_name || 'définie'}"`;

          await triggerAlert(alert, deviceId, null, message, userId);
        }
      }
    }
  } catch (err) {
    console.error('Erreur vérification alertes:', err);
  }
};

const triggerAlert = async (alert, deviceId, positionId, message, userId) => {
  try {
    // Enregistrer l'événement
    await db.query(
      `INSERT INTO alert_events (alert_id, device_id, position_id, message)
       VALUES ($1, $2, $3, $4)`,
      [alert.id, deviceId, positionId, message]
    );

    // Notifier via WebSocket
    broadcast(userId, { type: 'ALERT', alert: { ...alert, message } });

    // Récupérer infos user pour SMS/Email
    const user = await db.query(
      'SELECT email, phone FROM users WHERE id = $1', [userId]
    );
    if (!user.rows.length) return;
    const { email, phone } = user.rows[0];

    // Envoyer SMS si numéro disponible
    if (phone) {
      await sendSMS(phone, message).catch(console.error);
    }

    // Envoyer email
    if (email) {
      await sendEmail(email, `Alerte Device Tracker`, `
        <h2>⚠️ Alerte de localisation</h2>
        <p>${message}</p>
        <p>Connectez-vous à votre app pour voir la position.</p>
      `).catch(console.error);
    }
  } catch (err) {
    console.error('Erreur déclenchement alerte:', err);
  }
};

module.exports = { checkAlerts, triggerAlert };
