const ServiceTransaction = require('../models/ServiceTransaction');
const ServiceFinance     = require('../models/ServiceFinance');
const ServiceClosing     = require('../models/ServiceClosing');
const { Customer, Settings } = require('../models/index');

// ─── Status label ─────────────────────────────────────────────────────────
const STATUS_LABEL = {
  antrian: 'Antrian', proses: 'Proses', selesai: 'Selesai',
  diambil: 'Diambil', batal: 'Batal'
};

// ══════════════════════════════════════════════════════════════════════════
// TRANSAKSI SERVIS
// ══════════════════════════════════════════════════════════════════════════

// GET /api/service — list semua transaksi servis
exports.getAll = async (req, res) => {
  try {
    const { status, search, startDate, endDate, limit = 50, page = 1 } = req.query;
    const cabangQ = req.cabangFilter || {};
    const query = { isVoid: { $ne: true }, ...cabangQ };

    // Auto filter bulan berjalan (kecuali ada filter tanggal manual)
    if (!startDate && !endDate) {
      const now = new Date();
      query.receivedAt = {
        $gte: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0),
        $lte: new Date(now.getFullYear(), now.getMonth()+1, 0, 23, 59, 59, 999)
      };
    }

    if (status) query.status = status;
    if (search) {
      query.$or = [
        { customerName:  new RegExp(search, 'i') },
        { customerPhone: new RegExp(search, 'i') },
        { deviceBrand:   new RegExp(search, 'i') },
        { deviceModel:   new RegExp(search, 'i') },
        { invoiceNumber: new RegExp(search, 'i') },
        { complaint:     new RegExp(search, 'i') },
      ];
    }
    if (startDate || endDate) {
      query.receivedAt = {};
      if (startDate) query.receivedAt.$gte = new Date(startDate);
      if (endDate)   { const e = new Date(endDate); e.setHours(23,59,59); query.receivedAt.$lte = e; }
    }

    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const total = await ServiceTransaction.countDocuments(query);
    const data  = await ServiceTransaction.find(query)
      .sort({ receivedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('createdBy', 'name');

    res.json({ success: true, data, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// GET /api/service/:id
exports.getOne = async (req, res) => {
  try {
    const doc = await ServiceTransaction.findById(req.params.id).populate('createdBy', 'name');
    if (!doc) return res.status(404).json({ success: false, message: 'Tidak ditemukan' });
    res.json({ success: true, data: doc });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// POST /api/service — buat transaksi servis baru
exports.create = async (req, res) => {
  try {
    const cabangId = req.user.role === 'superadmin' ? (req.body.cabang || null) : (req.user.cabang?._id || req.user.cabang || null);
    const doc = new ServiceTransaction({ ...req.body, createdBy: req.user._id, cabang: cabangId });
    await doc.save();
    res.status(201).json({ success: true, data: doc });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// PUT /api/service/:id — update (termasuk ganti status)
exports.update = async (req, res) => {
  try {
    const doc = await ServiceTransaction.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Tidak ditemukan' });

    // Jika status berubah jadi 'diambil' dan belum dibayar → otomatis lunas
    const { status, isPaid } = req.body;
    if (status === 'diambil' && !doc.isPaid) {
      req.body.isPaid = true;
      req.body.paidAt = new Date();
    }
    if (isPaid && !doc.isPaid) {
      req.body.paidAt = new Date();
    }

    const wasNotDiambil = doc.status !== 'diambil';
    Object.assign(doc, req.body);
    await doc.save();

    // Beri poin ke member jika status baru jadi 'diambil' dan ada customerId
    if (status === 'diambil' && wasNotDiambil && doc.customerId) {
      try {
        const settings   = await Settings.findOne({ cabang: doc.cabang });
        const pointPer   = settings?.pointSettings?.pointPerRupiah || 50;
        const earnPoints = Math.floor(doc.totalCost / pointPer);
        if (earnPoints > 0) {
          await Customer.findByIdAndUpdate(doc.customerId, {
            $inc: { points: earnPoints, totalPoints: earnPoints }
          });
        }
      } catch(e) { console.error('Gagal beri poin service:', e.message); }
    }

    res.json({ success: true, data: doc });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// DELETE /api/service/:id — void (admin only)
exports.voidService = async (req, res) => {
  try {
    const doc = await ServiceTransaction.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: 'Tidak ditemukan' });

    // Cabut poin member jika transaksi sudah diambil & ada customerId
    if (doc.status === 'diambil' && doc.customerId) {
      try {
        const settings   = await Settings.findOne({ cabang: doc.cabang });
        const pointPer   = settings?.pointSettings?.pointPerRupiah || 50;
        const earnPoints = Math.floor(doc.totalCost / pointPer);
        if (earnPoints > 0) {
          await Customer.findByIdAndUpdate(doc.customerId, {
            $inc: { points: -earnPoints, totalPoints: -earnPoints }
          });
        }
      } catch(e) { console.error('Gagal cabut poin service:', e.message); }
    }

    doc.isVoid = true;
    await doc.save();
    res.json({ success: true, message: 'Transaksi dibatalkan' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══════════════════════════════════════════════════════════════════════════
// KEUANGAN SERVIS
// ══════════════════════════════════════════════════════════════════════════

// GET /api/service/finance — list catatan keuangan servis
exports.getFinance = async (req, res) => {
  try {
    const { type, startDate, endDate } = req.query;
    const cabangQ = req.cabangFilter || {};
    const query = { ...cabangQ };
    if (type) query.type = type;
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate)   { const e = new Date(endDate); e.setHours(23,59,59); query.date.$lte = e; }
    }
    const data = await ServiceFinance.find(query).sort({ date: -1 }).populate('createdBy', 'name');
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// POST /api/service/finance
exports.createFinance = async (req, res) => {
  try {
    const cabangId = req.user.role === 'superadmin' ? (req.body.cabang || null) : (req.user.cabang?._id || req.user.cabang || null);
    const doc = new ServiceFinance({ ...req.body, createdBy: req.user._id, cabang: cabangId });
    await doc.save();
    res.status(201).json({ success: true, data: doc });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// PUT /api/service/finance/:id
exports.updateFinance = async (req, res) => {
  try {
    const doc = await ServiceFinance.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!doc) return res.status(404).json({ success: false, message: 'Tidak ditemukan' });
    res.json({ success: true, data: doc });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// DELETE /api/service/finance/:id
exports.deleteFinance = async (req, res) => {
  try {
    await ServiceFinance.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Dihapus' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// GET /api/service/summary — ringkasan keuangan servis
exports.getSummary = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const now = new Date();
    const dateQ = {};
    // Default filter bulan ini jika tidak ada parameter tanggal
    if (startDate) dateQ.$gte = new Date(startDate);
    else dateQ.$gte = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    if (endDate) { const e = new Date(endDate); e.setHours(23,59,59); dateQ.$lte = e; }
    else dateQ.$lte = new Date(now.getFullYear(), now.getMonth()+1, 0, 23, 59, 59, 999);

    const cabangQ = req.cabangFilter || {};
    const txQuery = { isVoid: { $ne: true }, isPaid: true, isArchived: { $ne: true }, ...cabangQ };
    if (Object.keys(dateQ).length) txQuery.paidAt = dateQ;

    const finQuery = { isArchived: { $ne: true }, ...cabangQ };
    if (Object.keys(dateQ).length) finQuery.date = dateQ;

    const [txs, expenses, incomes, statusCount] = await Promise.all([
      ServiceTransaction.find(txQuery),
      ServiceFinance.aggregate([
        { $match: { ...finQuery, type: 'pengeluaran' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),
      ServiceFinance.aggregate([
        { $match: { ...finQuery, type: 'pemasukan' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),
      ServiceTransaction.aggregate([
        { $match: { isVoid: { $ne: true }, isArchived: { $ne: true }, ...cabangQ, receivedAt: dateQ } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
    ]);

    const omset        = txs.reduce((s, t) => s + t.totalCost, 0);
    const labaKotor    = txs.reduce((s, t) => s + t.profit, 0);
    const totalExpense = expenses[0]?.total || 0;
    const totalIncome  = incomes[0]?.total  || 0;
    // Kas Tunai = omset + pemasukan - pengeluaran
    const kasTunai     = omset + totalIncome - totalExpense;
    // Laba Bersih = omset - pengeluaran (pemasukan tidak ikut laba)
    const labaBersih   = omset - totalExpense;

    const statusMap = {};
    statusCount.forEach(s => { statusMap[s._id] = s.count; });

    res.json({
      success: true,
      data: {
        omset: kasTunai,       // Kas Tunai = omset + pemasukan - pengeluaran
        omsetMurni: omset,     // Omset murni dari transaksi saja
        labaKotor, totalExpense, totalIncome, labaBersih,
        jumlahTx: txs.length,
        statusCount: {
          antrian: statusMap.antrian || 0,
          proses:  statusMap.proses  || 0,
          selesai: statusMap.selesai || 0,
          diambil: statusMap.diambil || 0,
          batal:   statusMap.batal   || 0,
        }
      }
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};


// ══════════════════════════════════════════════════════════════════════════
// CLOSING SERVICE
// ══════════════════════════════════════════════════════════════════════════

// GET /api/service/closing/preview — ringkasan bulan ini sebelum closing
exports.getClosingPreview = async (req, res) => {
  try {
    const cabangQ = req.cabangFilter || {};
    const now     = new Date();
    // Support pilih bulan/tahun manual via query param
    const bulan   = parseInt(req.query.bulan)  || now.getMonth() + 1;
    const tahun   = parseInt(req.query.tahun)  || now.getFullYear();
    const start   = new Date(tahun, bulan - 1, 1, 0, 0, 0, 0);
    const end     = new Date(tahun, bulan, 0, 23, 59, 59, 999);

    // Cek apakah bulan ini sudah pernah di-closing
    const existing = await ServiceClosing.findOne({ bulan, tahun, ...cabangQ });
    if (existing) return res.status(400).json({ success: false, message: `Bulan ini sudah pernah di-closing pada ${new Date(existing.createdAt).toLocaleDateString('id-ID')}` });

    const txs = await ServiceTransaction.find({
      isVoid: { $ne: true },
      receivedAt: { $gte: start, $lte: end },
      ...cabangQ
    });

    const paidTxs    = txs.filter(t => t.isPaid);
    const omsetMurni = paidTxs.reduce((s, t) => s + t.totalCost, 0);
    const labaKotor  = paidTxs.reduce((s, t) => s + t.profit, 0);

    const fins = await ServiceFinance.find({ date: { $gte: start, $lte: end }, ...cabangQ });
    const totalExpense = fins.filter(f => f.type === 'pengeluaran').reduce((s, f) => s + f.amount, 0);
    const labaBersih   = labaKotor - totalExpense;

    const BULAN = ['','Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

    res.json({
      success: true,
      data: {
        bulan, tahun, label: `${BULAN[bulan]} ${tahun}`,
        jumlahTx: txs.length, jumlahPaid: paidTxs.length,
        omsetMurni, labaKotor, totalExpense, labaBersih,
        statusCount: {
          antrian: txs.filter(t => t.status === 'antrian').length,
          proses:  txs.filter(t => t.status === 'proses').length,
          selesai: txs.filter(t => t.status === 'selesai').length,
          diambil: txs.filter(t => t.status === 'diambil').length,
          batal:   txs.filter(t => t.status === 'batal').length,
        }
      }
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// POST /api/service/closing — eksekusi closing bulan ini
exports.doClosing = async (req, res) => {
  try {
    const cabangQ  = req.cabangFilter || {};
    const cabangId = req.user.cabang?._id || req.user.cabang || null;
    const now      = new Date();
    // Support pilih bulan/tahun manual via body
    const bulan    = parseInt(req.body.bulan)  || now.getMonth() + 1;
    const tahun    = parseInt(req.body.tahun)  || now.getFullYear();
    const start    = new Date(tahun, bulan - 1, 1, 0, 0, 0, 0);
    const end      = new Date(tahun, bulan, 0, 23, 59, 59, 999);

    // Cek duplikat closing
    const existing = await ServiceClosing.findOne({ bulan, tahun, ...cabangQ });
    if (existing) return res.status(400).json({ success: false, message: 'Bulan ini sudah pernah di-closing' });

    const txs     = await ServiceTransaction.find({ isVoid: { $ne: true }, receivedAt: { $gte: start, $lte: end }, ...cabangQ });
    const paidTxs = txs.filter(t => t.isPaid);
    const fins    = await ServiceFinance.find({ date: { $gte: start, $lte: end }, ...cabangQ });

    const omsetMurni   = paidTxs.reduce((s, t) => s + t.totalCost, 0);
    const labaKotor    = paidTxs.reduce((s, t) => s + t.profit, 0);
    const totalExpense = fins.filter(f => f.type === 'pengeluaran').reduce((s, f) => s + f.amount, 0);
    const labaBersih   = labaKotor - totalExpense;

    const BULAN = ['','Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

    // Simpan arsip closing
    const closing = new ServiceClosing({
      bulan, tahun, label: `${BULAN[bulan]} ${tahun}`,
      jumlahTx: txs.length, omsetMurni, labaKotor, totalExpense, labaBersih,
      transactionIds: txs.map(t => t._id),
      closedBy: req.user._id,
      cabang: cabangId,
    });
    await closing.save();

    // Tandai transaksi sebagai archived
    await ServiceTransaction.updateMany(
      { _id: { $in: txs.map(t => t._id) } },
      { $set: { isArchived: true } }
    );

    // Tandai keuangan service bulan ini sebagai archived
    await ServiceFinance.updateMany(
      { date: { $gte: start, $lte: end }, ...cabangQ },
      { $set: { isArchived: true } }
    );

    res.json({ success: true, message: `Closing ${BULAN[bulan]} ${tahun} berhasil`, data: closing });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// GET /api/service/closing — list histori closing
exports.getClosingList = async (req, res) => {
  try {
    const cabangQ = req.cabangFilter || {};
    const list = await ServiceClosing.find(cabangQ)
      .sort({ tahun: -1, bulan: -1 })
      .populate('closedBy', 'name')
      .select('-transactionIds');
    res.json({ success: true, data: list });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// GET /api/service/closing/:id — detail arsip transaksi bulan tertentu
exports.getClosingDetail = async (req, res) => {
  try {
    const closing = await ServiceClosing.findById(req.params.id).populate('closedBy', 'name');
    if (!closing) return res.status(404).json({ success: false, message: 'Tidak ditemukan' });
    const txs = await ServiceTransaction.find({ _id: { $in: closing.transactionIds } })
      .populate('createdBy', 'name').sort({ receivedAt: -1 });
    res.json({ success: true, data: { closing, transactions: txs } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══════════════════════════════════════════════════════════════════════════
// ARSIP SERVICE — otomatis per bulan
// ══════════════════════════════════════════════════════════════════════════

// GET /api/service/arsip — list bulan yang ada arsipnya
exports.getArsipList = async (req, res) => {
  try {
    const cabangQ = req.cabangFilter || {};
    const now     = new Date();
    const bulanIni = new Date(now.getFullYear(), now.getMonth(), 1);

    // Aggregate transaksi per bulan (selain bulan berjalan)
    const result = await ServiceTransaction.aggregate([
      { $match: { isVoid: { $ne: true }, receivedAt: { $lt: bulanIni }, ...cabangQ } },
      { $group: {
        _id: { tahun: { $year: '$receivedAt' }, bulan: { $month: '$receivedAt' } },
        jumlahTx: { $sum: 1 },
        omset: { $sum: { $cond: ['$isPaid', '$totalCost', 0] } },
        laba:  { $sum: { $cond: ['$isPaid', '$profit',   0] } },
      }},
      { $sort: { '_id.tahun': -1, '_id.bulan': -1 } }
    ]);

    const BULAN = ['','Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    const data  = result.map(r => ({
      bulan: r._id.bulan, tahun: r._id.tahun,
      label: `${BULAN[r._id.bulan]} ${r._id.tahun}`,
      jumlahTx: r.jumlahTx, omset: r.omset, laba: r.laba
    }));

    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// GET /api/service/arsip/:bulan/:tahun — detail transaksi bulan tertentu
exports.getArsipDetail = async (req, res) => {
  try {
    const cabangQ = req.cabangFilter || {};
    const bulan   = parseInt(req.params.bulan);
    const tahun   = parseInt(req.params.tahun);
    const start   = new Date(tahun, bulan - 1, 1, 0, 0, 0, 0);
    const end     = new Date(tahun, bulan, 0, 23, 59, 59, 999);

    const txs = await ServiceTransaction.find({
      isVoid: { $ne: true },
      receivedAt: { $gte: start, $lte: end },
      ...cabangQ
    }).sort({ receivedAt: -1 }).populate('createdBy', 'name');

    const paidTxs  = txs.filter(t => t.isPaid);
    const omset    = paidTxs.reduce((s, t) => s + t.totalCost, 0);
    const laba     = paidTxs.reduce((s, t) => s + t.profit, 0);

    const fins = await ServiceFinance.find({ date: { $gte: start, $lte: end }, ...cabangQ });
    const totalExpense = fins.filter(f => f.type === 'pengeluaran').reduce((s, f) => s + f.amount, 0);

    const BULAN = ['','Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

    res.json({ success: true, data: {
      label: `${BULAN[bulan]} ${tahun}`,
      bulan, tahun, jumlahTx: txs.length, omset, laba, totalExpense,
      labaBersih: laba - totalExpense,
      transactions: txs
    }});
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
