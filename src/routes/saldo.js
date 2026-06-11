const router = require('express').Router();
const ctrl = require('../controllers/saldoController');
const { protect, adminOnly, cabangFilter } = require('../middleware/auth');

router.use(protect);
router.use(cabangFilter);

// Akun management
router.get('/', ctrl.getAllSaldo);
router.get('/admin/all', adminOnly, ctrl.getAllAkunAdmin);
router.post('/akun', adminOnly, ctrl.tambahAkun);
router.put('/akun/:akunId', adminOnly, ctrl.updateAkun);
router.delete('/akun/:akunId', adminOnly, ctrl.deleteAkun);

// Mutasi
router.get('/:akunId/mutasi', ctrl.getMutasi);
router.post('/topup', ctrl.topUpSaldo);
router.post('/transfer', ctrl.transferSaldo);
router.post('/koreksi', adminOnly, ctrl.koreksiSaldo);

module.exports = router;