const router = require('express').Router();
const ctrl = require('../controllers/transactionController');
const { protect, adminOnly } = require('../middleware/auth');

router.use(protect);
router.use(require('../middleware/auth').cabangFilter);
router.get('/', ctrl.getTransactions);
router.get('/voided/list', adminOnly, ctrl.getVoidedTransactions);
router.get('/anomaly/count', adminOnly, ctrl.getAnomalyCount);
router.get('/today-summary', ctrl.getTodaySummary);
router.get('/:id', ctrl.getTransaction);
router.post('/', ctrl.createTransaction);
router.put('/:id/void', protect, ctrl.voidTransaction); // karyawan bisa void hari ini, admin/owner bebas
router.get('/per-sumber/:akunId', protect, ctrl.getTransaksiPerSumber);
router.put('/:transactionId/item/:itemId', protect, ctrl.editItemTransaksi);
router.get('/hutang/list', ctrl.getHutangPelanggan);
router.post('/:id/bayar-hutang', ctrl.bayarHutang);

module.exports = router;
