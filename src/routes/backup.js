const router = require('express').Router();
const { backupDatabase, getBackupInfo } = require('../controllers/backupController');
const { protect, superAdminOnly } = require('../middleware/auth');

router.use(protect);
router.use(superAdminOnly);
router.get('/info',     getBackupInfo);
router.get('/download', backupDatabase);

module.exports = router;
