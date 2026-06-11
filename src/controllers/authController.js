const jwt = require('jsonwebtoken');
const User = require('../models/User');

const signToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE });

exports.register = async (req, res) => {
  try {
    const { name, username, password, role, cabang } = req.body;
    const existing = await User.findOne({ username });
    if (existing) return res.status(400).json({ success: false, message: 'Username sudah digunakan' });

    const user = await User.create({ name, username, password, role, cabang: cabang || null });
    const token = signToken(user._id);
    res.status(201).json({ success: true, token, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: 'Username dan password wajib diisi' });

    const user = await User.findOne({ username }).select('+password').populate('cabang', 'nama kode alamat');
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Username atau password salah' });
    }
    if (!user.isActive) return res.status(401).json({ success: false, message: 'Akun tidak aktif' });

    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    const token = signToken(user._id);
    res.json({ success: true, token, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getMe = async (req, res) => {
  res.json({ success: true, user: req.user });
};

exports.getUsers = async (req, res) => {
  try {
    let query = {};
    // SuperAdmin lihat semua, admin/karyawan hanya lihat user di cabangnya
    if (req.user.role !== 'superadmin' && req.user.cabang) {
      const cabangId = req.user.cabang?._id || req.user.cabang;
      query = { cabang: cabangId };
    }
    const users = await User.find(query).populate('cabang', 'nama kode').sort('-createdAt');
    res.json({ success: true, data: users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const { name, role, isActive, password, cabang } = req.body;
    const user = await User.findById(req.params.id).select('+password');
    if (!user) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });

    if (name)                user.name     = name;
    if (role)                user.role     = role;
    if (isActive !== undefined) user.isActive = isActive;
    if (password)            user.password = password;
    // cabang bisa null (untuk superadmin) atau ObjectId
    if (cabang !== undefined) user.cabang  = cabang || null;

    await user.save({ validateBeforeSave: false });
    const updated = await User.findById(user._id).populate('cabang', 'nama kode');
    res.json({ success: true, user: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'User dihapus' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Admin/Owner reset password karyawan (tanpa perlu tahu password lama)
exports.resetPassword = async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6)
      return res.status(400).json({ success: false, message: 'Password baru minimal 6 karakter' });

    const user = await User.findById(req.params.id).select('+password');
    if (!user) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });

    // Pastikan admin hanya bisa reset user di cabangnya sendiri
    if (req.user.role !== 'superadmin') {
      const adminCabang = req.user.cabang?._id?.toString() || req.user.cabang?.toString();
      const userCabang  = user.cabang?._id?.toString() || user.cabang?.toString();
      if (adminCabang !== userCabang)
        return res.status(403).json({ success: false, message: 'Tidak bisa reset password user cabang lain' });
    }

    user.password = newPassword;
    await user.save();
    res.json({ success: true, message: `Password ${user.name} berhasil direset` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Karyawan ganti password sendiri (harus tahu password lama)
exports.changeMyPassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword)
      return res.status(400).json({ success: false, message: 'Password lama dan baru wajib diisi' });
    if (newPassword.length < 6)
      return res.status(400).json({ success: false, message: 'Password baru minimal 6 karakter' });

    const user = await User.findById(req.user._id).select('+password');
    const isMatch = await user.comparePassword(oldPassword);
    if (!isMatch)
      return res.status(400).json({ success: false, message: 'Password lama salah' });

    user.password = newPassword;
    await user.save();
    res.json({ success: true, message: 'Password berhasil diubah' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
