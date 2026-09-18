// src/routes/positions.js
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { savePosition, getCurrentPosition, getHistory, geolocateIP } = require('../controllers/positionController');

router.use(authenticate);
router.post('/',                          savePosition);
router.get('/geoip',                      geolocateIP);
router.get('/:deviceId/current',          getCurrentPosition);
router.get('/:deviceId/history',          getHistory);

module.exports = router;
