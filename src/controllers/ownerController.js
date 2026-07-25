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
    const users = await User.find({
      cabang: { $in: cabangIds },
      role: { $in: ['admin', 'karyawan'] }
    }).populate('cabang', 'nama kode').sort('-createdAt');
    res.json({ success: true, data: users });
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
    const populated = await User.findById(user._id).populate('cabang', 'nama kode');
    res.status(201).json({ success: true, message: 'User berhasil ditambahkan', data: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
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
    res.json({ success: true, message: `User ${user.isActive ? 'diaktifkan' : 'dinonaktifkan'}`, data: user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getUsers = async (req, res) => {
  try {
    const owner = req.user;
    const cabangs = await Cabang.find({ owner: owner._id }).select('_id');
    const cabangIds = cabangs.map(c => c._id);
    const users = await User.find({ cabang: { $in: cabangIds }, role: { $in: ['admin','karyawan'] } }).populate('cabang','nama kode').sort('-createdAt');
    res.json({ success: true, data: users });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
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

    const now        = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const stats = await Transaction.aggregate([
      { $match: { ...cabangFilter, type: 'penjualan', isVoid: { $ne: true }, transactionDate: { $gte: monthStart } } },
      { $group: {
        _id: '$cashierName',
        totalTx:     { $sum: 1 },
        totalOmset:  { $sum: '$total' },
        totalLaba:   { $sum: '$totalProfit' },
        totalItems:  { $sum: { $size: { $ifNull: ['$items', []] } } },
      }},
      { $sort: { totalOmset: -1 } }
    ]);

    res.json({ success: true, data: stats });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};


// ── Get Summary Cabang untuk Owner Dashboard ─────────────────────
exports.getCabangSummary = async (req, res) => {
  try {
    const Transaction = require('../models/Transaction');
    const Saldo = require('../models/Saldo');
    const Product = require('../models/Product');
    const owner = req.user;

    const cabangs = await Cabang.find({ owner: owner._id, isActive: true });
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

    const [perCabang, sparklineRaw] = await Promise.all([
      Promise.all(cabangs.map(async c => {
        const cabangQ = { cabang: c._id };

        const [harian, mingguan, bulanan, saldos, nilaiStokRes] = await Promise.all([
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
        ]);

        const kasTunai    = saldos.find(s => s.akunId.startsWith('tunai'))?.saldo || 0;
        const brankas     = saldos.find(s => s.akunId === 'brankas')?.saldo || 0;
        const saldoDigital= saldos.filter(s => !s.akunId.startsWith('tunai') && s.akunId !== 'brankas').reduce((t,s) => t + s.saldo, 0);
        const nilaiStok   = nilaiStokRes[0]?.nilaiStok || 0;

        return {
          _id: c._id, nama: c.nama, kode: c.kode, isActive: c.isActive,
          harian:   { omset: harian[0]?.omset||0,   laba: harian[0]?.laba||0,   count: harian[0]?.count||0   },
          mingguan: { omset: mingguan[0]?.omset||0,  laba: mingguan[0]?.laba||0,  count: mingguan[0]?.count||0  },
          bulanan:  { omset: bulanan[0]?.omset||0,   laba: bulanan[0]?.laba||0,   count: bulanan[0]?.count||0   },
          kasTunai, brankas, saldoDigital, nilaiStok,
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
    ]);

    // Lookup { cabangId → { tanggal → row } }
    const sparklineByCabang = new Map();
    for (const row of sparklineRaw) {
      const cid = String(row._id.cabang);
      if (!sparklineByCabang.has(cid)) sparklineByCabang.set(cid, {});
      sparklineByCabang.get(cid)[row._id.tanggal] = row;
    }

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
      return { ...c, kemarin, sparkline };
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


// ── Hourly / Daily Chart: omset+laba per jam (today) atau per tanggal (7/30 hari) ─
exports.getHourlyChart = async (req, res) => {
  try {
    const Transaction = require('../models/Transaction');
    const owner = req.user;

    const range = String(req.query.range || 'today').toLowerCase();
    const cabangs = await Cabang.find({ owner: owner._id });
    const cabangIds = cabangs.map(c => c._id);

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

      return res.json({ success: true, labels, series });
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

    res.json({ success: true, labels, series });
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
