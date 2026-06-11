const router = require('express').Router();
const ctrl   = require('../controllers/serviceController');
const { protect, adminOnly, cabangFilter } = require('../middleware/auth');

router.use(protect);
router.use(cabangFilter);

// ── Keuangan Servis (harus di atas /:id) ─────────────────────
router.get ('/finance',       ctrl.getFinance);
router.post('/finance',       ctrl.createFinance);
router.put   ('/finance/:id', adminOnly, ctrl.updateFinance);
router.delete('/finance/:id', adminOnly, ctrl.deleteFinance);

// ── Arsip Servis ─────────────────────────────────────────────
router.get('/arsip',              ctrl.getArsipList);
router.get('/arsip/:bulan/:tahun',ctrl.getArsipDetail);

// ── Transaksi Servis ──────────────────────────────────────────
router.get ('/',        ctrl.getAll);
router.get ('/summary', ctrl.getSummary);
router.get ('/:id',     ctrl.getOne);
router.post('/',        ctrl.create);
router.put ('/:id',     ctrl.update);
router.delete('/:id',   adminOnly, ctrl.voidService);

module.exports = router;
