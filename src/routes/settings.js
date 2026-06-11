const router = require('express').Router();
const { getSettings, updateSettings, getBrankas, updateBrankas, transferBrankas } = require('../controllers/mainController');
const { protect, adminOnly, cabangFilter } = require('../middleware/auth');

router.use(protect);

// Middleware cabangFilter dengan support owner multi-cabang
router.use(async (req, res, next) => {
  try {
    if (req.user?.role === 'owner' && req.query.cabang) {
      const Cabang = require('../models/Cabang');
      const cabang = await Cabang.findOne({ _id: req.query.cabang, owner: req.user._id });
      if (!cabang) return res.status(403).json({ success: false, message: 'Cabang tidak ditemukan atau bukan milik kamu' });
      req.cabangFilter = { cabang: cabang._id };
      req.user.cabang  = cabang;
      return next();
    }
    cabangFilter(req, res, next);
  } catch (err) { next(err); }
});

// Admin ATAU owner boleh edit settings & brankas
const adminOrOwner = (req, res, next) => {
  const role = req.user?.role;
  if (['admin','superadmin','owner'].includes(role)) return next();
  return res.status(403).json({ success: false, message: 'Akses ditolak' });
};

router.get('/',                  getSettings);
router.put('/',                  adminOrOwner, updateSettings); // FIXED: owner bisa update settings
router.get('/brankas',           getBrankas);
router.put('/brankas',           adminOrOwner, updateBrankas);
router.post('/brankas/transfer', adminOrOwner, transferBrankas);

module.exports = router;
