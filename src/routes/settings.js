const router = require('express').Router();
const { getSettings, updateSettings, getBrankas, updateBrankas, transferBrankas } = require('../controllers/mainController');
const { protect, adminOnly, cabangFilterWithOwner } = require('../middleware/auth');

router.use(protect);
router.use(cabangFilterWithOwner);

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
