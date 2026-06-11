const router = require('express').Router();
const {
  getSalesReport, getMonthlyReport, getMonthlyDetail,
  exportExcel, exportPDF, getModalSummary,
  exportModalExcel, exportModalPDF,
  exportServiceExcel, exportServicePDF,
} = require('../controllers/mainController');
const { protect, cabangFilter } = require('../middleware/auth');

router.use(protect);
router.use(cabangFilter);
router.get('/sales',                getSalesReport);
router.get('/monthly',              getMonthlyReport);
router.get('/monthly-detail',       getMonthlyDetail);
router.get('/export/excel',         exportExcel);
router.get('/export/pdf',           exportPDF);
router.get('/modal-summary',        getModalSummary);
router.get('/export/modal/excel',   exportModalExcel);
router.get('/export/modal/pdf',     exportModalPDF);
router.get('/export/service/excel', exportServiceExcel);
router.get('/export/service/pdf',   exportServicePDF);

module.exports = router;
