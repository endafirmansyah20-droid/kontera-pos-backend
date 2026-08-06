const mongoose     = require('mongoose');
const User         = require('../models/User');
const Cabang       = require('../models/Cabang');
const Subscription = require('../models/Subscription');
const jwt          = require('jsonwebtoken');

const REKENING = [
  { bank: 'BCA',     no: '1093049059',     nama: 'Enda Firmansyah' },
  { bank: 'Mandiri', no: '1250013988837',  nama: 'Enda Firmansyah' },
  { bank: 'BRI',     no: '372701030137531',nama: 'Enda Firmansyah' },
];

const HARGA_CABANG   = 30000;
const MAX_CABANG     = 15;

// ── Registrasi Owner Baru ─────────────────────────────────────────
exports.register = async (req, res) => {
  try {
    const { name, username, password, namaToko, alamat, telepon, email } = req.body;

    if (!name || !username || !password || !namaToko) {
      return res.status(400).json({ success: false, message: 'Semua field wajib diisi' });
    }
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email wajib diisi' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password minimal 6 karakter' });
    }

    const emailNorm = String(email).toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
      return res.status(400).json({ success: false, message: 'Format email tidak valid' });
    }

    const exists = await User.findOne({ $or: [{ username }, { email: emailNorm }] });
    if (exists) {
      if (exists.username === username) {
        return res.status(400).json({ success: false, message: 'Username sudah dipakai' });
      }
      return res.status(400).json({ success: false, message: 'Email sudah terdaftar' });
    }

    // Buat kode cabang otomatis dari nama toko
    const kode = namaToko.toUpperCase().replace(/\s+/g, '').slice(0, 6) + Date.now().toString().slice(-4);

    // Buat user owner
    const owner = await User.create({
      name, username, password, email: emailNorm,
      role: 'owner',
    });

    // Buat cabang pertama (gratis)
    const cabang = await Cabang.create({
      nama: namaToko,
      kode,
      alamat: alamat || '',
      telepon: telepon || '',
      owner: owner._id,
      isActive: true,
      createdBy: owner._id,
    });

    // Update owner dengan cabang pertama
    owner.cabang = cabang._id;
    await owner.save();

    // Buat subscription gratis untuk cabang pertama
    await Subscription.create({
      owner: owner._id,
      cabang: cabang._id,
      status: 'gratis',
      expiredAt: null,
    });

    const token = jwt.sign({ id: owner._id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE });

    res.status(201).json({
      success: true,
      message: 'Registrasi berhasil! Cabang pertama gratis.',
      token,
      user: owner,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Get Dashboard Owner ───────────────────────────────────────────
exports.getDashboard = async (req, res) => {
  try {
    const owner = req.user;

    // Ambil semua cabang milik owner
    const cabangs = await Cabang.find({ owner: owner._id });
    const cabangIds = cabangs.map(c => c._id);

    // Ambil semua subscription
    const subs = await Subscription.find({ owner: owner._id }).populate('cabang', 'nama kode isActive');

    const totalCabang  = cabangs.length;
    const cabangAktif  = subs.filter(s => ['aktif', 'gratis'].includes(s.status)).length;
    const sisaSlot     = MAX_CABANG - totalCabang;

    res.json({
      success: true,
      data: {
        owner: { name: owner.name, username: owner.username },
        totalCabang,
        cabangAktif,
        sisaSlot,
        maxCabang: MAX_CABANG,
        hargaPerCabang: HARGA_CABANG,
        rekening: REKENING,
        subscriptions: subs,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Request Tambah Cabang ─────────────────────────────────────────
exports.requestTambahCabang = async (req, res) => {
  try {
    const owner = req.user;
    const { namaCabang, alamat, telepon } = req.body;

    const totalCabang = await Cabang.countDocuments({ owner: owner._id });
    if (totalCabang >= MAX_CABANG) {
      return res.status(400).json({ success: false, message: `Maksimal ${MAX_CABANG} cabang` });
    }

    if (!namaCabang) {
      return res.status(400).json({ success: false, message: 'Nama cabang wajib diisi' });
    }

    // Buat request langganan (status pending, cabang nonaktif dulu)
    const kode = namaCabang.toUpperCase().replace(/\s+/g, '').slice(0, 6) + Date.now().toString().slice(-4);

    const cabang = await Cabang.create({
      nama: namaCabang,
      kode,
      alamat: alamat || '',
      telepon: telepon || '',
      owner: owner._id,
      isActive: false, // nonaktif sampai bayar
      createdBy: owner._id,
    });

    const sub = await Subscription.create({
      owner: owner._id,
      cabang: cabang._id,
      status: 'nonaktif', // tunggu konfirmasi bayar
      harga: HARGA_CABANG,
    });

    res.json({
      success: true,
      message: 'Cabang berhasil dibuat. Silakan transfer untuk mengaktifkan.',
      data: {
        cabang,
        subscription: sub,
        tagihan: HARGA_CABANG,
        rekening: REKENING,
        instruksi: `Transfer Rp ${HARGA_CABANG.toLocaleString('id-ID')} ke salah satu rekening di atas. Konfirmasi via WhatsApp dengan bukti transfer.`,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Get Semua Subscription (untuk superadmin konfirmasi) ──────────
exports.getAllSubscriptions = async (req, res) => {
  try {
    const subs = await Subscription.find()
      .populate('owner', 'name username')
      .populate('cabang', 'nama kode isActive')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: subs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Konfirmasi Pembayaran (superadmin) ────────────────────────────
exports.konfirmasiPembayaran = async (req, res) => {
  try {
    const { subscriptionId } = req.params;
    const { bulan = 1 } = req.body; // berapa bulan yang dibayar

    const sub = await Subscription.findById(subscriptionId).populate('cabang');
    if (!sub) return res.status(404).json({ success: false, message: 'Subscription tidak ditemukan' });

    // Hitung expired date
    const now = new Date();
    const expired = sub.expiredAt && sub.expiredAt > now ? new Date(sub.expiredAt) : now;
    expired.setMonth(expired.getMonth() + parseInt(bulan));

    sub.status    = 'aktif';
    sub.expiredAt = expired;
    await sub.save();

    // Aktifkan cabang
    await Cabang.findByIdAndUpdate(sub.cabang._id, { isActive: true });

    res.json({
      success: true,
      message: `Cabang ${sub.cabang.nama} berhasil diaktifkan sampai ${expired.toLocaleDateString('id-ID')}`,
      data: sub,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Nonaktifkan Cabang Expired (cron / manual) ────────────────────
exports.checkExpired = async (req, res) => {
  try {
    const now = new Date();
    const expired = await Subscription.find({
      status: 'aktif',
      expiredAt: { $lt: now },
    });

    for (const sub of expired) {
      sub.status = 'nonaktif';
      await sub.save();
      await Cabang.findByIdAndUpdate(sub.cabang, { isActive: false });
    }

    res.json({ success: true, message: `${expired.length} cabang dinonaktifkan karena expired` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Manajemen User ────────────────────────────────────────────────
exports.getUsers = async (req, res) => {
  try {
    const owner = req.user;
    const cabangs = await Cabang.find({ owner: owner._id }).select('_id');
    const cabangIds = cabangs.map(c => c._id);

    // Filter opsional per cabang (pattern sama dgn getEmployeeStats)
    let cabangFilter;
    if (req.query.cabang) {
      if (!mongoose.isValidObjectId(req.query.cabang)) {
        return res.status(400).json({ success: false, message: 'Cabang tidak valid' });
      }
      const owned = cabangIds.some(id => id.equals(req.query.cabang));
      if (!owned) return res.status(403).json({ success: false, message: 'Cabang bukan milik Anda' });
      cabangFilter = new mongoose.Types.ObjectId(req.query.cabang);
    } else {
      cabangFilter = { $in: cabangIds };
    }

    const users = await User.find({ cabang: cabangFilter, role: { $in: ['admin','karyawan'] } }).populate('cabang','nama kode').sort('-createdAt');
    res.json({ success: true, data: users });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── Get Single User by ID (Owner) ────────────────────────────────
// Untuk halaman detail karyawan — deep link / refresh page ke
// /owner/karyawan/:userId. Authz: user.cabang harus salah satu cabang owner.
exports.getUserDetail = async (req, res) => {
  try {
    const owner = req.user;
    const { userId } = req.params;
    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ success: false, message: 'User tidak valid' });
    }

    const user = await User.findById(userId).populate('cabang', 'nama kode');
    if (!user) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });

    // Hanya admin/karyawan yang boleh dilihat via endpoint ini (bukan owner sendiri)
    if (!['admin', 'karyawan'].includes(user.role)) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    // Cabang harus milik owner
    const currentCabangId = user.cabang?._id || user.cabang;
    if (!currentCabangId) {
      return res.status(403).json({ success: false, message: 'User tidak punya cabang' });
    }
    const owned = await Cabang.exists({ _id: currentCabangId, owner: owner._id });
    if (!owned) return res.status(403).json({ success: false, message: 'Bukan karyawan cabang Anda' });

    res.json({ success: true, data: user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.tambahUser = async (req, res) => {
  try {
    const owner = req.user;
    const { name, username, password, role, cabangId } = req.body;
    if (!name || !username || !password || !cabangId)
      return res.status(400).json({ success: false, message: 'Semua field wajib diisi' });
    const cabang = await Cabang.findOne({ _id: cabangId, owner: owner._id });
    if (!cabang) return res.status(403).json({ success: false, message: 'Cabang bukan milik kamu' });
    const sub = await Subscription.findOne({ cabang: cabangId, status: { $in: ['aktif','gratis'] } });
    if (!sub) return res.status(403).json({ success: false, message: 'Cabang belum aktif' });
    const exists = await User.findOne({ username });
    if (exists) return res.status(400).json({ success: false, message: 'Username sudah digunakan' });
    const user = await User.create({ name, username, password, role: role || 'karyawan', cabang: cabangId });
    const populated = await User.findById(user._id).populate('cabang','nama kode');
    res.status(201).json({ success: true, message: 'User berhasil ditambahkan', data: populated });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.toggleUser = async (req, res) => {
  try {
    const owner = req.user;
    const user = await User.findById(req.params.userId).populate('cabang');
    if (!user) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
    const cabang = await Cabang.findOne({ _id: user.cabang._id, owner: owner._id });
    if (!cabang) return res.status(403).json({ success: false, message: 'Akses ditolak' });
    user.isActive = !user.isActive;
    await user.save();
    res.json({ success: true, message: 'User ' + (user.isActive ? 'diaktifkan' : 'dinonaktifkan'), data: user });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};


// ── Edit User (nama, role, cabang) ───────────────────────────────
exports.editUser = async (req, res) => {
  try {
    const owner = req.user;
    const { name, role, cabangId } = req.body;

    const user = await User.findById(req.params.userId).populate('cabang');
    if (!user) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });

    // Scope check: user harus di cabang milik owner
    const currentCabangId = user.cabang?._id || user.cabang;
    const currentCabang = currentCabangId
      ? await Cabang.findOne({ _id: currentCabangId, owner: owner._id })
      : null;
    if (!currentCabang) return res.status(403).json({ success: false, message: 'Akses ditolak' });

    if (role !== undefined && !['admin', 'karyawan'].includes(role)) {
      return res.status(403).json({ success: false, message: 'Role hanya boleh admin atau karyawan' });
    }

    if (cabangId !== undefined && String(cabangId) !== String(currentCabangId)) {
      const targetCabang = await Cabang.findOne({ _id: cabangId, owner: owner._id });
      if (!targetCabang) return res.status(403).json({ success: false, message: 'Cabang tujuan bukan milik kamu' });
      user.cabang = targetCabang._id;
    }

    if (name !== undefined) user.name = name;
    if (role !== undefined) user.role = role;

    await user.save();
    const updated = await User.findById(user._id).populate('cabang', 'nama kode');
    res.json({ success: true, message: 'User berhasil diupdate', data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Reset Password User ──────────────────────────────────────────
exports.resetUserPassword = async (req, res) => {
  try {
    const owner = req.user;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password baru minimal 6 karakter' });
    }

    const user = await User.findById(req.params.userId).select('+password').populate('cabang');
    if (!user) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });

    const currentCabangId = user.cabang?._id || user.cabang;
    const currentCabang = currentCabangId
      ? await Cabang.findOne({ _id: currentCabangId, owner: owner._id })
      : null;
    if (!currentCabang) return res.status(403).json({ success: false, message: 'Akses ditolak' });

    user.password = newPassword;
    await user.save();
    res.json({ success: true, message: `Password ${user.name} berhasil direset` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// ── Get Performa Karyawan milik Owner ────────────────────────────
exports.getEmployeeStats = async (req, res) => {
  try {
    const Transaction = require('../models/Transaction');
    const owner = req.user;

    const cabangs = await Cabang.find({ owner: owner._id });
    const cabangIds = cabangs.map(c => c._id);

    // Filter opsional per cabang
    let cabangFilter;
    if (req.query.cabang) {
      if (!mongoose.isValidObjectId(req.query.cabang)) {
        return res.status(400).json({ success: false, message: 'Cabang tidak valid' });
      }
      const owned = cabangIds.some(id => id.equals(req.query.cabang));
      if (!owned) {
        return res.status(403).json({ success: false, message: 'Cabang bukan milik Anda' });
      }
      cabangFilter = { cabang: new mongoose.Types.ObjectId(req.query.cabang) };
    } else {
      cabangFilter = { cabang: { $in: cabangIds } };
    }

    // Filter opsional per cashier (untuk halaman detail karyawan owner)
    let cashierMatch = { cashier: { $ne: null } };
    if (req.query.cashier) {
      if (!mongoose.isValidObjectId(req.query.cashier)) {
        return res.status(400).json({ success: false, message: 'Cashier tidak valid' });
      }
      cashierMatch = { cashier: new mongoose.Types.ObjectId(req.query.cashier) };
    }

    // Periode: today | 7 | 30 | month (default 'month' backward-compatible)
    const range = String(req.query.range || 'month').toLowerCase();
    const now = new Date();
    const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    let startDate;
    if (range === 'today') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    } else if (range === '7' || range === '30') {
      const days = range === '7' ? 7 : 30;
      startDate = new Date(now); startDate.setDate(now.getDate() - (days - 1)); startDate.setHours(0, 0, 0, 0);
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const stats = await Transaction.aggregate([
      { $match: {
          ...cabangFilter,
          ...cashierMatch,
          type: 'penjualan',
          isVoid: { $ne: true },
          transactionDate: { $gte: startDate, $lte: endDate },
      }},
      { $group: {
          _id: '$cashier',
          cashierNameSnapshot: { $first: '$cashierName' },
          totalTx:     { $sum: 1 },
          totalOmset:  { $sum: '$total' },
          totalLaba:   { $sum: '$totalProfit' },
          totalItems:  { $sum: { $size: { $ifNull: ['$items', []] } } },
      }},
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $addFields: {
          cashierId:   '$_id',
          cashierName: { $ifNull: [ { $arrayElemAt: ['$user.name', 0] }, '$cashierNameSnapshot' ] },
          avgTx:       { $cond: [ { $gt: ['$totalTx', 0] }, { $divide: ['$totalOmset', '$totalTx'] }, 0 ] }
      }},
      { $project: { _id: 0, user: 0, cashierNameSnapshot: 0 } },
      { $sort: { totalOmset: -1 } }
    ]);

    res.json({ success: true, data: stats });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};


// ── Riwayat Transaksi per Karyawan (Owner) ───────────────────────
exports.getEmployeeTransactions = async (req, res) => {
  try {
    const Transaction = require('../models/Transaction');
    const owner = req.user;

    const { cashier, cabang, startDate, endDate } = req.query;
    const page  = Math.max(parseInt(req.query.page)  || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);

    if (!cashier || !mongoose.isValidObjectId(cashier)) {
      return res.status(400).json({ success: false, message: 'Parameter cashier tidak valid' });
    }

    const cabangs = await Cabang.find({ owner: owner._id }).select('_id');
    const cabangIds = cabangs.map(c => c._id);

    // Filter cabang (opsional)
    let cabangMatch;
    if (cabang) {
      if (!mongoose.isValidObjectId(cabang)) {
        return res.status(400).json({ success: false, message: 'Cabang tidak valid' });
      }
      const owned = cabangIds.some(id => id.equals(cabang));
      if (!owned) {
        return res.status(403).json({ success: false, message: 'Cabang bukan milik Anda' });
      }
      cabangMatch = new mongoose.Types.ObjectId(cabang);
    } else {
      cabangMatch = { $in: cabangIds };
    }

    // Authz: cashier harus pernah bertransaksi di salah satu cabang owner
    const cashierId = new mongoose.Types.ObjectId(cashier);
    const hasWorked = await Transaction.exists({ cashier: cashierId, cabang: { $in: cabangIds } });
    if (!hasWorked) {
      return res.status(403).json({ success: false, message: 'Karyawan tidak ditemukan di cabang Anda' });
    }

    const query = { cashier: cashierId, cabang: cabangMatch };

    if (startDate || endDate) {
      query.transactionDate = {};
      if (startDate) query.transactionDate.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.transactionDate.$lte = end;
      }
    }

    const skip = (page - 1) * limit;
    const [transactions, total] = await Promise.all([
      Transaction.find(query)
        .sort('-transactionDate')
        .skip(skip)
        .limit(limit)
        .select('transactionDate total totalProfit invoiceNumber cabang isVoid')
        .populate('cabang', 'nama')
        .lean(),
      Transaction.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: transactions,
      total,
      page,
      pages: Math.ceil(total / limit)
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};


// ── Get Summary Cabang untuk Owner Dashboard ─────────────────────
exports.getCabangSummary = async (req, res) => {
  try {
    const Transaction = require('../models/Transaction');
    const Saldo = require('../models/Saldo');
    const Product = require('../models/Product');
    const owner = req.user;

    // Filter opsional ?cabang=<id> — dipakai halaman detail cabang untuk
    // compute 1 cabang saja. isActive filter di-drop saat by-ID karena owner
    // explicit request; kalau tidak, cabang nonaktif jadi invisible di detail.
    let cabangs;
    if (req.query.cabang) {
      if (!mongoose.isValidObjectId(req.query.cabang)) {
        return res.status(400).json({ success: false, message: 'Cabang tidak valid' });
      }
      const one = await Cabang.findOne({ _id: req.query.cabang, owner: owner._id });
      if (!one) return res.status(403).json({ success: false, message: 'Cabang bukan milik Anda' });
      cabangs = [one];
    } else {
      cabangs = await Cabang.find({ owner: owner._id, isActive: true });
    }
    const cabangIds = cabangs.map(c => c._id);

    const now = new Date();
    const todayStart  = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const todayEnd    = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const weekStart   = new Date(now); weekStart.setDate(now.getDate() - 6); weekStart.setHours(0,0,0,0);
    const monthStart  = new Date(now.getFullYear(), now.getMonth(), 1);

    // Template 7 tanggal (YYYY-MM-DD) di WIB, urut dari 6 hari lalu → hari ini,
    // supaya cocok dengan output $dateToString timezone Asia/Jakarta
    const sparklineDates = [];
    for (let i = 6; i >= 0; i--) {
      const wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
      wib.setUTCDate(wib.getUTCDate() - i);
      const y = wib.getUTCFullYear();
      const m = String(wib.getUTCMonth() + 1).padStart(2, '0');
      const d = String(wib.getUTCDate()).padStart(2, '0');
      sparklineDates.push(`${y}-${m}-${d}`);
    }

    const [perCabang, sparklineRaw, subs] = await Promise.all([
      Promise.all(cabangs.map(async c => {
        const cabangQ = { cabang: c._id };

        const [harian, mingguan, bulanan, saldos, nilaiStokRes, jumlahKaryawan] = await Promise.all([
          Transaction.aggregate([
            { $match: { ...cabangQ, type: 'penjualan', isVoid: { $ne: true }, transactionDate: { $gte: todayStart, $lte: todayEnd } } },
            { $group: { _id: null, omset: { $sum: '$total' }, laba: { $sum: '$totalProfit' }, count: { $sum: 1 } } }
          ]),
          Transaction.aggregate([
            { $match: { ...cabangQ, type: 'penjualan', isVoid: { $ne: true }, transactionDate: { $gte: weekStart, $lte: todayEnd } } },
            { $group: { _id: null, omset: { $sum: '$total' }, laba: { $sum: '$totalProfit' }, count: { $sum: 1 } } }
          ]),
          Transaction.aggregate([
            { $match: { ...cabangQ, type: 'penjualan', isVoid: { $ne: true }, transactionDate: { $gte: monthStart } } },
            { $group: { _id: null, omset: { $sum: '$total' }, laba: { $sum: '$totalProfit' }, count: { $sum: 1 } } }
          ]),
          Saldo.find({ ...cabangQ, isActive: true }).select('akunId saldo'),
          Product.aggregate([
            { $match: { cabang: c._id, type: 'fisik', isActive: true } },
            { $unwind: '$stockBatches' },
            { $match: { 'stockBatches.remainingQty': { $gt: 0 } } },
            { $group: { _id: null, nilaiStok: { $sum: { $multiply: ['$stockBatches.remainingQty', '$stockBatches.purchasePrice'] } } } }
          ]),
          User.countDocuments({ cabang: c._id, role: { $in: ['admin', 'karyawan'] }, isActive: true }),
        ]);

        const kasTunai    = saldos.find(s => s.akunId.startsWith('tunai'))?.saldo || 0;
        const brankas     = saldos.find(s => s.akunId === 'brankas')?.saldo || 0;
        const saldoDigital= saldos.filter(s => !s.akunId.startsWith('tunai') && s.akunId !== 'brankas').reduce((t,s) => t + s.saldo, 0);
        const nilaiStok   = nilaiStokRes[0]?.nilaiStok || 0;

        return {
          _id: c._id, nama: c.nama, kode: c.kode, isActive: c.isActive,
          alamat: c.alamat, telepon: c.telepon, createdAt: c.createdAt,
          harian:   { omset: harian[0]?.omset||0,   laba: harian[0]?.laba||0,   count: harian[0]?.count||0   },
          mingguan: { omset: mingguan[0]?.omset||0,  laba: mingguan[0]?.laba||0,  count: mingguan[0]?.count||0  },
          bulanan:  { omset: bulanan[0]?.omset||0,   laba: bulanan[0]?.laba||0,   count: bulanan[0]?.count||0   },
          kasTunai, brankas, saldoDigital, nilaiStok, jumlahKaryawan,
        };
      })),
      Transaction.aggregate([
        { $match: {
            cabang: { $in: cabangIds },
            type: 'penjualan',
            isVoid: { $ne: true },
            transactionDate: { $gte: weekStart }
        }},
        { $group: {
            _id: {
              cabang: '$cabang',
              tanggal: { $dateToString: { format: '%Y-%m-%d', date: '$transactionDate', timezone: 'Asia/Jakarta' } }
            },
            omset:    { $sum: '$total' },
            laba:     { $sum: '$totalProfit' },
            jumlahTx: { $sum: 1 }
        }},
        { $sort: { '_id.tanggal': 1 } }
      ]),
      Subscription.find({ owner: owner._id }).select('cabang status expiredAt harga').lean(),
    ]);

    // Lookup { cabangId → { tanggal → row } }
    const sparklineByCabang = new Map();
    for (const row of sparklineRaw) {
      const cid = String(row._id.cabang);
      if (!sparklineByCabang.has(cid)) sparklineByCabang.set(cid, {});
      sparklineByCabang.get(cid)[row._id.tanggal] = row;
    }

    const subsByCabang = new Map(subs.map(s => [String(s.cabang), s]));

    const yesterdayKey = sparklineDates[sparklineDates.length - 2];

    const result = perCabang.map(c => {
      const byDate = sparklineByCabang.get(String(c._id));
      const sparkline = sparklineDates.map(tanggal => {
        const row = byDate?.[tanggal];
        return {
          tanggal,
          omset:    row?.omset    || 0,
          laba:     row?.laba     || 0,
          jumlahTx: row?.jumlahTx || 0,
        };
      });
      const kRow = byDate?.[yesterdayKey];
      const kemarin = {
        omset: kRow?.omset    || 0,
        laba:  kRow?.laba     || 0,
        count: kRow?.jumlahTx || 0,
      };

      const sub = subsByCabang.get(String(c._id));
      const hariTersisa = (!sub || sub.status === 'gratis' || !sub.expiredAt)
        ? null
        : Math.ceil((new Date(sub.expiredAt) - now) / 86400000);
      const subscription = sub ? {
        status: sub.status,
        expiredAt: sub.expiredAt,
        harga: sub.harga,
        hariTersisa,
      } : null;

      return { ...c, kemarin, subscription, sparkline };
    });

    res.json({ success: true, data: result });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};


// ── Aktivitas Terbaru: N transaksi lintas semua cabang Owner ─────
exports.getRecentActivity = async (req, res) => {
  try {
    const Transaction = require('../models/Transaction');
    const owner = req.user;

    const parsed = parseInt(req.query.limit);
    const limit = Number.isFinite(parsed)
      ? Math.min(Math.max(parsed, 1), 50)
      : 10;

    const cabangs = await Cabang.find({ owner: owner._id }).select('_id');
    const cabangIds = cabangs.map(c => c._id);

    const transactions = await Transaction.find({ cabang: { $in: cabangIds } })
      .sort('-transactionDate')
      .limit(limit)
      .select('transactionDate total totalProfit type isVoid cashierName invoiceNumber cabang')
      .populate('cabang', 'nama kode')
      .lean();

    res.json({ success: true, data: transactions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// Helper: bangun trend chart per-jam (today) atau per-tanggal (7/30 hari)
// Dipakai getHourlyChart & getPenjualanAnalytics. Timezone Asia/Jakarta.
async function buildTrendData({ cabangs, cabangIds, range }) {
  const Transaction = require('../models/Transaction');
  const now = new Date();

  if (range === '7' || range === '30') {
    const days = range === '7' ? 7 : 30;
    const start = new Date(now); start.setDate(now.getDate() - (days - 1)); start.setHours(0,0,0,0);
    const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23,59,59,999);

    // Template N tanggal (YYYY-MM-DD) WIB, urut lama → baru, cocok dgn $dateToString Asia/Jakarta
    const labels = [];
    for (let i = days - 1; i >= 0; i--) {
      const wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
      wib.setUTCDate(wib.getUTCDate() - i);
      const y = wib.getUTCFullYear();
      const m = String(wib.getUTCMonth() + 1).padStart(2, '0');
      const d = String(wib.getUTCDate()).padStart(2, '0');
      labels.push(`${y}-${m}-${d}`);
    }

    const rows = await Transaction.aggregate([
      { $match: { cabang: { $in: cabangIds }, type: 'penjualan', isVoid: { $ne: true },
                  transactionDate: { $gte: start, $lte: end } } },
      { $group: {
          _id: { cabang: '$cabang',
                 tanggal: { $dateToString: { format: '%Y-%m-%d', date: '$transactionDate', timezone: 'Asia/Jakarta' } } },
          omset: { $sum: '$total' },
          laba:  { $sum: '$totalProfit' }
      } }
    ]);

    const byCabang = new Map();
    for (const r of rows) {
      const cid = String(r._id.cabang);
      if (!byCabang.has(cid)) byCabang.set(cid, {});
      byCabang.get(cid)[r._id.tanggal] = r;
    }

    const series = cabangs.map(c => {
      const byDate = byCabang.get(String(c._id));
      return {
        nama: c.nama, kode: c.kode,
        omset: labels.map(t => byDate?.[t]?.omset || 0),
        laba:  labels.map(t => byDate?.[t]?.laba  || 0),
      };
    });

    return { labels, series };
  }

  // Default: per jam hari ini (00:00–23:00 WIB)
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const rows = await Transaction.aggregate([
    { $match: { cabang: { $in: cabangIds }, type: 'penjualan', isVoid: { $ne: true },
                transactionDate: { $gte: todayStart, $lte: todayEnd } } },
    { $group: {
        _id: { cabang: '$cabang',
               jam: { $hour: { date: '$transactionDate', timezone: 'Asia/Jakarta' } } },
        omset: { $sum: '$total' },
        laba:  { $sum: '$totalProfit' }
    } },
    { $sort: { '_id.jam': 1 } }
  ]);

  const labels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);

  const byCabang = new Map();
  for (const r of rows) {
    const cid = String(r._id.cabang);
    if (!byCabang.has(cid)) byCabang.set(cid, {});
    byCabang.get(cid)[r._id.jam] = r;
  }

  const series = cabangs.map(c => {
    const byHour = byCabang.get(String(c._id));
    const omset = new Array(24).fill(0);
    const laba  = new Array(24).fill(0);
    for (let h = 0; h < 24; h++) {
      const row = byHour?.[h];
      if (row) { omset[h] = row.omset; laba[h] = row.laba; }
    }
    return { nama: c.nama, kode: c.kode, omset, laba };
  });

  return { labels, series };
}


// ── Hourly / Daily Chart: omset+laba per jam (today) atau per tanggal (7/30 hari) ─
exports.getHourlyChart = async (req, res) => {
  try {
    const owner = req.user;
    const range = String(req.query.range || 'today').toLowerCase();
    const cabangs = await Cabang.find({ owner: owner._id });
    const cabangIds = cabangs.map(c => c._id);
    const { labels, series } = await buildTrendData({ cabangs, cabangIds, range });
    res.json({ success: true, labels, series });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// ── Analytics Halaman Penjualan Owner ─────────────────────────────
// Bundle: breakdown produk/kategori, trend harian, compare periode,
// peak hours, metode pembayaran per cabang, ringkasan void.
// - breakdown/trendHarian/metodePembayaran/voidSummary ikut ?range
// - comparePeriode & peakHours window FIXED (independent dari ?range)
exports.getPenjualanAnalytics = async (req, res) => {
  try {
    const Transaction = require('../models/Transaction');
    const owner = req.user;

    // Range
    const range = String(req.query.range || '7').toLowerCase();
    if (!['today', '7', '30'].includes(range)) {
      return res.status(400).json({ success: false, message: 'Range tidak valid (today|7|30)' });
    }

    // Cabang authz
    const allCabangs = await Cabang.find({ owner: owner._id });
    let scopedCabangs, scopedCabangIds, cabangParamId = null;
    if (req.query.cabang) {
      if (!mongoose.isValidObjectId(req.query.cabang)) {
        return res.status(400).json({ success: false, message: 'Cabang tidak valid' });
      }
      const found = allCabangs.find(c => c._id.equals(req.query.cabang));
      if (!found) {
        return res.status(403).json({ success: false, message: 'Cabang bukan milik Anda' });
      }
      scopedCabangs = [found];
      scopedCabangIds = [found._id];
      cabangParamId = String(found._id);
    } else {
      scopedCabangs = allCabangs;
      scopedCabangIds = allCabangs.map(c => c._id);
    }

    const now = new Date();
    const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    // Window ikut ?range
    let startDate;
    if (range === 'today') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    } else {
      const days = range === '7' ? 7 : 30;
      startDate = new Date(now); startDate.setDate(now.getDate() - (days - 1)); startDate.setHours(0, 0, 0, 0);
    }
    const endDate = dayEnd;

    // Window FIXED: minggu ini (7 hari terakhir, konsisten dgn sparkline getCabangSummary)
    const thisWeekStart = new Date(now); thisWeekStart.setDate(now.getDate() - 6); thisWeekStart.setHours(0, 0, 0, 0);
    const thisWeekEnd   = dayEnd;
    const lastWeekEnd   = new Date(thisWeekStart.getTime() - 1);
    const lastWeekStart = new Date(thisWeekStart); lastWeekStart.setDate(thisWeekStart.getDate() - 7);

    // Window FIXED: peak hours 30 hari
    const peakWindowDays = 30;
    const peakStart = new Date(now); peakStart.setDate(now.getDate() - (peakWindowDays - 1)); peakStart.setHours(0, 0, 0, 0);
    const peakEnd   = dayEnd;

    // Match dasar
    const rangeMatch = {
      cabang: { $in: scopedCabangIds },
      type: 'penjualan',
      isVoid: { $ne: true },
      transactionDate: { $gte: startDate, $lte: endDate }
    };
    const voidMatch = {
      cabang: { $in: scopedCabangIds },
      isVoid: true,
      transactionDate: { $gte: startDate, $lte: endDate }
    };

    // Pipeline builders
    const topProdukPipeline = (itemType) => ([
      { $match: rangeMatch },
      { $unwind: '$items' },
      { $match: { 'items.type': itemType } },
      { $group: {
          _id: '$items.productName',
          productCode: { $first: '$items.productCode' },
          terjual: { $sum: { $ifNull: ['$items.quantity', 1] } },
          omset:   { $sum: '$items.subtotal' },
      } },
      { $sort: { terjual: -1 } },
      { $limit: 5 },
    ]);
    const topKategoriPipeline = [
      { $match: rangeMatch },
      { $unwind: '$items' },
      { $match: { 'items.category': { $nin: [null, ''] } } },
      { $group: {
          _id: '$items.category',
          terjual: { $sum: { $ifNull: ['$items.quantity', 1] } },
          omset:   { $sum: '$items.subtotal' },
      } },
      { $sort: { omset: -1 } },
      { $limit: 5 },
    ];
    const weekAgg = (start, end) => Transaction.aggregate([
      { $match: {
          cabang: { $in: scopedCabangIds },
          type: 'penjualan',
          isVoid: { $ne: true },
          transactionDate: { $gte: start, $lte: end }
      }},
      { $group: { _id: null, omset: { $sum: '$total' }, laba: { $sum: '$totalProfit' }, count: { $sum: 1 } } }
    ]);
    const peakHoursPipeline = [
      { $match: {
          cabang: { $in: scopedCabangIds },
          type: 'penjualan',
          isVoid: { $ne: true },
          transactionDate: { $gte: peakStart, $lte: peakEnd }
      }},
      { $group: {
          _id: { $hour: { date: '$transactionDate', timezone: 'Asia/Jakarta' } },
          omset: { $sum: '$total' },
          count: { $sum: 1 }
      }},
      { $sort: { _id: 1 } }
    ];
    const metodeGlobalPipeline = [
      { $match: rangeMatch },
      { $group: { _id: '$paymentMethod', total: { $sum: '$total' }, count: { $sum: 1 } } }
    ];
    const metodePerCabangPipeline = [
      { $match: rangeMatch },
      { $group: {
          _id: { cabang: '$cabang', method: '$paymentMethod' },
          total: { $sum: '$total' },
          count: { $sum: 1 }
      }}
    ];
    const voidTotalPipeline = [
      { $match: voidMatch },
      { $group: { _id: null, count: { $sum: 1 }, totalNilai: { $sum: '$total' } } }
    ];
    const voidPerCabangPipeline = [
      { $match: voidMatch },
      { $group: { _id: '$cabang', count: { $sum: 1 }, totalNilai: { $sum: '$total' } } }
    ];
    const voidTopReasonsPipeline = [
      { $match: voidMatch },
      { $addFields: {
          reasonNormalized: { $trim: { input: { $toLower: { $ifNull: ['$voidReason', 'tanpa alasan'] } } } }
      }},
      { $group: {
          _id: '$reasonNormalized',
          reason: { $first: { $trim: { input: { $ifNull: ['$voidReason', 'Tanpa alasan'] } } } },
          count: { $sum: 1 },
          totalNilai: { $sum: '$total' }
      }},
      { $sort: { count: -1 } },
      { $limit: 5 }
    ];

    // Jalankan paralel
    const [
      trendHarian,
      fisikRaw, digitalRaw, kategoriRaw,
      thisWeek, lastWeek,
      peakHoursRaw,
      metodeGlobalRaw, metodePerCabangRaw,
      voidTotal, voidPerCabangRaw, voidTopReasonsRaw
    ] = await Promise.all([
      buildTrendData({ cabangs: scopedCabangs, cabangIds: scopedCabangIds, range }),
      Transaction.aggregate(topProdukPipeline('fisik')),
      Transaction.aggregate(topProdukPipeline('digital')),
      Transaction.aggregate(topKategoriPipeline),
      weekAgg(thisWeekStart, thisWeekEnd),
      weekAgg(lastWeekStart, lastWeekEnd),
      Transaction.aggregate(peakHoursPipeline),
      Transaction.aggregate(metodeGlobalPipeline),
      Transaction.aggregate(metodePerCabangPipeline),
      Transaction.aggregate(voidTotalPipeline),
      Transaction.aggregate(voidPerCabangPipeline),
      Transaction.aggregate(voidTopReasonsPipeline),
    ]);

    // Format breakdown
    const mapProduk = raw => raw.map(p => ({
      nama: p._id, productCode: p.productCode || null,
      terjual: p.terjual || 0, omset: p.omset || 0
    }));
    const mapKategori = raw => raw.map(k => ({
      kategori: k._id, terjual: k.terjual || 0, omset: k.omset || 0
    }));

    // Compare
    const shapeWeek = r => ({ omset: r[0]?.omset || 0, laba: r[0]?.laba || 0, count: r[0]?.count || 0 });

    // Peak hours: 24 slot penuh
    const peakByHour = new Map(peakHoursRaw.map(r => [r._id, r]));
    const peakHours = Array.from({ length: 24 }, (_, jam) => ({
      jam,
      omset: peakByHour.get(jam)?.omset || 0,
      count: peakByHour.get(jam)?.count || 0
    }));

    // Metode pembayaran
    const METODE_ENUM = ['cash', 'qris', 'transfer', 'hutang'];
    const globalMap = new Map(metodeGlobalRaw.map(m => [m._id, m]));
    const metodeGlobal = METODE_ENUM.map(method => {
      const row = globalMap.get(method);
      return { method, total: row?.total || 0, count: row?.count || 0 };
    });

    const perCabangMap = new Map();
    for (const r of metodePerCabangRaw) {
      const cid = String(r._id.cabang);
      if (!perCabangMap.has(cid)) perCabangMap.set(cid, new Map());
      perCabangMap.get(cid).set(r._id.method, r);
    }
    const metodePerCabang = scopedCabangs.map(c => {
      const byMethod = perCabangMap.get(String(c._id));
      return {
        cabangId: c._id,
        cabangNama: c.nama,
        methods: METODE_ENUM.map(method => {
          const row = byMethod?.get(method);
          return { method, total: row?.total || 0, count: row?.count || 0 };
        })
      };
    });

    // Void summary
    const voidPerCabangByCabang = new Map(voidPerCabangRaw.map(v => [String(v._id), v]));
    const voidPerCabang = scopedCabangs.map(c => {
      const row = voidPerCabangByCabang.get(String(c._id));
      return {
        cabangId: c._id,
        cabangNama: c.nama,
        count: row?.count || 0,
        totalNilai: row?.totalNilai || 0
      };
    });
    const voidTopReasons = voidTopReasonsRaw.map(r => ({
      reason: r.reason,
      count: r.count,
      totalNilai: r.totalNilai
    }));

    res.json({
      success: true,
      range,
      startDate,
      endDate,
      cabang: cabangParamId,
      breakdown: {
        produkFisik:   mapProduk(fisikRaw),
        produkDigital: mapProduk(digitalRaw),
        kategori:      mapKategori(kategoriRaw)
      },
      trendHarian,
      comparePeriode: {
        thisWeek: shapeWeek(thisWeek),
        lastWeek: shapeWeek(lastWeek)
      },
      peakHours: {
        windowDays: peakWindowDays,
        hours: peakHours
      },
      metodePembayaran: {
        global: metodeGlobal,
        perCabang: metodePerCabang
      },
      voidSummary: {
        count: voidTotal[0]?.count || 0,
        totalNilai: voidTotal[0]?.totalNilai || 0,
        perCabang: voidPerCabang,
        topReasons: voidTopReasons
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// ── Dashboard Widgets: produk/kategori terlaris + breakdown metode pembayaran (today) ─
exports.getDashboardWidgets = async (req, res) => {
  try {
    const Transaction = require('../models/Transaction');
    const owner = req.user;

    const cabangs = await Cabang.find({ owner: owner._id });
    const cabangIds = cabangs.map(c => c._id);

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const baseMatch = {
      cabang: { $in: cabangIds },
      type: 'penjualan',
      isVoid: { $ne: true },
      transactionDate: { $gte: todayStart, $lte: todayEnd },
    };

    const topProdukPipeline = (itemType) => ([
      { $match: baseMatch },
      { $unwind: '$items' },
      { $match: { 'items.type': itemType } },
      { $group: {
          _id: '$items.productName',
          productCode: { $first: '$items.productCode' },
          terjual: { $sum: { $ifNull: ['$items.quantity', 1] } },
          omset:   { $sum: '$items.subtotal' },
      } },
      { $sort: { terjual: -1 } },
      { $limit: 5 },
    ]);

    const [fisikRaw, digitalRaw, metodeRaw] = await Promise.all([
      Transaction.aggregate(topProdukPipeline('fisik')),
      Transaction.aggregate(topProdukPipeline('digital')),
      Transaction.aggregate([
        { $match: baseMatch },
        { $group: {
            _id: '$paymentMethod',
            total: { $sum: '$total' },
            count: { $sum: 1 },
        } },
      ]),
    ]);

    const mapProduk = (raw) => raw.map(p => ({
      nama: p._id,
      productCode: p.productCode || null,
      terjual: p.terjual || 0,
      omset:   p.omset   || 0,
    }));

    const produkFisikTerlaris   = mapProduk(fisikRaw);
    const produkDigitalTerlaris = mapProduk(digitalRaw);

    const METODE_ENUM = ['cash', 'qris', 'transfer', 'hutang'];
    const metodeMap = new Map(metodeRaw.map(m => [m._id, m]));
    const metodePembayaran = METODE_ENUM.map(method => {
      const row = metodeMap.get(method);
      return { method, total: row?.total || 0, count: row?.count || 0 };
    });

    res.json({
      success: true,
      produkFisikTerlaris,
      produkDigitalTerlaris,
      metodePembayaran,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// ── Toggle Cabang Aktif/Nonaktif (Owner) ──────────────────────────
// Sinkron: nonaktifkan cabang → Subscription.status juga jadi 'nonaktif'.
// Aktifkan lagi → JANGAN otomatis balikin status subscription; Owner harus
// lewat perpanjangan/konfirmasi bayar.
exports.toggleCabang = async (req, res) => {
  try {
    const owner = req.user;
    const { cabangId } = req.params;

    if (!mongoose.isValidObjectId(cabangId)) {
      return res.status(400).json({ success: false, message: 'Cabang tidak valid' });
    }

    const cabang = await Cabang.findOne({ _id: cabangId, owner: owner._id });
    if (!cabang) {
      return res.status(403).json({ success: false, message: 'Cabang bukan milik kamu' });
    }

    cabang.isActive = !cabang.isActive;
    await cabang.save();

    if (!cabang.isActive) {
      await Subscription.updateOne(
        { cabang: cabang._id },
        { $set: { status: 'nonaktif' } }
      );
    }

    res.json({
      success: true,
      message: `Cabang ${cabang.nama} ${cabang.isActive ? 'diaktifkan' : 'dinonaktifkan'}`,
      data: cabang,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// ══════════════════════════════════════════════════════════════════════════
// SERVICE HP — Halaman Owner (cross-cabang)
// ══════════════════════════════════════════════════════════════════════════

// Helper: scope cabang milik owner + optional filter ?cabang=<id>
async function scopeOwnerCabangs(req) {
  const owner = req.user;
  const allCabangs = await Cabang.find({ owner: owner._id }).select('_id nama kode');
  if (req.query.cabang) {
    if (!mongoose.isValidObjectId(req.query.cabang)) {
      return { error: { status: 400, message: 'Cabang tidak valid' } };
    }
    const found = allCabangs.find(c => c._id.equals(req.query.cabang));
    if (!found) return { error: { status: 403, message: 'Cabang bukan milik Anda' } };
    return { allCabangs, scopedCabangIds: [found._id] };
  }
  return { allCabangs, scopedCabangIds: allCabangs.map(c => c._id) };
}

// Helper: parse ?range → {start, end}. Default 'month'.
function parseServiceRange(range) {
  const r = String(range || 'month').toLowerCase();
  if (!['today', '7', '30', 'month'].includes(r)) return { error: 'Range tidak valid (today|7|30|month)' };
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  let start;
  if (r === 'today') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  } else if (r === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  } else {
    const days = r === '7' ? 7 : 30;
    start = new Date(now); start.setDate(now.getDate() - (days - 1)); start.setHours(0, 0, 0, 0);
  }
  return { start, end };
}

// ── GET /api/owner/service-summary ────────────────────────────────
// Ringkasan servis cross-cabang milik owner. Support ?range & ?cabang.
exports.getServiceSummary = async (req, res) => {
  try {
    const ServiceTransaction = require('../models/ServiceTransaction');

    const scope = await scopeOwnerCabangs(req);
    if (scope.error) return res.status(scope.error.status).json({ success: false, message: scope.error.message });

    const range = parseServiceRange(req.query.range);
    if (range.error) return res.status(400).json({ success: false, message: range.error });
    const { start, end } = range;

    const cabangMatch = { cabang: { $in: scope.scopedCabangIds } };

    const [paidAgg, statusAgg, durAgg] = await Promise.all([
      // Omset/laba/jumlahTx: hanya yang sudah dibayar & paidAt di range
      ServiceTransaction.aggregate([
        { $match: { ...cabangMatch, isVoid: { $ne: true }, isPaid: true, paidAt: { $gte: start, $lte: end } } },
        { $group: { _id: null, omset: { $sum: '$totalCost' }, laba: { $sum: '$profit' }, jumlahTx: { $sum: 1 } } }
      ]),
      // Status distribution: berdasarkan receivedAt di range (semua txn, exclude void)
      ServiceTransaction.aggregate([
        { $match: { ...cabangMatch, isVoid: { $ne: true }, receivedAt: { $gte: start, $lte: end } } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      // Rata-rata durasi jam: (paidAt - receivedAt) untuk yang paidAt in range
      ServiceTransaction.aggregate([
        { $match: {
            ...cabangMatch, isVoid: { $ne: true }, isPaid: true,
            paidAt: { $gte: start, $lte: end, $ne: null },
            receivedAt: { $ne: null }
        } },
        { $project: { durMs: { $subtract: ['$paidAt', '$receivedAt'] } } },
        { $match: { durMs: { $gte: 0 } } },
        { $group: { _id: null, avgMs: { $avg: '$durMs' }, count: { $sum: 1 } } }
      ]),
    ]);

    const statusMap = {};
    statusAgg.forEach(s => { statusMap[s._id] = s.count; });

    const avgMs = durAgg[0]?.avgMs || 0;
    const avgDurationHours = avgMs > 0 ? Math.round((avgMs / 3600000) * 10) / 10 : 0;

    res.json({
      success: true,
      data: {
        range: String(req.query.range || 'month').toLowerCase(),
        cabang: req.query.cabang || null,
        periode: { start, end },
        omset:    paidAgg[0]?.omset    || 0,
        laba:     paidAgg[0]?.laba     || 0,
        jumlahTx: paidAgg[0]?.jumlahTx || 0,
        statusCount: {
          antrian: statusMap.antrian || 0,
          proses:  statusMap.proses  || 0,
          selesai: statusMap.selesai || 0,
          diambil: statusMap.diambil || 0,
          batal:   statusMap.batal   || 0,
        },
        avgDurationHours,
        avgDurationSampleSize: durAgg[0]?.count || 0,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// ── GET /api/owner/service-list ───────────────────────────────────
// List transaksi servis cross-cabang milik owner, dengan filter & pagination.
exports.getServiceList = async (req, res) => {
  try {
    const ServiceTransaction = require('../models/ServiceTransaction');

    const scope = await scopeOwnerCabangs(req);
    if (scope.error) return res.status(scope.error.status).json({ success: false, message: scope.error.message });

    const { status, search } = req.query;
    const page  = Math.max(parseInt(req.query.page)  || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 25, 1), 100);
    const skip  = (page - 1) * limit;

    const query = {
      cabang: { $in: scope.scopedCabangIds },
      isVoid: { $ne: true },
    };
    if (status) query.status = status;
    if (search) {
      const re = new RegExp(search, 'i');
      query.$or = [
        { customerName: re },
        { deviceBrand:  re },
        { deviceModel:  re },
      ];
    }

    const [total, data] = await Promise.all([
      ServiceTransaction.countDocuments(query),
      ServiceTransaction.find(query)
        .sort({ receivedAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('customerName deviceBrand deviceModel complaint status receivedAt paidAt totalCost cabang technician invoiceNumber')
        .populate('cabang', 'nama kode')
        .populate('technician', 'name')
        .lean(),
    ]);

    res.json({ success: true, data, total, page, limit });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// ── GET /api/owner/service/:id ────────────────────────────────────
// Detail 1 servis. Validasi: cabang service HARUS milik owner.
exports.getServiceDetail = async (req, res) => {
  try {
    const ServiceTransaction = require('../models/ServiceTransaction');
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'ID tidak valid' });
    }

    const owner = req.user;
    const ownerCabangIds = (await Cabang.find({ owner: owner._id }).select('_id')).map(c => String(c._id));

    const doc = await ServiceTransaction.findById(id)
      .populate('cabang', 'nama kode')
      .populate('createdBy', 'name')
      .populate('technician', 'name')
      .lean();
    if (!doc) return res.status(404).json({ success: false, message: 'Tidak ditemukan' });

    const svcCabangId = doc.cabang?._id ? String(doc.cabang._id) : String(doc.cabang);
    if (!ownerCabangIds.includes(svcCabangId)) {
      return res.status(403).json({ success: false, message: 'Servis bukan milik cabang Anda' });
    }

    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// ── GET /api/owner/service-analytics ──────────────────────────────
// topKeluhan (keyword bucket dari complaint) + performaTeknisi (group by technician).
// Default window: bulan berjalan. Cross-cabang, respect ?cabang.
const KELUHAN_BUCKETS = [
  { key: 'lcd',        label: 'LCD / Layar',    regex: /lcd|layar|touchscreen|touch screen|ts /i },
  { key: 'baterai',    label: 'Baterai',        regex: /baterai|batre|batery|battery/i },
  { key: 'charging',   label: 'Charging',       regex: /charg|casan|cas |ngecas|colokan|port cas/i },
  { key: 'speaker',    label: 'Speaker / Suara', regex: /speaker|suara|earpiece|mic/i },
  { key: 'software',   label: 'Software',       regex: /software|sistem|reset|flash|firmware|aplikasi|hang|lemot|bootloop/i },
  { key: 'mati_total', label: 'Mati Total',     regex: /mati total|matot|mati$|mati saja|no display|blank/i },
  { key: 'kamera',     label: 'Kamera',         regex: /kamera|camera/i },
];

exports.getServiceAnalytics = async (req, res) => {
  try {
    const ServiceTransaction = require('../models/ServiceTransaction');

    const scope = await scopeOwnerCabangs(req);
    if (scope.error) return res.status(scope.error.status).json({ success: false, message: scope.error.message });

    const now   = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const cabangMatch = { cabang: { $in: scope.scopedCabangIds }, isVoid: { $ne: true } };

    const [complaints, teknisiAgg] = await Promise.all([
      ServiceTransaction.find({ ...cabangMatch, receivedAt: { $gte: start, $lte: end } })
        .select('complaint').lean(),
      ServiceTransaction.aggregate([
        { $match: { ...cabangMatch, technician: { $ne: null }, isPaid: true, paidAt: { $gte: start, $lte: end } } },
        { $group: { _id: '$technician', jumlahTx: { $sum: 1 }, omset: { $sum: '$totalCost' }, laba: { $sum: '$profit' } } },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: '$user' },
        { $project: { _id: 1, name: '$user.name', jumlahTx: 1, omset: 1, laba: 1 } },
        { $sort: { jumlahTx: -1 } },
      ]),
    ]);

    // Bucket keluhan
    const buckets = KELUHAN_BUCKETS.map(b => ({ key: b.key, label: b.label, count: 0 }));
    const lainnya = { key: 'lainnya', label: 'Lainnya', count: 0 };
    for (const doc of complaints) {
      const txt = doc.complaint || '';
      let matched = false;
      for (let i = 0; i < KELUHAN_BUCKETS.length; i++) {
        if (KELUHAN_BUCKETS[i].regex.test(txt)) {
          buckets[i].count += 1;
          matched = true;
          break;
        }
      }
      if (!matched) lainnya.count += 1;
    }
    const topKeluhan = [...buckets, lainnya]
      .filter(b => b.count > 0)
      .sort((a, b) => b.count - a.count);

    res.json({
      success: true,
      data: {
        cabang: req.query.cabang || null,
        periode: { start, end },
        topKeluhan,
        performaTeknisi: teknisiAgg,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// ══════════════════════════════════════════════════════════════════════════
// CLOSING KAS — Halaman Owner Laporan (cross-cabang)
// ══════════════════════════════════════════════════════════════════════════

// ── GET /api/owner/closing-riwayat ────────────────────────────────
// List closing kas lintas SEMUA cabang milik owner, dengan filter & pagination.
exports.getClosingRiwayat = async (req, res) => {
  try {
    const ClosingKas = require('../models/ClosingKas');

    const scope = await scopeOwnerCabangs(req);
    if (scope.error) return res.status(scope.error.status).json({ success: false, message: scope.error.message });

    const { type, dateStart, dateEnd } = req.query;
    const page  = Math.max(parseInt(req.query.page)  || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const skip  = (page - 1) * limit;

    const query = { cabang: { $in: scope.scopedCabangIds } };
    if (type && ['cash', 'produk'].includes(type)) query.type = type;
    if (dateStart || dateEnd) {
      query.tanggal = {};
      if (dateStart) query.tanggal.$gte = new Date(dateStart);
      if (dateEnd)   { const e = new Date(dateEnd); e.setHours(23,59,59,999); query.tanggal.$lte = e; }
    }

    const [total, data] = await Promise.all([
      ClosingKas.countDocuments(query),
      ClosingKas.find(query)
        .sort({ tanggal: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('cabang', 'nama kode')
        .populate('createdBy', 'name')
        .lean(),
    ]);

    res.json({ success: true, data, total, page, limit });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// ── GET /api/owner/closing/:id ────────────────────────────────────
// Detail 1 closing. Validasi: closing.cabang HARUS milik owner.
exports.getClosingDetail = async (req, res) => {
  try {
    const ClosingKas = require('../models/ClosingKas');
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'ID tidak valid' });
    }

    const owner = req.user;
    const ownerCabangIds = (await Cabang.find({ owner: owner._id }).select('_id')).map(c => String(c._id));

    const doc = await ClosingKas.findById(id)
      .populate('cabang', 'nama kode')
      .populate('createdBy', 'name')
      .lean();
    if (!doc) return res.status(404).json({ success: false, message: 'Tidak ditemukan' });

    const closingCabangId = doc.cabang?._id ? String(doc.cabang._id) : String(doc.cabang);
    if (!ownerCabangIds.includes(closingCabangId)) {
      return res.status(403).json({ success: false, message: 'Closing bukan milik cabang Anda' });
    }

    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// ══════════════════════════════════════════════════════════════════════════
// PEMBELIAN STOK — Halaman Owner Laporan (cross-cabang)
// ══════════════════════════════════════════════════════════════════════════

// ── GET /api/owner/pembelian-riwayat ──────────────────────────────
// List pembelian lintas SEMUA cabang milik owner, dengan filter & pagination.
exports.getPembelianRiwayat = async (req, res) => {
  try {
    const Pembelian = require('../models/Pembelian');

    const scope = await scopeOwnerCabangs(req);
    if (scope.error) return res.status(scope.error.status).json({ success: false, message: scope.error.message });

    const { supplier, dateStart, dateEnd } = req.query;
    const page  = Math.max(parseInt(req.query.page)  || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const skip  = (page - 1) * limit;

    const query = { cabang: { $in: scope.scopedCabangIds } };
    if (supplier) query.supplier = new RegExp(supplier, 'i');
    if (dateStart || dateEnd) {
      query.tanggal = {};
      if (dateStart) query.tanggal.$gte = new Date(dateStart);
      if (dateEnd)   { const e = new Date(dateEnd); e.setHours(23,59,59,999); query.tanggal.$lte = e; }
    }

    const [total, data] = await Promise.all([
      Pembelian.countDocuments(query),
      Pembelian.find(query)
        .sort({ tanggal: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('cabang', 'nama kode')
        .populate('createdBy', 'name')
        .lean(),
    ]);

    res.json({ success: true, data, total, page, limit });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// ── GET /api/owner/pembelian/:id ──────────────────────────────────
// Detail 1 pembelian. Validasi: pembelian.cabang HARUS milik owner.
exports.getPembelianDetail = async (req, res) => {
  try {
    const Pembelian = require('../models/Pembelian');
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'ID tidak valid' });
    }

    const owner = req.user;
    const ownerCabangIds = (await Cabang.find({ owner: owner._id }).select('_id')).map(c => String(c._id));

    const doc = await Pembelian.findById(id)
      .populate('cabang', 'nama kode')
      .populate('createdBy', 'name')
      .lean();
    if (!doc) return res.status(404).json({ success: false, message: 'Tidak ditemukan' });

    const pembelianCabangId = doc.cabang?._id ? String(doc.cabang._id) : String(doc.cabang);
    if (!ownerCabangIds.includes(pembelianCabangId)) {
      return res.status(403).json({ success: false, message: 'Pembelian bukan milik cabang Anda' });
    }

    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// ══════════════════════════════════════════════════════════════════════════
// LAPORAN BULANAN — Halaman Owner Laporan (cross-cabang)
// ══════════════════════════════════════════════════════════════════════════

// Konstanta konsisten dengan mainController.js (keep in sync)
const EXCLUDE_FROM_LABA_OWNER    = ['Pembelian Stok'];
const CASHBACK_CATEGORIES_OWNER  = ['Cashback / Fee'];

// ── GET /api/owner/reports/monthly?year=<>&cabang=all|<id> ───────
// Laporan bulanan 12-bulan. Kalau cabang=all/omitted: aggregate SEMUA cabang
// milik owner. Kalau cabang=<id>: scope ke 1 cabang (validated milik owner).
// Response format: sama seperti mainController.getMonthlyReport.
exports.getOwnerReportsMonthly = async (req, res) => {
  try {
    const Transaction = require('../models/Transaction');
    const { Finance } = require('../models/index');

    const owner = req.user;
    const allCabangs = await Cabang.find({ owner: owner._id }).select('_id nama kode');

    // Scope cabang: 'all' / omitted → semua cabang owner. Kalau id → 1 cabang (validate).
    let cabangIds;
    const cabangParam = req.query.cabang;
    if (cabangParam && cabangParam !== 'all') {
      if (!mongoose.isValidObjectId(cabangParam)) {
        return res.status(400).json({ success: false, message: 'Cabang tidak valid' });
      }
      const found = allCabangs.find(c => c._id.equals(cabangParam));
      if (!found) return res.status(403).json({ success: false, message: 'Cabang bukan milik Anda' });
      cabangIds = [found._id];
    } else {
      cabangIds = allCabangs.map(c => c._id);
    }

    const year      = parseInt(req.query.year) || new Date().getFullYear();
    const yearStart = new Date(year, 0, 1, 0, 0, 0, 0);
    const yearEnd   = new Date(year, 11, 31, 23, 59, 59, 999);

    // Optional month: scope breakdownMode ke 1 bulan spesifik (1-12). months[] & ringkasan tetap tahunan.
    let month = null;
    if (req.query.month !== undefined && req.query.month !== '') {
      const m = parseInt(req.query.month);
      if (!Number.isInteger(m) || m < 1 || m > 12) {
        return res.status(400).json({ success: false, message: 'Month harus integer 1-12' });
      }
      month = m;
    }

    const txMatch = { type: 'penjualan', isVoid: { $ne: true }, transactionDate: { $gte: yearStart, $lte: yearEnd }, cabang: { $in: cabangIds } };
    const fMatch  = { date: { $gte: yearStart, $lte: yearEnd }, cabang: { $in: cabangIds } };

    // Scope khusus untuk breakdownMode kalau month diisi.
    // Pakai $month (UTC) supaya konsisten dengan txPerMonth yang group $month — kalau slicing pakai
    // new Date(year, m-1, 1) local, tx di ujung bulan bisa geser bucket dan sum breakdown tidak match months[m-1].
    const modeMatch = month
      ? { ...txMatch, $expr: { $eq: [{ $month: '$transactionDate' }, month] } }
      : txMatch;

    const [txPerMonth, finPerMonth, modeAgg] = await Promise.all([
      Transaction.aggregate([
        { $match: txMatch },
        { $group: {
            _id: { $month: '$transactionDate' },
            omset:      { $sum: '$total' },
            labaKotor:  { $sum: '$totalProfit' },
            jumlahTx:   { $sum: 1 },
            jumlahItem: { $sum: { $size: { $ifNull: ['$items', []] } } },
        }},
        { $sort: { _id: 1 } }
      ]),
      Finance.aggregate([
        { $match: { ...fMatch, type: { $in: ['pemasukan', 'pengeluaran'] } } },
        { $group: {
            _id: { bulan: { $month: '$date' }, type: '$type', category: '$category' },
            total: { $sum: '$amount' }
        }}
      ]),
      // Breakdown Ritel vs Grosir — scope tahunan, atau ke 1 bulan kalau month diisi
      Transaction.aggregate([
        { $match: modeMatch },
        { $group: {
            _id: '$isGrosir',
            omset: { $sum: '$total' },
            laba:  { $sum: '$totalProfit' },
            count: { $sum: 1 },
        }}
      ]),
    ]);

    const BULAN = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
    const months = Array.from({ length: 12 }, (_, i) => {
      const tx  = txPerMonth.find(t => t._id === i + 1) || {};
      const fin = finPerMonth.filter(f => f._id.bulan === i + 1);
      const pemasukan     = fin.filter(f => f._id.type === 'pemasukan').reduce((t,f) => t + f.total, 0);
      const pengeluaran   = fin.filter(f => f._id.type === 'pengeluaran').reduce((t,f) => t + f.total, 0);
      const pengeluaranOp = fin.filter(f => f._id.type === 'pengeluaran' && !EXCLUDE_FROM_LABA_OWNER.includes(f._id.category)).reduce((t,f) => t + f.total, 0);
      const cashbackFee   = fin.filter(f => f._id.type === 'pemasukan' && CASHBACK_CATEGORIES_OWNER.includes(f._id.category)).reduce((t,f) => t + f.total, 0);
      const labaKotor     = tx.labaKotor || 0;
      const labaBersih    = labaKotor - pengeluaranOp + cashbackFee;
      return {
        bulan: i + 1, label: BULAN[i],
        omset: tx.omset || 0,
        labaKotor,
        pemasukan,
        pengeluaran: pengeluaranOp,
        labaBersih,
        jumlahTx:   tx.jumlahTx   || 0,
        jumlahItem: tx.jumlahItem || 0,
      };
    });

    const ringkasan = months.reduce((acc, m) => ({
      omset:       acc.omset       + m.omset,
      labaKotor:   acc.labaKotor   + m.labaKotor,
      pemasukan:   acc.pemasukan   + m.pemasukan,
      pengeluaran: acc.pengeluaran + m.pengeluaran,
      labaBersih:  acc.labaBersih  + m.labaBersih,
      jumlahTx:    acc.jumlahTx    + m.jumlahTx,
      jumlahItem:  acc.jumlahItem  + m.jumlahItem,
    }), { omset: 0, labaKotor: 0, pemasukan: 0, pengeluaran: 0, labaBersih: 0, jumlahTx: 0, jumlahItem: 0 });

    // Remap breakdownMode: isGrosir true → grosir, else (false/null/undefined) → ritel.
    // Pakai reduce agar bucket false & null/missing sama-sama terhitung sebagai ritel.
    const modeTotals = { ritel: { omset: 0, laba: 0, count: 0 }, grosir: { omset: 0, laba: 0, count: 0 } };
    for (const r of modeAgg) {
      const bucket = r._id === true ? 'grosir' : 'ritel';
      modeTotals[bucket].omset += r.omset || 0;
      modeTotals[bucket].laba  += r.laba  || 0;
      modeTotals[bucket].count += r.count || 0;
    }
    const breakdownMode = ['ritel', 'grosir'].map(mode => ({ mode, ...modeTotals[mode] }));

    res.json({
      success: true,
      data: {
        year,
        month,
        cabang: cabangParam || 'all',
        scopedCabangIds: cabangIds.map(String),
        months,
        ringkasan,
        breakdownMode,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};


// ── Notifikasi Owner (on-demand compute lintas 6 kategori) ──────
// State-based, tidak menyimpan history. Semua query dibatasi cabang milik owner.
exports.getOwnerNotifications = async (req, res) => {
  try {
    const Transaction        = require('../models/Transaction');
    const ServiceTransaction = require('../models/ServiceTransaction');
    const ClosingKas         = require('../models/ClosingKas');
    const Product            = require('../models/Product');
    const Absensi            = require('../models/Absensi');
    const { Finance }        = require('../models');

    const owner = req.user;
    const now   = new Date();
    const sevenDaysAgo   = new Date(now.getTime() - 7 * 86400000);
    const thirtyDaysAgo  = new Date(now.getTime() - 30 * 86400000);
    const todayEndOfDay  = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const AMOUNT_THRESHOLD = 500000;

    const fmtRp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');

    // Ambil semua cabang milik owner (aktif saja — cabang nonaktif tidak perlu dinotifkan)
    const cabangs = await Cabang.find({ owner: owner._id, isActive: true })
      .select('_id nama kode').lean();

    if (!cabangs.length) {
      return res.json({ success: true, data: [], total: 0 });
    }

    const cabangIds  = cabangs.map(c => c._id);
    const cabangMap  = new Map(cabangs.map(c => [String(c._id), c]));
    const cabangName = (id) => cabangMap.get(String(id))?.nama || '-';

    const [subs, lowStock, voids, servicesPending, piutangs, closings, pengajuanIzin, pengajuanLembur] = await Promise.all([
      // (a) Subscription expiring — hariTersisa <= 7
      Subscription.find({
        owner: owner._id,
        cabang: { $in: cabangIds },
        status: { $ne: 'gratis' },
        expiredAt: { $ne: null, $lte: new Date(now.getTime() + 7 * 86400000) },
      }).select('cabang status expiredAt').lean(),

      // (b) Stok menipis — lintas semua cabang owner
      Product.find({
        cabang: { $in: cabangIds },
        type: 'fisik',
        isActive: true,
        $expr: { $lte: ['$stock', { $ifNull: ['$minStock', 5] }] },
      }).select('code name stock minStock cabang updatedAt').lean(),

      // (c) Void besar — 7 hari terakhir, total > threshold
      Transaction.find({
        cabang: { $in: cabangIds },
        isVoid: true,
        total: { $gt: AMOUNT_THRESHOLD },
        voidAt: { $gte: sevenDaysAgo },
      }).select('invoiceNumber total voidAt voidReason voidByName cashierName cabang').lean(),

      // (d) Service HP selesai belum diambil > 7 hari
      ServiceTransaction.find({
        cabang: { $in: cabangIds },
        status: 'selesai',
        isVoid: { $ne: true },
        isArchived: { $ne: true },
        updatedAt: { $lt: sevenDaysAgo },
      }).select('invoiceNumber customerName deviceBrand deviceModel updatedAt cabang').lean(),

      // (e) Piutang jatuh tempo — Finance.type='piutang', belum lunas.
      // Dua kondisi (OR):
      //  1. dueDate ada & sudah <= hari ini (jatuh tempo normal)
      //  2. dueDate null tapi tanggal transaksi > 30 hari lalu — fallback
      //     supaya piutang lama tanpa jatuh tempo eksplisit tetap ternotifikasi
      Finance.find({
        cabang: { $in: cabangIds },
        type: 'piutang',
        isPaid: false,
        $or: [
          { dueDate: { $ne: null, $lte: todayEndOfDay } },
          { dueDate: null, date: { $lte: thirtyDaysAgo } },
        ],
      }).select('description amount dueDate date createdAt relatedParty cabang').lean(),

      // (f) Selisih closing besar — 7 hari terakhir, statusSelisih='kurang', |selisih| > threshold
      ClosingKas.find({
        cabang: { $in: cabangIds },
        type: 'cash',
        statusSelisih: 'kurang',
        tanggal: { $gte: sevenDaysAgo },
        $expr: { $gt: [{ $abs: '$selisih' }, AMOUNT_THRESHOLD] },
      }).select('tanggal selisih createdByName shift cabang').lean(),

      // (g) Pengajuan izin/sakit/cuti yang belum di-approve
      Absensi.find({
        cabang: { $in: cabangIds },
        status: { $in: ['izin', 'sakit', 'cuti'] },
        approvalStatus: 'pending',
      }).select('status tanggal keterangan user cabang createdAt')
        .populate('user', 'name')
        .lean(),

      // (h) Pengajuan lembur pending — Absensi yang punya subdoc lembur pending
      Absensi.find({
        cabang: { $in: cabangIds },
        'lembur.approvalStatus': 'pending',
      }).select('tanggal lembur user cabang')
        .populate('user', 'name')
        .lean(),
    ]);

    const items = [];

    // (a) Subscription
    for (const s of subs) {
      const hariTersisa = Math.ceil((new Date(s.expiredAt) - now) / 86400000);
      const cNama = cabangName(s.cabang);
      let severity = 'warning';
      let title = `Subscription "${cNama}" akan expired`;
      let message;
      if (hariTersisa <= 0) {
        severity = 'danger';
        title = `Subscription "${cNama}" sudah expired`;
        message = `Cabang berpotensi dinonaktifkan. Segera lakukan pembayaran.`;
      } else if (hariTersisa <= 3) {
        severity = 'danger';
        message = `Sisa ${hariTersisa} hari. Segera lakukan pembayaran perpanjangan.`;
      } else {
        message = `Sisa ${hariTersisa} hari sebelum expired.`;
      }
      items.push({
        id: `sub-${s.cabang}`,
        type: 'subscription',
        severity,
        title,
        message,
        meta: { cabangId: s.cabang, cabangNama: cNama, expiredAt: s.expiredAt, hariTersisa },
        createdAt: s.expiredAt,
      });
    }

    // (b) Low stock — "menipis" adalah kondisi real-time saat endpoint
    // dipanggil, bukan event historis. Jangan pakai Product.updatedAt
    // (kapan produk terakhir diedit) — pakai `now` supaya urutan &
    // waktu relatif ("baru saja") mencerminkan evaluasi saat ini.
    for (const p of lowStock) {
      items.push({
        id: `stock-${p._id}`,
        type: 'low_stock',
        severity: p.stock === 0 ? 'danger' : 'warning',
        title: `Stok menipis: ${p.name}`,
        message: p.stock === 0
          ? `Stok habis (0). Minimum: ${p.minStock}. Segera lakukan pembelian.`
          : `Sisa ${p.stock} ${p.minStock ? `(min ${p.minStock})` : ''}. Perlu restock.`,
        meta: {
          cabangId: p.cabang, cabangNama: cabangName(p.cabang),
          productId: p._id, code: p.code, stock: p.stock, minStock: p.minStock,
        },
        createdAt: now,
      });
    }

    // (c) Void besar
    for (const t of voids) {
      items.push({
        id: `void-${t._id}`,
        type: 'void_besar',
        severity: 'warning',
        title: `Void transaksi besar: ${fmtRp(t.total)}`,
        message: `${t.invoiceNumber} di "${cabangName(t.cabang)}" divoid oleh ${t.voidByName || '-'}. Alasan: ${t.voidReason || '-'}.`,
        meta: {
          cabangId: t.cabang, cabangNama: cabangName(t.cabang),
          invoiceNumber: t.invoiceNumber, total: t.total,
          voidByName: t.voidByName, voidReason: t.voidReason,
        },
        createdAt: t.voidAt,
      });
    }

    // (d) Service belum diambil > 7 hari
    for (const s of servicesPending) {
      const hariMenunggu = Math.floor((now - new Date(s.updatedAt)) / 86400000);
      const dev = [s.deviceBrand, s.deviceModel].filter(Boolean).join(' ') || 'unit';
      items.push({
        id: `service-${s._id}`,
        type: 'service_pending',
        severity: 'info',
        title: `Service belum diambil > ${hariMenunggu} hari`,
        message: `${s.invoiceNumber} — ${s.customerName} (${dev}) di "${cabangName(s.cabang)}" sudah selesai tapi belum diambil.`,
        meta: {
          cabangId: s.cabang, cabangNama: cabangName(s.cabang),
          invoiceNumber: s.invoiceNumber, customerName: s.customerName,
          hariMenunggu,
        },
        createdAt: s.updatedAt,
      });
    }

    // (e) Piutang jatuh tempo
    for (const f of piutangs) {
      const hasDueDate = f.dueDate != null;
      const refDate = hasDueDate ? new Date(f.dueDate) : new Date(f.date || f.createdAt);
      const hariOverdue = Math.floor((now - refDate) / 86400000);
      const partyStr = f.relatedParty ? ` (${f.relatedParty})` : '';
      const cabangStr = `"${cabangName(f.cabang)}"`;
      const desc = f.description || 'Piutang';
      const message = hasDueDate
        ? `${desc}${partyStr} di ${cabangStr} — ${hariOverdue > 0 ? `terlambat ${hariOverdue} hari` : 'jatuh tempo hari ini'}.`
        : `${desc}${partyStr} di ${cabangStr} — belum dibayar ${hariOverdue} hari (tidak ada tanggal jatuh tempo).`;
      items.push({
        id: `piutang-${f._id}`,
        type: 'piutang_jatuh_tempo',
        severity: 'danger',
        title: `Piutang jatuh tempo: ${fmtRp(f.amount)}`,
        message,
        meta: {
          cabangId: f.cabang, cabangNama: cabangName(f.cabang),
          amount: f.amount, dueDate: f.dueDate,
          relatedParty: f.relatedParty, hariOverdue,
        },
        createdAt: refDate,
      });
    }

    // (f) Selisih closing besar
    for (const c of closings) {
      items.push({
        id: `closing-${c._id}`,
        type: 'closing_selisih',
        severity: 'danger',
        title: `Selisih closing kas besar: ${fmtRp(Math.abs(c.selisih))}`,
        message: `Shift ${c.shift} di "${cabangName(c.cabang)}" oleh ${c.createdByName || '-'} — selisih kurang ${fmtRp(Math.abs(c.selisih))}.`,
        meta: {
          cabangId: c.cabang, cabangNama: cabangName(c.cabang),
          selisih: c.selisih, shift: c.shift, createdByName: c.createdByName,
        },
        createdAt: c.tanggal,
      });
    }

    // (g) Pengajuan izin/sakit/cuti menunggu approval
    for (const p of pengajuanIzin) {
      const userNama = p.user?.name || 'Karyawan';
      const tglStr = new Date(p.tanggal).toLocaleDateString('id-ID', {
        day: '2-digit', month: 'short', year: 'numeric',
      });
      items.push({
        id: `izin-${p._id}`,
        type: 'pengajuan_izin',
        severity: 'info',
        title: `Pengajuan ${p.status}: ${userNama}`,
        message: `${userNama} di "${cabangName(p.cabang)}" mengajukan ${p.status} untuk ${tglStr}. ${p.keterangan ? `Alasan: ${p.keterangan}` : ''}`.trim(),
        meta: {
          cabangId: p.cabang, cabangNama: cabangName(p.cabang),
          absensiId: p._id, userId: p.user?._id, userNama,
          status: p.status, tanggal: p.tanggal, keterangan: p.keterangan,
        },
        createdAt: p.createdAt,
      });
    }

    // (h) Pengajuan lembur menunggu approval — 1 item per subdoc pending
    const fmtJam = (d) => new Date(d).toLocaleTimeString('id-ID', {
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    for (const a of pengajuanLembur) {
      const userNama = a.user?.name || 'Karyawan';
      const tglStr = new Date(a.tanggal).toLocaleDateString('id-ID', {
        day: '2-digit', month: 'short', year: 'numeric',
      });
      for (const l of (a.lembur || [])) {
        if (l.approvalStatus !== 'pending') continue;
        const jamStr = `${fmtJam(l.jamMulai)}–${fmtJam(l.jamSelesai)}`;
        const durasiJam = (l.durasiMenit / 60).toFixed(1).replace(/\.0$/, '');
        items.push({
          id: `lembur-${l._id}`,
          type: 'pengajuan_lembur',
          severity: 'info',
          title: `Pengajuan lembur: ${userNama}`,
          message: `${userNama} di "${cabangName(a.cabang)}" mengajukan lembur ${jamStr} (${durasiJam} jam) tanggal ${tglStr}.${l.alasan ? ` Alasan: ${l.alasan}` : ''}`,
          meta: {
            cabangId: a.cabang, cabangNama: cabangName(a.cabang),
            absensiId: a._id, lemburId: l._id,
            userId: a.user?._id, userNama,
            tanggal: a.tanggal,
            jamMulai: l.jamMulai, jamSelesai: l.jamSelesai,
            durasiMenit: l.durasiMenit,
            alasan: l.alasan,
          },
          createdAt: l.createdAt,
        });
      }
    }

    // Sort by createdAt DESC (newest first)
    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ success: true, data: items, total: items.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
