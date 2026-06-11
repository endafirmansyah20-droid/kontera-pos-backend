// routes/auth.js
const router = require('express').Router();
const ctrl = require('../controllers/authController');
const { protect, adminOnly } = require('../middleware/auth');

router.post('/login', ctrl.login);
router.post('/register', ctrl.register);
router.get('/me', protect, ctrl.getMe);
router.get('/users', protect, adminOnly, ctrl.getUsers);
router.put('/users/:id', protect, adminOnly, ctrl.updateUser);
router.delete('/users/:id', protect, adminOnly, ctrl.deleteUser);
router.put('/users/:id/reset-password', protect, adminOnly, ctrl.resetPassword);
router.put('/change-my-password', protect, ctrl.changeMyPassword);

module.exports = router;
