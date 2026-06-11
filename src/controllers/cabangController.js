const Cabang = require('../models/Cabang');
const User   = require('../models/User');

// GET semua cabang
exports.getAll = async (req, res) => {
  try {
    const data = await Cabang.find().sort('nama').populate('createdBy', 'name');
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// GET satu cabang
exports.getOne = async (req, res) => {
  try {
    const data = await Cabang.findById(req.params.id);
    if (!data) return res.status(404).json({ success: false, message: 'Cabang tidak ditemukan' });
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// POST buat cabang baru
exports.create = async (req, res) => {
  try {
    const { nama, kode, alamat, telepon } = req.body;
    if (!nama || !kode) return res.status(400).json({ success: false, message: 'Nama dan kode cabang wajib diisi' });

    const existing = await Cabang.findOne({ kode: kode.toUpperCase() });
    if (existing) return res.status(400).json({ success: false, message: `Kode cabang ${kode} sudah dipakai` });

    const cabang = await Cabang.create({
      nama, kode: kode.toUpperCase(), alamat, telepon,
      createdBy: req.user._id
    });

    // Auto-init saldo kas tunai untuk cabang baru
    const Saldo = require('../models/Saldo');
    await Saldo.create({
      akunId:    `tunai-${cabang.kode.toLowerCase()}`,
      namaAkun:  'Kas Tunai',
      group:     'Tunai',
      icon:      '💵',
      saldo:     0,
      isActive:  true,
      cabang:    cabang._id,
    });

    res.status(201).json({ success: true, data: cabang, message: `Cabang ${nama} berhasil dibuat` });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// PUT update cabang
exports.update = async (req, res) => {
  try {
    const { nama, alamat, telepon, isActive } = req.body;
    const cabang = await Cabang.findByIdAndUpdate(
      req.params.id,
      { nama, alamat, telepon, isActive },
      { new: true }
    );
    if (!cabang) return res.status(404).json({ success: false, message: 'Cabang tidak ditemukan' });
    res.json({ success: true, data: cabang });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// DELETE cabang (nonaktifkan saja, jangan hapus data)
exports.deactivate = async (req, res) => {
  try {
    const cabang = await Cabang.findByIdAndUpdate(
      req.params.id, { isActive: false }, { new: true }
    );
    if (!cabang) return res.status(404).json({ success: false, message: 'Cabang tidak ditemukan' });
    res.json({ success: true, message: `Cabang ${cabang.nama} dinonaktifkan` });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// GET user per cabang
exports.getUsers = async (req, res) => {
  try {
    const users = await User.find({ cabang: req.params.id }).select('-password');
    res.json({ success: true, data: users });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// GET statistik karyawan per cabang (superadmin)
exports.getEmployeeStats = async (req, res) => {
  try {
    const Transaction = require('../models/Transaction');
    const cabangs = await Cabang.find({ isActive: true });
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const result = await Promise.all(cabangs.map(async c => {
      const [bulanIni, hariIni] = await Promise.all([
        Transaction.aggregate([
          { $match: { cabang: c._id, type: 'penjualan', isVoid: { $ne: true }, transactionDate: { $gte: monthStart } } },
          { $group: { _id: '$cashierName', totalTx: { $sum: 1 }, totalOmset: { $sum: '$total' }, totalLaba: { $sum: '$totalProfit' }, totalItems: { $sum: { $size: { $ifNull: ['$items', []] } } } } },
          { $sort: { totalOmset: -1 } }
        ]),
        Transaction.aggregate([
          { $match: { cabang: c._id, type: 'penjualan', isVoid: { $ne: true }, transactionDate: { $gte: todayStart, $lte: todayEnd } } },
          { $group: { _id: '$cashierName', totalTx: { $sum: 1 }, totalOmset: { $sum: '$total' } } },
          { $sort: { totalOmset: -1 } }
        ])
      ]);
      return { _id: c._id, nama: c.nama, kode: c.kode, bulanIni, hariIni };
    }));

    res.json({ success: true, data: result });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// GET statistik ringkasan per cabang (untuk superadmin dashboard)
exports.getSummary = async (req, res) => {
  try {
    const Transaction = require('../models/Transaction');
    const Product     = require('../models/Product');
    const Saldo       = require('../models/Saldo');

    const cabangs = await Cabang.find({ isActive: true });

    const now   = new Date();
    const tHari = new Date(now); tHari.setHours(0,0,0,0);
    const tMing = new Date(now); tMing.setDate(now.getDate() - 7); tMing.setHours(0,0,0,0);
    const tBulan= new Date(now.getFullYear(), now.getMonth(), 1);

    const txStat = async (cabangId, since) => {
      const r = await Transaction.aggregate([
        { $match: { cabang: cabangId, type: 'penjualan', isVoid: { $ne: true }, transactionDate: { $gte: since } } },
        { $group: { _id: null, omset: { $sum: '$total' }, laba: { $sum: '$totalProfit' }, count: { $sum: 1 } } }
      ]);
      return { omset: r[0]?.omset||0, laba: r[0]?.laba||0, count: r[0]?.count||0 };
    };

    const summaries = await Promise.all(cabangs.map(async c => {
      const [harian, mingguan, bulanan, prodCount, saldos] = await Promise.all([
        txStat(c._id, tHari),
        txStat(c._id, tMing),
        txStat(c._id, tBulan),
        Product.countDocuments({ cabang: c._id, isActive: true }),
        Saldo.find({ cabang: c._id, isActive: true }).select('akunId saldo'),
      ]);

      const kasTunai = saldos.find(s => s.akunId === 'tunai')?.saldo || 0;
      const brankas  = saldos.find(s => s.akunId === 'brankas')?.saldo || 0;
      const saldoDigital = saldos
        .filter(s => s.akunId !== 'tunai' && s.akunId !== 'brankas')
        .reduce((t, s) => t + s.saldo, 0);

      return {
        _id: c._id, nama: c.nama, kode: c.kode, isActive: c.isActive,
        alamat: c.alamat, telepon: c.telepon,
        harian, mingguan, bulanan,
        jumlahProduk: prodCount,
        kasTunai, brankas, saldoDigital,
      };
    }));

    res.json({ success: true, data: summaries });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
