// src/services/sms.js
// Initialisation paresseuse : ne plante pas si les clés sont absentes
let _client = null;

const getClient = () => {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    return null;
  }
  if (!_client) {
    const twilio = require('twilio');
    _client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return _client;
};

const sendSMS = async (to, body) => {
  const client = getClient();
  if (!client) {
    // Twilio non configuré : afficher le code dans les logs pour le développement
    console.log(`[SMS simulé] À: ${to} | Message: ${body}`);
    return { simulated: true };
  }
  return client.messages.create({
    body,
    from: process.env.TWILIO_PHONE_NUMBER,
    to,
  });
};

module.exports = { sendSMS };