const router = require('express').Router();
const { getFinance, createFinance, updateFinance, deleteFinance, getFinanceSummary, getFinanceAllCabang } = require('../controllers/mainController');
const { protect, superAdminOnly, cabangFilterWithOwner } = require('../middleware/auth');

router.use(protect);
router.get('/all-cabang', superAdminOnly, getFinanceAllCabang);

router.use(cabangFilterWithOwner);

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
