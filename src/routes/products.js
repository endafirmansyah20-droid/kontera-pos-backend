const router = require('express').Router();
const ctrl = require('../controllers/productController');
const { protect, adminOnly } = require('../middleware/auth');

router.use(protect);
router.use(require('../middleware/auth').cabangFilter);
router.get('/', ctrl.getProducts);
router.get('/low-stock', ctrl.getLowStock);
router.get('/by-code/:code', ctrl.getProductByCode);
router.post('/', adminOnly, ctrl.createProduct);
router.put('/:id', adminOnly, ctrl.updateProduct);
router.delete('/:id', adminOnly, ctrl.deleteProduct);
router.post('/:id/add-stock', adminOnly, ctrl.addStock);
router.get('/:id/stock-logs', ctrl.getStockLogs);
router.patch('/:id/earn-points', adminOnly, ctrl.toggleEarnPoints);
router.post('/bulk-set-points', adminOnly, ctrl.bulkSetPointValue);

module.exports = router;
