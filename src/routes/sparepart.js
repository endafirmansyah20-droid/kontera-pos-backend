const router = require('express').Router();
const ctrl   = require('../controllers/sparepartController');
const { protect, adminOnly, cabangFilterWithOwner } = require('../middleware/auth');

router.use(protect);
router.use(cabangFilterWithOwner);

router.get   ('/',              ctrl.getSpareparts);
router.post  ('/',              ctrl.createSparepart);

// Route literal harus di atas /:id
router.get   ('/logs/pembelian',ctrl.getLogPembelian);

router.get   ('/:id/log',       ctrl.getSparePartLog);
router.get   ('/:id',           ctrl.getSparepart);
router.put   ('/:id',           ctrl.updateSparepart);
router.delete('/:id',           adminOnly, ctrl.deleteSparepart);
router.post  ('/:id/add-stock', ctrl.addStock);

module.exports = router;
