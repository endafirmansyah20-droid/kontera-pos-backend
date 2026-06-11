const router = require('express').Router();
const { getDashboard, getChartData, getTargetOmset, setTargetOmset, getKategoriStats } = require('../controllers/mainController');
const { protect, cabangFilter, adminOnly } = require('../middleware/auth');

router.use(protect);
router.use(cabangFilter);
router.get('/', getDashboard);
router.get('/chart-data', getChartData);
router.get('/target-omset', getTargetOmset);
router.post('/target-omset', adminOnly, setTargetOmset);
router.get('/kategori-stats', getKategoriStats);

module.exports = router;
