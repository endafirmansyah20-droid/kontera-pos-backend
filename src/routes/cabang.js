const router = require('express').Router();
const ctrl   = require('../controllers/cabangController');
const { protect, superAdminOnly } = require('../middleware/auth');

router.use(protect);
router.get ('/',            superAdminOnly, ctrl.getAll);
router.get ('/summary',          superAdminOnly, ctrl.getSummary);
router.get ('/employee-stats',   superAdminOnly, ctrl.getEmployeeStats);
router.get ('/:id',         superAdminOnly, ctrl.getOne);
router.get ('/:id/users',   superAdminOnly, ctrl.getUsers);
router.post('/',            superAdminOnly, ctrl.create);
router.put ('/:id',         superAdminOnly, ctrl.update);
router.delete('/:id',       superAdminOnly, ctrl.deactivate);

module.exports = router;
