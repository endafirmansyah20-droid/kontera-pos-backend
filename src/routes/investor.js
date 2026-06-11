const router = require('express').Router();
const { investorLogin, getInvestorStats, getInvestorChart, getInvestorSaldo, getInvestorMonthly } = require('../controllers/mainController');

router.post('/login',   investorLogin);
router.get('/stats',    getInvestorStats);
router.get('/chart',    getInvestorChart);
router.get('/saldo',    getInvestorSaldo);
router.get('/monthly',  getInvestorMonthly);

module.exports = router;
