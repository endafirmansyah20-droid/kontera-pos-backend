// customers.js
const custRouter = require('express').Router();
const { getCustomers, createCustomer, updateCustomer, deleteCustomer, getCustomerTransactions } = require('../controllers/mainController');
const { protect, adminOnly, cabangFilter } = require('../middleware/auth');
custRouter.use(protect);
custRouter.use(cabangFilter);
custRouter.get('/', getCustomers);
custRouter.post('/', createCustomer);
custRouter.put('/:id', updateCustomer);
custRouter.delete('/:id', adminOnly, deleteCustomer);
custRouter.get('/:id/transactions', getCustomerTransactions);
module.exports = custRouter;
