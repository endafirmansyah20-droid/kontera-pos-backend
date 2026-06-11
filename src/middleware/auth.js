const jwt  = require('jsonwebtoken');
const User = require('../models/User');

exports.protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) return res.status(401).json({ success: false, message: 'Tidak ada akses, login terlebih dahulu' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).populate('cabang', 'nama kode');
    if (!req.user?.isActive) return res.status(401).json({ success: false, message: 'Akun tidak aktif' });
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Token tidak valid' });
  }
};

exports.adminOnly = (req, res, next) => {
  if (!['admin', 'superadmin'].includes(req.user?.role)) {
    return res.status(403).json({ success: false, message: 'Akses admin diperlukan' });
  }
  next();
};

exports.superAdminOnly = (req, res, next) => {
  if (req.user?.role !== 'superadmin') {
    return res.status(403).json({ success: false, message: 'Akses super admin diperlukan' });
  }
  next();
};

// Middleware: otomatis filter query berdasarkan cabang user
// SuperAdmin: bisa lihat semua atau filter per cabang
// Admin/Karyawan: STRICT — hanya data cabangnya, data null tidak ikut
exports.cabangFilter = (req, res, next) => {
  if (req.user.role === 'superadmin') {
    // SuperAdmin: optional filter by cabang via query param
    req.cabangFilter = req.query.cabang ? { cabang: req.query.cabang } : {};
  } else if (!req.user.cabang) {
    // User tidak punya cabang → blok akses ke data (tampilkan kosong)
    req.cabangFilter = { cabang: { $exists: true, $eq: 'TIDAK_ADA' } }; // match nothing
  } else {
    const cabangId = req.user.cabang._id || req.user.cabang;
    // STRICT: hanya data dengan cabang == ID ini persis (exclude null & cabang lain)
    req.cabangFilter = { cabang: cabangId };
  }
  next();
};
