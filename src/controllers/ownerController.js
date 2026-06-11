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
    const { name, username, password, namaToko, alamat, telepon } = req.body;

    if (!name || !username || !password || !namaToko) {
      return res.status(400).json({ success: false, message: 'Semua field wajib diisi' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password minimal 6 karakter' });
    }

    const exists = await User.findOne({ username });
    if (exists) {
      return res.status(400).json({ success: false, message: 'Username sudah digunakan' });
    }

    // Buat kode cabang otomatis dari nama toko
    const kode = namaToko.toUpperCase().replace(/\s+/g, '').slice(0, 6) + Date.now().toString().slice(-4);

    // Buat user owner
    const owner = await User.create({
      name, username, password,
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


// ── Get Performa Karyawan milik Owner ────────────────────────────
exports.getEmployeeStats = async (req, res) => {
  try {
    const Transaction = require('../models/Transaction');
    const owner = req.user;

    const cabangs = await Cabang.find({ owner: owner._id });
    const cabangIds = cabangs.map(c => c._id);

    // Filter opsional per cabang
    const cabangFilter = req.query.cabang
      ? { cabang: req.query.cabang }
      : { cabang: { $in: cabangIds } };

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
    const owner = req.user;

    const cabangs = await Cabang.find({ owner: owner._id, isActive: true });

    const now = new Date();
    const todayStart  = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const todayEnd    = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const weekStart   = new Date(now); weekStart.setDate(now.getDate() - 6); weekStart.setHours(0,0,0,0);
    const monthStart  = new Date(now.getFullYear(), now.getMonth(), 1);

    const result = await Promise.all(cabangs.map(async c => {
      const cabangQ = { cabang: c._id };

      const [harian, mingguan, bulanan, saldos] = await Promise.all([
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
      ]);

      const kasTunai    = saldos.find(s => s.akunId.startsWith('tunai'))?.saldo || 0;
      const brankas     = saldos.find(s => s.akunId === 'brankas')?.saldo || 0;
      const saldoDigital= saldos.filter(s => !s.akunId.startsWith('tunai') && s.akunId !== 'brankas').reduce((t,s) => t + s.saldo, 0);

      return {
        _id: c._id, nama: c.nama, kode: c.kode, isActive: c.isActive,
        harian:   { omset: harian[0]?.omset||0,   laba: harian[0]?.laba||0,   count: harian[0]?.count||0   },
        mingguan: { omset: mingguan[0]?.omset||0,  laba: mingguan[0]?.laba||0,  count: mingguan[0]?.count||0  },
        bulanan:  { omset: bulanan[0]?.omset||0,   laba: bulanan[0]?.laba||0,   count: bulanan[0]?.count||0   },
        kasTunai, brankas, saldoDigital,
      };
    }));

    res.json({ success: true, data: result });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
