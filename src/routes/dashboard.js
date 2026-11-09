const router = require('express').Router();
const { getDashboard, getChartData, getTargetOmset, setTargetOmset, getKategoriStats } = require('../controllers/mainController');
const { protect, cabangFilterWithOwner, ownerOnly } = require('../middleware/auth');

router.use(protect);
router.use(cabangFilterWithOwner);
router.get('/', getDashboard);
router.get('/chart-data', getChartData);
// GET target omset/transaksi: semua role (karyawan/admin/owner/superadmin) boleh baca
router.get('/target-omset', getTargetOmset);
// POST target omset/transaksi: hanya owner (+ superadmin) yang boleh ubah
router.post('/target-omset', ownerOnly, setTargetOmset);
router.get('/kategori-stats', getKategoriStats);

module.exports = router;
