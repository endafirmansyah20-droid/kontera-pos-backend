const express = require('express');
const router  = express.Router();
const {
  register, getDashboard, requestTambahCabang,
  getAllSubscriptions, konfirmasiPembayaran, checkExpired,
  getUsers, tambahUser, toggleUser, editUser, resetUserPassword,
  getEmployeeStats, getCabangSummary
} = require('../controllers/ownerController');
const { protect, superAdminOnly } = require('../middleware/auth');

router.post('/register',                                           register);
router.get('/dashboard',                          protect,         getDashboard);
router.post('/tambah-cabang',                     protect,         requestTambahCabang);
router.get('/users',                              protect,         getUsers);
router.post('/users',                             protect,         tambahUser);
router.patch('/users/:userId/toggle',             protect,         toggleUser);
router.put('/users/:userId',                      protect,         editUser);
router.put('/users/:userId/reset-password',       protect,         resetUserPassword);
router.get('/employee-stats',                     protect,         getEmployeeStats);
router.get('/cabang-summary',                     protect,         getCabangSummary);
// ── SuperAdmin ──────────────────────────────────────────────────────────────
router.get('/subscriptions',                      protect, superAdminOnly, getAllSubscriptions);
router.put('/subscriptions/:subscriptionId/konfirmasi', protect, superAdminOnly, konfirmasiPembayaran);
router.post('/check-expired',                     protect, superAdminOnly, checkExpired);

module.exports = router;
