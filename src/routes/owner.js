const express = require('express');
const router  = express.Router();
const {
  register, getDashboard, requestTambahCabang,
  getAllSubscriptions, konfirmasiPembayaran, checkExpired,
  getUsers, tambahUser, toggleUser, editUser, resetUserPassword,
  getEmployeeStats, getEmployeeTransactions, getCabangSummary, getRecentActivity,
  getHourlyChart, getDashboardWidgets, getPenjualanAnalytics, toggleCabang,
  getServiceSummary, getServiceList, getServiceDetail, getServiceAnalytics,
  getClosingRiwayat, getClosingDetail,
  getPembelianRiwayat, getPembelianDetail, getOwnerReportsMonthly,
  getOwnerNotifications
} = require('../controllers/ownerController');
const { protect, superAdminOnly } = require('../middleware/auth');

router.post('/register',                                           register);
router.get('/dashboard',                          protect,         getDashboard);
router.post('/tambah-cabang',                     protect,         requestTambahCabang);
router.patch('/cabang/:cabangId/toggle',          protect,         toggleCabang);
router.get('/users',                              protect,         getUsers);
router.post('/users',                             protect,         tambahUser);
router.patch('/users/:userId/toggle',             protect,         toggleUser);
router.put('/users/:userId',                      protect,         editUser);
router.put('/users/:userId/reset-password',       protect,         resetUserPassword);
router.get('/employee-stats',                     protect,         getEmployeeStats);
router.get('/employee-transactions',              protect,         getEmployeeTransactions);
router.get('/cabang-summary',                     protect,         getCabangSummary);
router.get('/recent-activity',                    protect,         getRecentActivity);
router.get('/hourly-chart',                       protect,         getHourlyChart);
router.get('/dashboard-widgets',                  protect,         getDashboardWidgets);
router.get('/penjualan-analytics',                protect,         getPenjualanAnalytics);
router.get('/service-summary',                    protect,         getServiceSummary);
router.get('/service-list',                       protect,         getServiceList);
router.get('/service-analytics',                  protect,         getServiceAnalytics);
router.get('/service/:id',                        protect,         getServiceDetail);
router.get('/closing-riwayat',                    protect,         getClosingRiwayat);
router.get('/closing/:id',                        protect,         getClosingDetail);
router.get('/pembelian-riwayat',                  protect,         getPembelianRiwayat);
router.get('/pembelian/:id',                      protect,         getPembelianDetail);
router.get('/reports/monthly',                    protect,         getOwnerReportsMonthly);
router.get('/notifications',                      protect,         getOwnerNotifications);
// ── SuperAdmin ──────────────────────────────────────────────────────────────
router.get('/subscriptions',                      protect, superAdminOnly, getAllSubscriptions);
router.put('/subscriptions/:subscriptionId/konfirmasi', protect, superAdminOnly, konfirmasiPembayaran);
router.post('/check-expired',                     protect, superAdminOnly, checkExpired);

module.exports = router;
