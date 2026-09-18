// src/routes/devices.js
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const {
  getDevices, createDevice, updateDevice, deleteDevice, regenerateQR
} = require('../controllers/deviceController');

router.use(authenticate);
router.get('/',          getDevices);
router.post('/',         createDevice);
router.put('/:id',       updateDevice);
router.delete('/:id',    deleteDevice);
router.post('/:id/qr',   regenerateQR);

module.exports = router;
