const router = require('express').Router();
const ctrl   = require('../controllers/pointController');
const { protect, adminOnly, cabangFilter } = require('../middleware/auth');

router.use(protect);
router.use(cabangFilter);
router.get ('/preview',          ctrl.previewPoints);
router.get ('/:id',              ctrl.getCustomerPoints);
router.post('/:id/activate',     adminOnly, ctrl.activateMember);
router.post('/:id/add',          adminOnly, ctrl.addPointsManual);
router.post('/redeem',           ctrl.redeemPoints);

module.exports = router;
