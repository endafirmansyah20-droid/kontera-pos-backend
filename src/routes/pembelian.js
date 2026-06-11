const router = require('express').Router();
const ctrl = require('../controllers/pembelianController');
const { protect, adminOnly, cabangFilter } = require('../middleware/auth');

router.use(protect);
router.use(cabangFilter);
router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getDetail);
router.post('/', ctrl.create);
router.post('/update-harga', ctrl.updateHargaJual);
router.post('/:id/batalkan', adminOnly, ctrl.batalkan);
router.put('/:id', adminOnly, ctrl.edit);

module.exports = router;