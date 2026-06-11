const router = require('express').Router();
const ctrl   = require('../controllers/memberController');

// Public routes - tidak perlu auth
router.post('/login',             ctrl.loginMember);
router.get('/info/:id',           ctrl.getMemberInfo);
router.get('/transactions/:id',   ctrl.getMemberTransactions);

module.exports = router;
