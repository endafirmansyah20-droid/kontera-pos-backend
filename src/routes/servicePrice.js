const router = require('express').Router();
const ctrl   = require('../controllers/servicePriceController');
const { protect, adminOnly, cabangFilterWithOwner } = require('../middleware/auth');

router.use(protect);
router.use(cabangFilterWithOwner);

router.get   ('/',    ctrl.getServicePrices);
router.post  ('/',    ctrl.createServicePrice);
router.put   ('/:id', ctrl.updateServicePrice);
router.delete('/:id', adminOnly, ctrl.deleteServicePrice);

module.exports = router;
