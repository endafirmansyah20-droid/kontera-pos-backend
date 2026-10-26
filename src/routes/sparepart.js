const router = require('express').Router();
const ctrl   = require('../controllers/sparepartController');
const { protect, adminOnly, cabangFilterWithOwner } = require('../middleware/auth');

router.use(protect);
router.use(cabangFilterWithOwner);

router.get   ('/',              ctrl.getSpareparts);
router.post  ('/',              ctrl.createSparepart);
router.get   ('/:id',           ctrl.getSparepart);
router.put   ('/:id',           ctrl.updateSparepart);
router.delete('/:id',           adminOnly, ctrl.deleteSparepart);
router.post  ('/:id/add-stock', ctrl.addStock);

module.exports = router;
