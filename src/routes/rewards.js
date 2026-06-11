const router = require('express').Router();
const ctrl   = require('../controllers/rewardController');
const { protect, adminOnly, cabangFilter } = require('../middleware/auth');

router.use(protect);
router.use(cabangFilter);

const adminOrOwner = (req, res, next) => {
  if (['admin','superadmin','owner'].includes(req.user?.role)) return next();
  return res.status(403).json({ success: false, message: 'Akses ditolak' });
};

router.get('/',          ctrl.getRewards);       // semua role: lihat reward aktif
router.get('/all',       adminOrOwner, ctrl.getAllRewards); // admin/owner: semua reward
router.post('/',         adminOrOwner, ctrl.createReward);
router.put('/:id',       adminOrOwner, ctrl.updateReward);
router.delete('/:id',    adminOrOwner, ctrl.deleteReward);
router.post('/redeem',   ctrl.redeemReward);     // kasir bisa redeem

module.exports = router;
