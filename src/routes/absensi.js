const express = require('express');
const router  = express.Router();
const { protect, staffOnly } = require('../middleware/auth');
const { imageUploader } = require('../utils/uploader');
const {
  checkIn, checkOut, ajukanIzin, getHariIni, getRiwayat,
  ajukanLembur, getRiwayatLembur,
} = require('../controllers/absensiController');

const upload = imageUploader('absensi'); // 2MB, jpg/png/webp

// Semua endpoint butuh login + role admin/karyawan
router.use(protect, staffOnly);

router.post('/checkin',        upload.single('foto'),     checkIn);
router.post('/checkout',       upload.single('foto'),     checkOut);
router.post('/izin',           upload.single('lampiran'), ajukanIzin);
router.get('/hari-ini',                                   getHariIni);
router.get('/riwayat',                                    getRiwayat);
router.post('/lembur',                                    ajukanLembur);
router.get('/lembur/riwayat',                             getRiwayatLembur);

module.exports = router;
