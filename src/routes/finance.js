const router = require('express').Router();
const { getFinance, createFinance, updateFinance, deleteFinance, getFinanceSummary, getFinanceAllCabang } = require('../controllers/mainController');
const { protect, superAdminOnly, cabangFilter } = require('../middleware/auth');

router.use(protect);
router.get('/all-cabang', superAdminOnly, getFinanceAllCabang);

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

// Admin ATAU owner boleh edit/delete
const adminOrOwner = (req, res, next) => {
  const role = req.user?.role;
  if (['admin','superadmin','owner','karyawan'].includes(role)) return next();
  return res.status(403).json({ success: false, message: 'Akses ditolak' });
};

router.get('/',        getFinance);
router.get('/summary', getFinanceSummary);
router.post('/',       createFinance);
router.put('/:id',     adminOrOwner, updateFinance);
router.delete('/:id',  adminOrOwner, deleteFinance);

module.exports = router;
