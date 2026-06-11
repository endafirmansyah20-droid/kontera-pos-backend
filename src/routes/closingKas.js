const router = require('express').Router();
const ctrl = require('../controllers/closingKasController');
const { protect, adminOnly, cabangFilter } = require('../middleware/auth');

router.use(protect);
router.use(cabangFilter);
router.get('/summary', ctrl.getSummaryHariIni);
router.get('/kas-summary', ctrl.getKasSummary);
router.get('/riwayat', ctrl.getRiwayat);
router.get('/:id', ctrl.getDetail);
router.post('/', ctrl.createClosing);
router.post('/reset-cash-minus', adminOnly, ctrl.resetCashMinus);

module.exports = router;