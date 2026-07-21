const mongoose    = require('mongoose');
const Transaction = require('../models/Transaction');
const Product     = require('../models/Product');
const { Customer, Finance, Settings, StockLog } = require('../models/index');

// GET chart data dengan pilihan range 7 hari atau 30 hari
exports.getChartData = async (req, res) => {
  try {
    const cabangQ = req.cabangFilter || {};
    const range = parseInt(req.query.range) || 7; // 7 atau 30
    const days = range === 30 ? 30 : 7;
    const chartData = [];

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
      const de = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
      const dayTx = await Transaction.find({ transactionDate: { $gte: ds, $lte: de }, type: 'penjualan', isVoid: { $ne: true }, ...cabangQ });
      const label = days === 30
        ? String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0')
        : String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0');
      chartData.push({
        date: label,
        revenue: dayTx.reduce((s,t) => s + t.total, 0),
        profit:  dayTx.reduce((s,t) => s + t.totalProfit, 0),
        count:   dayTx.length
      });
    }

    res.json({ success: true, data: chartData });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getDashboard = async (req, res) => {
  try {
    const cabangQ = req.cabangFilter || {};
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [todayTx, monthTx, totalProducts, lowStock, financeToday] = await Promise.all([
      Transaction.find({ transactionDate: { $gte: todayStart, $lte: todayEnd }, type: 'penjualan', isVoid: { $ne: true }, ...cabangQ }),
      Transaction.find({ transactionDate: { $gte: monthStart }, type: 'penjualan', isVoid: { $ne: true }, ...cabangQ }),
      Product.countDocuments({ isActive: true, ...cabangQ }),
      Product.find({ type: 'fisik', isActive: true, ...cabangQ, $expr: { $lte: ['$stock', { $ifNull: ['$minStock', 5] }] } }).select('code name stock minStock'),
      Finance.find({ date: { $gte: todayStart, $lte: todayEnd }, ...cabangQ }),
    ]);

    // ── Top 7 produk terlaris bulan ini per kategori (fisik & digital/jasa) ─
    const buildTopProducts = (typeFilter) => Transaction.aggregate([
      { $match: { transactionDate: { $gte: monthStart }, type: 'penjualan', isVoid: { $ne: true }, ...cabangQ } },
      { $unwind: '$items' },
      { $match: typeFilter },
      { $group: {
        _id:         '$items.productCode',
        productName: { $first: '$items.productName' },
        totalQty:    { $sum: '$items.quantity' },
        totalOmset:  { $sum: '$items.subtotal' },
        // FIXED: pakai items.profit yang sudah dihitung benar saat transaksi
        // Sebelumnya: (sellPrice - purchasePrice) × qty → salah untuk tarik_tunai
        totalLaba:   { $sum: { $ifNull: ['$items.profit', 0] } },
        type:        { $first: '$items.type' },
        category:    { $first: '$items.category' },
      }},
      { $sort: { totalQty: -1 } },
      { $limit: 7 }
    ]);
    const [topFisik, topDigital] = await Promise.all([
      buildTopProducts({ 'items.type': 'fisik' }),
      buildTopProducts({ 'items.type': { $in: ['digital', 'jasa'] } }),
    ]);
    const topProductsToday = [...topFisik, ...topDigital];
    const employeeStats = await Transaction.aggregate([
      { $match: { transactionDate: { $gte: monthStart }, type: 'penjualan', isVoid: { $ne: true }, ...cabangQ } },
      { $group: {
        _id: '$cashierName',
        totalTx:     { $sum: 1 },
        totalOmset:  { $sum: '$total' },
        totalLaba:   { $sum: '$totalProfit' },
        totalItems:  { $sum: { $size: { $ifNull: ['$items', []] } } },
      }},
      { $sort: { totalOmset: -1 } }
    ]);

    // Statistik per karyawan hari ini
    const employeeToday = await Transaction.aggregate([
      { $match: { transactionDate: { $gte: todayStart, $lte: todayEnd }, type: 'penjualan', isVoid: { $ne: true }, ...cabangQ } },
      { $group: {
        _id: '$cashierName',
        totalTx:    { $sum: 1 },
        totalOmset: { $sum: '$total' },
        totalLaba:  { $sum: '$totalProfit' },
      }},
      { $sort: { totalOmset: -1 } }
    ]);

    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
      const de = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
      const dayTx = await Transaction.find({ transactionDate: { $gte: ds, $lte: de }, type: 'penjualan', isVoid: { $ne: true }, ...cabangQ });
      last7Days.push({
        date: String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0'),
        revenue: dayTx.reduce((s,t) => s + t.total, 0),
        profit: dayTx.reduce((s,t) => s + t.totalProfit, 0),
        count: dayTx.length
      });
    }

    res.json({ success: true, data: {
      today: {
        revenue:      todayTx.reduce((s,t) => s + t.total, 0),
        profit:       todayTx.reduce((s,t) => s + t.totalProfit, 0),
        // FIXED: Pembelian Stok tidak masuk kalkulasi pengeluaran operasional
        expense:      financeToday.filter(f => f.type === 'pengeluaran' && f.category !== 'Pembelian Stok').reduce((s,f) => s + f.amount, 0),
        transactions: todayTx.length,
        items:        todayTx.reduce((s,t) => s + (t.items?.length || 0), 0)
      },
      month: {
        revenue:      monthTx.reduce((s,t) => s + t.total, 0),
        profit:       monthTx.reduce((s,t) => s + t.totalProfit, 0),
        transactions: monthTx.length
      },
      products:         { total: totalProducts, lowStock: lowStock.length },
      lowStockProducts: lowStock.slice(0, 5),
      chartData:        last7Days,
      employeeStats,
      employeeToday,
      topProductsToday,
    }});
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET ringkasan keuangan semua cabang (superadmin only)
exports.getFinanceAllCabang = async (req, res) => {
  try {
    const Cabang = require('../models/Cabang');
    const Saldo  = require('../models/Saldo');
    const cabangs = await Cabang.find({ isActive: true });

    const now       = new Date();
    const bulanIni  = new Date(now.getFullYear(), now.getMonth(), 1);
    const bulanLalu = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const bulanLaluEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const result = await Promise.all(cabangs.map(async c => {
      const cabangQ = { cabang: c._id };

      const [txBulan, financeBulan, saldos, hutangAktif, piutangAktif] = await Promise.all([
        Transaction.aggregate([
          { $match: { ...cabangQ, type: 'penjualan', isVoid: { $ne: true }, transactionDate: { $gte: bulanIni } } },
          { $group: { _id: null, omset: { $sum: '$total' }, laba: { $sum: '$totalProfit' } } }
        ]),
        Finance.aggregate([
          { $match: { ...cabangQ, date: { $gte: bulanIni } } },
          { $group: { _id: '$type', total: { $sum: '$amount' } } }
        ]),
        Saldo.find({ ...cabangQ, isActive: true }).select('akunId saldo namaAkun group'),
        Finance.aggregate([{ $match: { ...cabangQ, type: 'hutang',   isPaid: false } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
        Finance.aggregate([{ $match: { ...cabangQ, type: 'piutang',  isPaid: false } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      ]);

      const finMap = {};
      financeBulan.forEach(f => { finMap[f._id] = f.total; });

      const kasTunai    = saldos.find(s => s.akunId === 'tunai')?.saldo || 0;
      const brankas     = saldos.find(s => s.akunId === 'brankas')?.saldo || 0;
      const saldoDigital= saldos.filter(s => s.akunId !== 'tunai' && s.akunId !== 'brankas').reduce((t,s) => t + s.saldo, 0);

      return {
        _id: c._id, nama: c.nama, kode: c.kode,
        bulanIni: {
          omset:       txBulan[0]?.omset  || 0,
          laba:        txBulan[0]?.laba   || 0,
          pemasukan:   finMap.pemasukan   || 0,
          pengeluaran: finMap.pengeluaran || 0,
        },
        hutangAktif:   hutangAktif[0]?.total  || 0,
        piutangAktif:  piutangAktif[0]?.total || 0,
        kasTunai, brankas, saldoDigital,
        totalAset: kasTunai + brankas + saldoDigital,
        saldos: saldos.filter(s => s.akunId !== 'tunai' && s.akunId !== 'brankas'),
      };
    }));

    res.json({ success: true, data: result });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getFinance = async (req, res) => {
  try {
    const { type, startDate, endDate, page=1, limit=20 } = req.query;
    const cabangQ = req.cabangFilter || {};
    let query = { ...cabangQ };
    if (type) query.type = type;
    if (startDate || endDate) { query.date = {}; if (startDate) query.date.$gte = new Date(startDate); if (endDate) { const e=new Date(endDate); e.setHours(23,59,59); query.date.$lte=e; } }
    const skip = (page-1)*limit;
    const [records, total] = await Promise.all([Finance.find(query).sort({ date: -1, createdAt: -1 }).skip(skip).limit(Number(limit)), Finance.countDocuments(query)]);
    res.json({ success: true, data: records, total, pages: Math.ceil(total/limit) });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.createFinance = async (req, res) => {
  try {
    const cabangId = req.user.role === 'superadmin' ? null : (req.user.cabang?._id || req.user.cabang || null);
    const record = await Finance.create({ ...req.body, createdBy: req.user._id, cabang: cabangId });

    // Update saldo akun sumber dana
    try {
      const Saldo = require('../models/Saldo');
      const cabangQ = req.cabangFilter || {};
      if (req.body.type === 'pemasukan' || req.body.type === 'pengeluaran') {
        const isIncome = req.body.type === 'pemasukan';
        const amount   = parseFloat(req.body.amount) || 0;
        const sumberDana = req.body.sumberDana || '';

        // Cari akun: kalau ada sumberDana pakai itu, kalau tidak pakai kas tunai
        const proj = { _id: 1, saldo: 1 };
        const akun = sumberDana
          ? await Saldo.findOne({ akunId: sumberDana, ...cabangQ }, proj)
          : await Saldo.findOne({ akunId: { $regex: '^tunai' }, ...cabangQ }, proj);

        if (akun) {
          const saldoBefore = akun.saldo;
          const newSaldo = saldoBefore + (isIncome ? amount : -amount);
          await Saldo.updateOne(
            { _id: akun._id },
            {
              $set: { saldo: newSaldo },
              $push: {
                mutasi: {
                  type: isIncome ? 'masuk' : 'keluar',
                  amount,
                  keterangan: `${isIncome ? 'Pemasukan' : 'Pengeluaran'}: ${req.body.description || req.body.category || '-'}`,
                  saldoBefore,
                  saldoAfter: newSaldo,
                  createdBy: req.user._id
                }
              }
            }
          );
        }
      }
    } catch (e) { /* skip jika saldo gagal update */ }

    res.status(201).json({ success: true, data: record });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.updateFinance = async (req, res) => {
  const Saldo = require('../models/Saldo');
  const cabangQ = req.cabangFilter || {};
  const newData = req.body;

  const isFinanceType   = (t) => t === 'pemasukan' || t === 'pengeluaran';
  const isHutangPiutang = (t) => t === 'hutang' || t === 'piutang';

  const session = await mongoose.startSession();
  let responseRecord;
  try {
    await session.withTransaction(async () => {
      const oldRecord = await Finance.findById(req.params.id).session(session);
      if (!oldRecord) throw { status: 404, message: 'Data tidak ditemukan' };

      const oldType    = oldRecord.type;
      const newType    = newData.type || oldType;
      const oldAmount  = parseFloat(oldRecord.amount) || 0;
      const newAmount  = parseFloat(newData.amount) || oldAmount;
      const oldSumber  = oldRecord.sumberDana || '';
      const newSumber  = newData.sumberDana !== undefined ? newData.sumberDana : oldSumber;
      const oldIsPaid  = oldRecord.isPaid === true;
      const newIsPaid  = newData.isPaid !== undefined ? (newData.isPaid === true) : oldIsPaid;

      // ── (1) Koreksi saldo untuk pemasukan/pengeluaran ─────────────
      const proj = { _id: 1, saldo: 1 };
      if (isFinanceType(oldType) || isFinanceType(newType)) {
        // Kembalikan efek saldo LAMA
        if (isFinanceType(oldType) && oldAmount > 0) {
          const akunLama = oldSumber
            ? await Saldo.findOne({ akunId: oldSumber, ...cabangQ }, proj).session(session)
            : await Saldo.findOne({ akunId: { $regex: '^tunai' }, ...cabangQ }, proj).session(session);
          if (akunLama) {
            const sb = akunLama.saldo;
            const newSaldo = sb + (oldType === 'pemasukan' ? -oldAmount : oldAmount);
            await Saldo.updateOne(
              { _id: akunLama._id },
              {
                $set: { saldo: newSaldo },
                $push: {
                  mutasi: {
                    type: oldType === 'pemasukan' ? 'keluar' : 'masuk',
                    amount: oldAmount,
                    keterangan: `Edit Keuangan - Koreksi ${oldType} lama: ${oldRecord.description || oldRecord.category || '-'}`,
                    saldoBefore: sb, saldoAfter: newSaldo, createdBy: req.user?._id
                  }
                }
              },
              { session }
            );
          }
        }
        // Terapkan efek saldo BARU
        if (isFinanceType(newType) && newAmount > 0) {
          const akunBaru = newSumber
            ? await Saldo.findOne({ akunId: newSumber, ...cabangQ }, proj).session(session)
            : await Saldo.findOne({ akunId: { $regex: '^tunai' }, ...cabangQ }, proj).session(session);
          if (akunBaru) {
            const sb = akunBaru.saldo;
            const newSaldo = sb + (newType === 'pemasukan' ? newAmount : -newAmount);
            await Saldo.updateOne(
              { _id: akunBaru._id },
              {
                $set: { saldo: newSaldo },
                $push: {
                  mutasi: {
                    type: newType === 'pemasukan' ? 'masuk' : 'keluar',
                    amount: newAmount,
                    keterangan: `Edit Keuangan - ${newType === 'pemasukan' ? 'Pemasukan' : 'Pengeluaran'} baru: ${newData.description || newData.category || '-'}`,
                    saldoBefore: sb, saldoAfter: newSaldo, createdBy: req.user?._id
                  }
                }
              },
              { session }
            );
          }
        }
      }

      // ── (2) Hutang/piutang: transisi isPaid false → true ─────────
      // Batasi ke skenario umum: type tidak berubah, dan hanya arah lunas.
      // Skenario true → false (batal lunas) belum di-handle di rilis ini.
      if (isHutangPiutang(oldType) && oldType === newType && !oldIsPaid && newIsPaid) {
        const metode = newData.metode || 'cash'; // cash | transfer | qris
        const akunId = newData.akunId || newData.sumberDana || '';

        if (!['cash', 'transfer', 'qris'].includes(metode)) {
          throw { status: 400, message: 'Metode pembayaran tidak valid' };
        }
        if ((metode === 'transfer' || metode === 'qris') && !akunId) {
          throw { status: 400, message: 'Akun tujuan wajib dipilih untuk pembayaran transfer/QRIS' };
        }

        // Projection: _id, saldo, akunId, namaAkun (namaAkun & akunId dipakai di bawah untuk record.sumberDana).
        const proj2 = { _id: 1, saldo: 1, akunId: 1, namaAkun: 1 };
        const akun = metode === 'cash'
          ? await Saldo.findOne({ akunId: { $regex: '^tunai' }, ...cabangQ }, proj2).session(session)
          : await Saldo.findOne({ akunId, ...cabangQ }, proj2).session(session);
        if (!akun) {
          throw { status: 400, message: metode === 'cash' ? 'Akun Kas Tunai tidak ditemukan' : 'Akun tujuan tidak ditemukan' };
        }

        // piutang lunas → uang MASUK ke akun kita
        // hutang lunas  → uang KELUAR dari akun kita
        const isPiutang = oldType === 'piutang';
        const label = metode === 'cash' ? 'Tunai' : metode === 'qris' ? 'QRIS' : 'Transfer';
        const sb = akun.saldo;
        const newSaldo = sb + (isPiutang ? newAmount : -newAmount);
        await Saldo.updateOne(
          { _id: akun._id },
          {
            $set: { saldo: newSaldo },
            $push: {
              mutasi: {
                type: isPiutang ? 'masuk' : 'keluar',
                amount: newAmount,
                keterangan: `Lunasi ${oldType} (${label}): ${newData.description || oldRecord.description || oldRecord.category || '-'}`,
                saldoBefore: sb, saldoAfter: newSaldo, createdBy: req.user?._id
              }
            }
          },
          { session }
        );

        // Simpan info akun ke record supaya delete bisa rollback akurat
        newData.sumberDana     = akun.akunId;
        newData.sumberDanaName = akun.namaAkun;
        newData.paidDate       = new Date();
      }

      // ── (3) Hutang/piutang sudah lunas: koreksi selisih amount ───
      // Skenario: nominal record dikoreksi (typo), saldo di akun tujuan
      // harus mengikuti selisih (newAmount - oldAmount) supaya konsisten.
      // Akun tujuan = sumberDana yang tersimpan waktu lunas (fallback tunai).
      if (isHutangPiutang(oldType) && oldType === newType && oldIsPaid && newIsPaid && newAmount !== oldAmount) {
        const diff = newAmount - oldAmount;
        const akun = oldSumber
          ? await Saldo.findOne({ akunId: oldSumber, ...cabangQ }, proj).session(session)
          : await Saldo.findOne({ akunId: { $regex: '^tunai' }, ...cabangQ }, proj).session(session);
        if (akun) {
          // piutang: nominal naik → saldo naik (delta = +diff)
          // hutang:  nominal naik → saldo turun (delta = -diff)
          const isPiutang = oldType === 'piutang';
          const delta = isPiutang ? diff : -diff;
          const sb = akun.saldo;
          const newSaldo = sb + delta;
          await Saldo.updateOne(
            { _id: akun._id },
            {
              $set: { saldo: newSaldo },
              $push: {
                mutasi: {
                  type: delta > 0 ? 'masuk' : 'keluar',
                  amount: Math.abs(diff),
                  keterangan: `Koreksi nominal ${oldType} (${oldAmount} → ${newAmount}): ${newData.description || oldRecord.description || oldRecord.category || '-'}`,
                  saldoBefore: sb, saldoAfter: newSaldo, createdBy: req.user?._id
                }
              }
            },
            { session }
          );
        }
      }

      // Update record finance (buang field non-schema supaya tidak diserialisasi masuk)
      const { metode: _m, akunId: _a, ...persistData } = newData;
      responseRecord = await Finance.findByIdAndUpdate(req.params.id, persistData, { new: true, session });
    });

    const io = req.app.get('io');
    io?.emit('saldoUpdated');
    res.json({ success: true, data: responseRecord });
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ success: false, message: err.message });
    res.status(500).json({ success: false, message: err.message });
  } finally {
    await session.endSession();
  }
};

exports.deleteFinance = async (req, res) => {
  const Saldo = require('../models/Saldo');
  const cabangQ = req.cabangFilter || {};

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const record = await Finance.findById(req.params.id).session(session);
      if (!record) throw { status: 404, message: 'Data tidak ditemukan' };

      const amount = parseFloat(record.amount) || 0;
      const sumberDana = record.sumberDana || '';
      // Projection minimal — hanya butuh _id + saldo untuk update; hindari load mutasi.
      const proj = { _id: 1, saldo: 1 };
      const akun = amount > 0
        ? (sumberDana
            ? await Saldo.findOne({ akunId: sumberDana, ...cabangQ }, proj).session(session)
            : await Saldo.findOne({ akunId: { $regex: '^tunai' }, ...cabangQ }, proj).session(session))
        : null;

      // (1) Rollback pemasukan/pengeluaran (perilaku existing)
      if ((record.type === 'pemasukan' || record.type === 'pengeluaran') && amount > 0 && akun) {
        const isIncome = record.type === 'pemasukan';
        const saldoBefore = akun.saldo;
        const newSaldo = saldoBefore + (isIncome ? -amount : amount);
        await Saldo.updateOne(
          { _id: akun._id },
          {
            $set: { saldo: newSaldo },
            $push: {
              mutasi: {
                type: isIncome ? 'keluar' : 'masuk',
                amount,
                keterangan: `Hapus ${isIncome ? 'Pemasukan' : 'Pengeluaran'}: ${record.description || record.category || '-'}`,
                saldoBefore, saldoAfter: newSaldo, createdBy: req.user?._id
              }
            }
          },
          { session }
        );
      }

      // (2) Rollback hutang/piutang yang sudah lunas
      // piutang lunas sebelumnya menambah saldo → sekarang kurangi
      // hutang  lunas sebelumnya mengurangi saldo → sekarang tambah kembali
      // (blok (1) & (2) mutually exclusive per record.type — snapshot saldo aman)
      if ((record.type === 'hutang' || record.type === 'piutang') && record.isPaid === true && amount > 0 && akun) {
        const isPiutang = record.type === 'piutang';
        const saldoBefore = akun.saldo;
        const newSaldo = saldoBefore + (isPiutang ? -amount : amount);
        await Saldo.updateOne(
          { _id: akun._id },
          {
            $set: { saldo: newSaldo },
            $push: {
              mutasi: {
                type: isPiutang ? 'keluar' : 'masuk',
                amount,
                keterangan: `Hapus ${record.type} lunas: ${record.description || record.category || '-'}`,
                saldoBefore, saldoAfter: newSaldo, createdBy: req.user?._id
              }
            }
          },
          { session }
        );
      }

      await Finance.findByIdAndDelete(req.params.id, { session });
    });

    const io = req.app.get('io');
    io?.emit('saldoUpdated');
    res.json({ success: true, message: 'Dihapus' });
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ success: false, message: err.message });
    res.status(500).json({ success: false, message: err.message });
  } finally {
    await session.endSession();
  }
};

exports.getFinanceSummary = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const cabangQ = req.cabangFilter || {};
    let dq = {};
    if (startDate) dq.$gte = new Date(startDate);
    if (endDate) { const e=new Date(endDate); e.setHours(23,59,59); dq.$lte=e; }
    const txQuery = { type: 'penjualan', isVoid: { $ne: true }, ...cabangQ };
    if (Object.keys(dq).length) txQuery.transactionDate = dq;
    const fQuery = { ...cabangQ, ...(Object.keys(dq).length ? { date: dq } : {}) };
    const [transactions, expenses, incomes, debts, receivables] = await Promise.all([
      Transaction.find(txQuery),
      Finance.aggregate([{ $match: { ...fQuery, type: 'pengeluaran' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Finance.aggregate([{ $match: { ...fQuery, type: 'pemasukan' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Finance.aggregate([{ $match: { ...cabangQ, type: 'hutang', isPaid: false } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Finance.aggregate([{ $match: { ...cabangQ, type: 'piutang', isPaid: false } }, { $group: { _id: null, total: { $sum: '$amount' } } }])
    ]);
    res.json({ success: true, data: {
      salesRevenue: transactions.reduce((s,t)=>s+t.total,0),
      salesProfit: transactions.reduce((s,t)=>s+t.totalProfit,0),
      totalExpense: expenses[0]?.total||0,
      totalIncome: incomes[0]?.total||0,
      netProfit: transactions.reduce((s,t)=>s+t.totalProfit,0),
      totalDebt: debts[0]?.total||0,
      totalReceivable: receivables[0]?.total||0
    }});
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getCustomers = async (req, res) => {
  try {
    const { search } = req.query;
    const cabangQ = req.cabangFilter || {};
    let query = { ...cabangQ };
    if (search) query.$or = [{ name: { $regex: search, $options: 'i' } }, { phone: { $regex: search, $options: 'i' } }];
    const customers = await Customer.find(query).sort('name');
    res.json({ success: true, data: customers });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.createCustomer = async (req, res) => {
  try {
    const cabangId = req.user.role === 'superadmin' ? null : (req.user.cabang?._id || req.user.cabang || null);

    // Validasi duplikat nomor HP untuk member baru
    if (req.body.isMember && req.body.phone) {
      const existing = await Customer.findOne({ phone: req.body.phone, isMember: true });
      if (existing) return res.status(400).json({ success: false, message: `Nomor HP ini sudah terdaftar sebagai member atas nama ${existing.name}` });
    }

    const customer = await Customer.create({ ...req.body, cabang: cabangId });
    res.status(201).json({ success: true, data: customer });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.updateCustomer = async (req, res) => {
  try {
    const customer = await Customer.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, data: customer });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.deleteCustomer = async (req, res) => {
  try { await Customer.findByIdAndDelete(req.params.id); res.json({ success: true, message: 'Dihapus' }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getCustomerTransactions = async (req, res) => {
  try { const transactions = await Transaction.find({ customer: req.params.id }).sort('-transactionDate'); res.json({ success: true, data: transactions }); }
  catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getSettings = async (req, res) => {
  try {
    const cabangFilter = req.cabangFilter || {};
    let s = await Settings.findOne(cabangFilter);
    if (!s && cabangFilter.cabang) s = await Settings.findOne({ cabang: { $exists: false } });
    if (!s) s = await Settings.create({ ...cabangFilter });
    res.json({ success: true, data: s });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.updateSettings = async (req, res) => {
  try {
    const cabangFilter = req.cabangFilter || {};
    let s = await Settings.findOne(cabangFilter);
    if (!s && cabangFilter.cabang) s = await Settings.findOne({ cabang: { $exists: false } });
    if (!s) s = new Settings({ ...cabangFilter });
    if (cabangFilter.cabang && !s.cabang) s.cabang = cabangFilter.cabang;
    Object.assign(s, req.body);
    await s.save();
    res.json({ success: true, data: s });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};


// Kategori pengeluaran yang TIDAK dikurangi dari laba bersih
// karena sudah tercermin di modal produk (mencegah double counting)
const EXCLUDE_FROM_LABA    = ['Pembelian Stok'];
// Kategori pemasukan yang dihitung sebagai laba bersih (cashback, bunga, fee)
const CASHBACK_CATEGORIES  = ['Cashback / Fee'];
const pengeluaranOperasional = (finRows, bulan) => {
  const all = finRows.filter(f => f._id.bulan === bulan && f._id.type === 'pengeluaran');
  return all.reduce((t, f) => {
    if (EXCLUDE_FROM_LABA.includes(f._id.category)) return t;
    return t + (f.total || 0);
  }, 0);
};
const pengeluaranTotal = (finRows, bulan) => {
  return finRows.find(f => f._id.bulan === bulan && f._id.type === 'pengeluaran')?.total || 0;
};
exports.getSalesReport = async (req, res) => {
  try {
    const { startDate, endDate, groupBy='day' } = req.query;
    const cabangQ = req.cabangFilter || {};
    let match = { type: 'penjualan', isVoid: { $ne: true }, ...cabangQ };
    if (startDate||endDate) { match.transactionDate={}; if(startDate) match.transactionDate.$gte=new Date(startDate); if(endDate){const e=new Date(endDate);e.setHours(23,59,59);match.transactionDate.$lte=e;} }
    const fmt = groupBy==='month' ? { $dateToString:{format:'%Y-%m',date:'$transactionDate'} } : { $dateToString:{format:'%Y-%m-%d',date:'$transactionDate'} };
    const [report, topProducts] = await Promise.all([
      Transaction.aggregate([{ $match: match },{ $group:{_id:fmt,totalRevenue:{$sum:'$total'},totalProfit:{$sum:'$totalProfit'},count:{$sum:1}}},{$sort:{_id:1}}]),
      Transaction.aggregate([{ $match: match },{$unwind:'$items'},{$group:{_id:'$items.productName',totalQty:{$sum:'$items.quantity'},totalRevenue:{$sum:'$items.subtotal'}}},{$sort:{totalRevenue:-1}},{$limit:10}])
    ]);
    res.json({ success: true, data: { report, topProducts } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── Laporan Bulanan (Rekap Laba Rugi per Bulan dalam 1 Tahun) ───────────
exports.getMonthlyReport = async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const yearStart = new Date(year, 0, 1, 0, 0, 0, 0);
    const yearEnd   = new Date(year, 11, 31, 23, 59, 59, 999);

    const cabangQ = req.cabangFilter || {};
    const txMatch = { type: 'penjualan', isVoid: { $ne: true }, transactionDate: { $gte: yearStart, $lte: yearEnd }, ...cabangQ };
    const fMatch  = { date: { $gte: yearStart, $lte: yearEnd }, ...cabangQ };

    // Aggregate transaksi per bulan
    const txPerMonth = await Transaction.aggregate([
      { $match: txMatch },
      {
        $group: {
          _id: { $month: '$transactionDate' },
          omset:        { $sum: '$total' },
          labaKotor:    { $sum: '$totalProfit' },
          jumlahTx:     { $sum: 1 },
          jumlahItem:   { $sum: { $size: { $ifNull: ['$items', []] } } },
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Aggregate finance (pemasukan & pengeluaran) per bulan — include category agar filter Pembelian Stok bekerja
    const finPerMonth = await Finance.aggregate([
      { $match: { ...fMatch, type: { $in: ['pemasukan', 'pengeluaran'] } } },
      {
        $group: {
          _id: { bulan: { $month: '$date' }, type: '$type', category: '$category' },
          total: { $sum: '$amount' }
        }
      }
    ]);

    // Susun data 12 bulan
    const BULAN = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
    const months = Array.from({ length: 12 }, (_, i) => {
      const tx   = txPerMonth.find(t => t._id === i + 1) || {};
      const fin  = finPerMonth.filter(f => f._id.bulan === i + 1);
      // Pemasukan: sum semua rows dengan type pemasukan (sekarang bisa ada multiple rows per kategori)
      const pemasukan       = fin.filter(f => f._id.type === 'pemasukan').reduce((t,f) => t + f.total, 0);
      // Pengeluaran total (untuk tampilan)
      const pengeluaran     = fin.filter(f => f._id.type === 'pengeluaran').reduce((t,f) => t + f.total, 0);
      // Pengeluaran yang mempengaruhi laba: EXCLUDE Pembelian Stok (sudah tercermin di modal produk)
      const pengeluaranLaba = fin.filter(f => f._id.type === 'pengeluaran' && !EXCLUDE_FROM_LABA.includes(f._id.category)).reduce((t,f) => t + f.total, 0);
      // Cashback/Fee dihitung sebagai tambahan laba bersih
      const cashbackFee1    = fin.filter(f => f._id.type === 'pemasukan' && CASHBACK_CATEGORIES.includes(f._id.category)).reduce((t,f) => t + f.total, 0);
      const labaKotor       = tx.labaKotor || 0;
      const labaBersih      = labaKotor - pengeluaranLaba + cashbackFee1;

      return {
        bulan:       i + 1,
        label:       BULAN[i],
        omset:       tx.omset      || 0,
        labaKotor,
        pemasukan,
        pengeluaran: pengeluaranLaba, // Pengeluaran Operasional (exclude Pembelian Stok)
        labaBersih,
        jumlahTx:    tx.jumlahTx   || 0,
        jumlahItem:  tx.jumlahItem || 0,
      };
    });

    // Ringkasan tahunan
    const ringkasan = months.reduce((acc, m) => ({
      omset:       acc.omset       + m.omset,
      labaKotor:   acc.labaKotor   + m.labaKotor,
      pemasukan:   acc.pemasukan   + m.pemasukan,
      pengeluaran: acc.pengeluaran + m.pengeluaran,
      labaBersih:  acc.labaBersih  + m.labaBersih,
      jumlahTx:    acc.jumlahTx    + m.jumlahTx,
      jumlahItem:  acc.jumlahItem  + m.jumlahItem,
    }), { omset: 0, labaKotor: 0, pemasukan: 0, pengeluaran: 0, labaBersih: 0, jumlahTx: 0, jumlahItem: 0 });

    res.json({ success: true, data: { year, months, ringkasan } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Detail Laporan 1 Bulan ───────────────────────────────────────────────
exports.getMonthlyDetail = async (req, res) => {
  try {
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;

    const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const end   = new Date(year, month,     0, 23, 59, 59, 999);

    const cabangQ = req.cabangFilter || {};
    const txMatch = { type: 'penjualan', isVoid: { $ne: true }, transactionDate: { $gte: start, $lte: end }, ...cabangQ };
    const fMatch  = { date: { $gte: start, $lte: end }, ...cabangQ };

    const [
      txHarian,
      byKategoriProduk,
      byPayment,
      topProduk,
      financeRecords,
    ] = await Promise.all([
      // Transaksi per hari
      Transaction.aggregate([
        { $match: txMatch },
        { $group: {
          _id: { $dayOfMonth: '$transactionDate' },
          omset:     { $sum: '$total' },
          laba:      { $sum: '$totalProfit' },
          jumlahTx:  { $sum: 1 },
        }},
        { $sort: { _id: 1 } }
      ]),

      // Breakdown per tipe produk (fisik/digital/jasa)
      Transaction.aggregate([
        { $match: txMatch },
        { $unwind: '$items' },
        { $group: {
          _id: '$items.type',
          omset: { $sum: '$items.subtotal' },
          laba:  { $sum: '$items.profit' },
          qty:   { $sum: '$items.quantity' },
        }},
        { $sort: { omset: -1 } }
      ]),

      // Breakdown per metode bayar
      Transaction.aggregate([
        { $match: txMatch },
        { $group: {
          _id: '$paymentMethod',
          total:    { $sum: '$total' },
          jumlahTx: { $sum: 1 },
        }},
        { $sort: { total: -1 } }
      ]),

      // Top 10 produk terlaris
      Transaction.aggregate([
        { $match: txMatch },
        { $unwind: '$items' },
        { $group: {
          _id:   '$items.productName',
          omset: { $sum: '$items.subtotal' },
          laba:  { $sum: '$items.profit' },
          qty:   { $sum: '$items.quantity' },
        }},
        { $sort: { omset: -1 } },
        { $limit: 10 }
      ]),

      // Catatan keuangan (pemasukan & pengeluaran) — include category untuk filter
      Finance.aggregate([
        { $match: { ...fMatch, type: { $in: ['pemasukan', 'pengeluaran'] } } },
        { $group: {
          _id: { type: '$type', category: '$category' },
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        }}
      ]),
    ]);

    // Hitung total dari semua tx
    const allTx = await Transaction.find(txMatch).select('total totalProfit');
    const omset       = allTx.reduce((s, t) => s + t.total, 0);
    const labaKotor   = allTx.reduce((s, t) => s + t.totalProfit, 0);
    const pemasukan       = financeRecords.filter(f => f._id.type === 'pemasukan').reduce((t,f) => t + f.total, 0);
    // pengeluaranOp = exclude Pembelian Stok (Pengeluaran Operasional)
    const pengeluaranOp   = financeRecords.filter(f => f._id.type === 'pengeluaran' && !EXCLUDE_FROM_LABA.includes(f._id.category)).reduce((t,f) => t + f.total, 0);
    // Cashback/Fee dihitung sebagai tambahan laba bersih
    const cashbackFee2    = financeRecords.filter(f => f._id.type === 'pemasukan' && CASHBACK_CATEGORIES.includes(f._id.category)).reduce((t,f) => t + f.total, 0);
    const labaBersih  = labaKotor - pengeluaranOp + cashbackFee2;
    const pengeluaran = pengeluaranOp; // alias untuk response (Pengeluaran Operasional)

    // Isi hari yang kosong (agar grafik lengkap)
    const daysInMonth = new Date(year, month, 0).getDate();
    const harian = Array.from({ length: daysInMonth }, (_, i) => {
      const d = txHarian.find(t => t._id === i + 1) || {};
      return { hari: i + 1, omset: d.omset || 0, laba: d.laba || 0, jumlahTx: d.jumlahTx || 0 };
    });

    res.json({
      success: true,
      data: {
        year, month,
        ringkasan: { omset, labaKotor, pemasukan, pengeluaran, labaBersih, jumlahTx: allTx.length },
        harian,
        byKategoriProduk,
        byPayment,
        topProduk,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Helper: ambil data bulanan (reuse logic dari getMonthlyReport) ────────
async function buildMonthlyData(year, cabangFilter = {}) {
  const yearStart = new Date(year, 0, 1, 0, 0, 0, 0);
  const yearEnd   = new Date(year, 11, 31, 23, 59, 59, 999);

  // FIXED: tambah cabangFilter agar data hanya dari cabang yang login
  const txMatch = { type: 'penjualan', isVoid: { $ne: true }, transactionDate: { $gte: yearStart, $lte: yearEnd }, ...cabangFilter };
  const fMatch  = { date: { $gte: yearStart, $lte: yearEnd }, ...cabangFilter };

  const [txPerMonth, finPerMonth, settings] = await Promise.all([
    Transaction.aggregate([
      { $match: txMatch },
      { $group: { _id: { $month: '$transactionDate' }, omset: { $sum: '$total' }, labaKotor: { $sum: '$totalProfit' }, jumlahTx: { $sum: 1 }, jumlahItem: { $sum: { $size: { $ifNull: ['$items', []] } } } } },
      { $sort: { _id: 1 } }
    ]),
    Finance.aggregate([
      { $match: { ...fMatch, ...cabangFilter, type: { $in: ['pemasukan', 'pengeluaran'] } } },
      { $group: { _id: { bulan: { $month: '$date' }, type: '$type', category: '$category' }, total: { $sum: '$amount' } } }
    ]),
    Settings.findOne(cabangFilter)
  ]);

  const NAMA_BULAN = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

  const months = Array.from({ length: 12 }, (_, i) => {
    const tx  = txPerMonth.find(t => t._id === i + 1) || {};
    const fin = finPerMonth.filter(f => f._id.bulan === i + 1);
    const pemasukan       = fin.filter(f => f._id.type === 'pemasukan').reduce((t,f) => t + f.total, 0);
    // pengeluaran = semua pengeluaran (untuk info) — TIDAK ditampilkan di laporan
    // pengeluaranOp = exclude Pembelian Stok — ini yang ditampilkan di laporan sebagai "Pengeluaran Operasional"
    const pengeluaranOp   = fin.filter(f => f._id.type === 'pengeluaran' && f._id.category !== 'Pembelian Stok').reduce((t,f) => t + f.total, 0);
    // Cashback/Fee dihitung sebagai tambahan laba bersih
    const cashbackFee3    = fin.filter(f => f._id.type === 'pemasukan' && f._id.category === 'Cashback / Fee').reduce((t,f) => t + f.total, 0);
    const labaKotor   = tx.labaKotor || 0;
    return {
      bulan: i + 1, nama: NAMA_BULAN[i],
      omset: tx.omset || 0, labaKotor, pemasukan,
      pengeluaran: pengeluaranOp, // Pengeluaran Operasional (exclude Pembelian Stok)
      labaBersih: labaKotor - pengeluaranOp + cashbackFee3,
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

  return { months, ringkasan, storeName: settings?.storeName || 'Konter Pulsa' };
}

// ─── Format rupiah untuk PDF/Excel ────────────────────────────────────────
function fmtRp(n) {
  return 'Rp ' + (n || 0).toLocaleString('id-ID');
}

// ─── Export Excel ──────────────────────────────────────────────────────────
exports.exportExcel = async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const { months, ringkasan, storeName } = await buildMonthlyData(year, req.cabangFilter || {});

    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator  = storeName;
    wb.created  = new Date();

    const ws = wb.addWorksheet(`Laporan ${year}`, {
      pageSetup: { paperSize: 9, orientation: 'landscape' }
    });

    // ── Judul ──
    ws.mergeCells('A1:H1');
    ws.getCell('A1').value = `LAPORAN LABA RUGI BULANAN — ${year}`;
    ws.getCell('A1').font  = { bold: true, size: 14 };
    ws.getCell('A1').alignment = { horizontal: 'center' };

    ws.mergeCells('A2:H2');
    ws.getCell('A2').value = storeName;
    ws.getCell('A2').font  = { size: 11, color: { argb: 'FF64748B' } };
    ws.getCell('A2').alignment = { horizontal: 'center' };

    ws.addRow([]);

    // ── Header kolom ──
    const headerRow = ws.addRow([
      'Bulan', 'Omset', 'Laba Kotor', 'Pemasukan Lain', 'Pengeluaran', 'Laba Bersih', 'Jml Transaksi', 'Jml Item', 'Margin %'
    ]);
    headerRow.eachCell(cell => {
      cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      cell.font   = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' }
      };
    });
    headerRow.height = 24;

    // ── Data per bulan ──
    months.forEach((m, idx) => {
      const margin = m.omset > 0 ? ((m.labaBersih / m.omset) * 100).toFixed(1) + '%' : '0%';
      const row = ws.addRow([
        m.nama, m.omset, m.labaKotor, m.pemasukan, m.pengeluaran, m.labaBersih, m.jumlahTx, m.jumlahItem, margin
      ]);

      const isEven = idx % 2 === 0;
      row.eachCell((cell, colNum) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };
        if (isEven) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };

        // Format angka jadi rupiah (kolom 2–6)
        if (colNum >= 2 && colNum <= 6) {
          cell.numFmt = '"Rp "#,##0';
          cell.alignment = { horizontal: 'right' };
        }
        // Kolom 7 (jml tx) & 8 (jml item) tengah
        if (colNum === 7 || colNum === 8) cell.alignment = { horizontal: 'center' };
        // Kolom 9 (margin) tengah
        if (colNum === 9) cell.alignment = { horizontal: 'center' };

        // Warna merah jika laba bersih negatif
        if (colNum === 6 && m.labaBersih < 0) {
          cell.font = { color: { argb: 'FFEF4444' }, bold: true };
        } else if (colNum === 6 && m.labaBersih > 0) {
          cell.font = { color: { argb: 'FF16A34A' }, bold: true };
        }
        // Baris bulan tanpa transaksi → abu
        if (m.jumlahTx === 0) {
          cell.font = { ...cell.font, color: { argb: 'FF94A3B8' } };
        }
      });
    });

    // ── Baris TOTAL ──
    const totalRow = ws.addRow([
      `TOTAL ${year}`,
      ringkasan.omset, ringkasan.labaKotor, ringkasan.pemasukan,
      ringkasan.pengeluaran, ringkasan.labaBersih, ringkasan.jumlahTx, ringkasan.jumlahItem,
      ringkasan.omset > 0 ? ((ringkasan.labaBersih / ringkasan.omset) * 100).toFixed(1) + '%' : '0%'
    ]);
    totalRow.eachCell((cell, colNum) => {
      cell.font = { bold: true, size: 11 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.border = { top: { style: 'medium' }, bottom: { style: 'medium' }, left: { style: 'thin' }, right: { style: 'thin' } };
      if (colNum >= 2 && colNum <= 6) { cell.numFmt = '"Rp "#,##0'; cell.alignment = { horizontal: 'right' }; }
      if (colNum === 7 || colNum === 8) cell.alignment = { horizontal: 'center' };
      if (colNum === 9) cell.alignment = { horizontal: 'center' };
    });
    totalRow.height = 22;

    // ── Lebar kolom ──
    ws.columns = [
      { width: 16 }, // Bulan
      { width: 18 }, // Omset
      { width: 18 }, // Laba Kotor
      { width: 18 }, // Pemasukan
      { width: 18 }, // Pengeluaran
      { width: 18 }, // Laba Bersih
      { width: 13 }, // Jml Tx
      { width: 13 }, // Jml Item
      { width: 12 }, // Margin
    ];

    // ── Kirim file ──
    const filename = `Laporan-LabaRugi-${year}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Export Excel error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Export PDF ────────────────────────────────────────────────────────────
exports.exportPDF = async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const { months, ringkasan, storeName } = await buildMonthlyData(year, req.cabangFilter || {});

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });

    const filename = `Laporan-LabaRugi-${year}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);

    // ── Warna & ukuran ──
    const C_DARK   = '#1e293b';
    const C_GRAY   = '#64748b';
    const C_GREEN  = '#16a34a';
    const C_RED    = '#dc2626';
    const C_BLUE   = '#2563eb';
    const C_STRIPE = '#f8fafc';
    const C_HEADER = '#1e293b';

    const PAGE_W  = doc.page.width;
    const MARGIN  = 40;
    const TBL_W   = PAGE_W - MARGIN * 2;

    // Proporsi kolom (total = 1)
    const COLS = [
      { label: 'Bulan',         w: 0.13, align: 'left'  },
      { label: 'Omset',         w: 0.14, align: 'right' },
      { label: 'Laba Kotor',    w: 0.13, align: 'right' },
      { label: 'Pemasukan',     w: 0.12, align: 'right' },
      { label: 'Pengeluaran',   w: 0.12, align: 'right' },
      { label: 'Laba Bersih',   w: 0.13, align: 'right' },
      { label: 'Jml Tx',        w: 0.08, align: 'center'},
      { label: 'Jml Item',      w: 0.08, align: 'center'},
      { label: 'Margin',        w: 0.07, align: 'center'},
    ];

    // Hitung posisi x setiap kolom
    let colX = [MARGIN];
    for (let i = 0; i < COLS.length - 1; i++) {
      colX.push(colX[i] + COLS[i].w * TBL_W);
    }

    // ── Header halaman ──
    doc.fontSize(16).font('Helvetica-Bold').fillColor(C_DARK)
       .text(`LAPORAN LABA RUGI BULANAN — ${year}`, MARGIN, MARGIN, { width: TBL_W, align: 'center' });
    doc.fontSize(10).font('Helvetica').fillColor(C_GRAY)
       .text(storeName, MARGIN, MARGIN + 22, { width: TBL_W, align: 'center' });
    doc.fontSize(9).fillColor(C_GRAY)
       .text(`Dicetak: ${new Date().toLocaleDateString('id-ID', { day:'2-digit', month:'long', year:'numeric' })}`, MARGIN, MARGIN + 38, { width: TBL_W, align: 'center' });

    let y = MARGIN + 62;
    const ROW_H = 22;
    const HDR_H = 24;

    // ── Fungsi gambar baris tabel ──
    const drawRow = (cells, rowY, isHeader = false, isTotal = false, isEven = false, labaBersih = 0) => {
      // Background
      if (isHeader || isTotal) {
        doc.rect(MARGIN, rowY, TBL_W, isHeader ? HDR_H : ROW_H).fill(C_HEADER);
      } else if (isEven) {
        doc.rect(MARGIN, rowY, TBL_W, ROW_H).fill(C_STRIPE);
      }

      cells.forEach((text, i) => {
        const col   = COLS[i];
        const cw    = col.w * TBL_W;
        const cx    = colX[i];
        const cy    = rowY + (isHeader ? HDR_H : ROW_H) / 2;

        let color = isHeader || isTotal ? '#ffffff' : C_DARK;

        // Warna laba bersih
        if (!isHeader && !isTotal && i === 5) {
          color = labaBersih > 0 ? C_GREEN : labaBersih < 0 ? C_RED : C_GRAY;
        }
        // Omset kolom warna biru (bukan header/total)
        if (!isHeader && !isTotal && i === 1) color = C_BLUE;

        const fontSize = isHeader || isTotal ? 9 : 8.5;
        const fontName = isHeader || isTotal || i === 5 ? 'Helvetica-Bold' : 'Helvetica';

        doc.fontSize(fontSize).font(fontName).fillColor(color);

        const padding = 4;
        const textW   = cw - padding * 2;
        doc.text(String(text), cx + padding, 0, {
          width: textW,
          align: col.align,
          lineBreak: false,
          baseline: 'middle',
        });
        // Manual baseline middle workaround
        doc.y = cy - 4; // reset y karena pdfkit geser y
      });

      // Garis bawah
      doc.moveTo(MARGIN, rowY + (isHeader ? HDR_H : ROW_H))
         .lineTo(MARGIN + TBL_W, rowY + (isHeader ? HDR_H : ROW_H))
         .strokeColor(isHeader || isTotal ? C_DARK : '#e2e8f0')
         .lineWidth(isTotal ? 1.5 : 0.5)
         .stroke();

      return rowY + (isHeader ? HDR_H : ROW_H);
    };

    // ── Header tabel ──
    y = drawRow(COLS.map(c => c.label), y, true);

    // ── Data baris per bulan ──
    months.forEach((m, idx) => {
      const margin = m.omset > 0 ? ((m.labaBersih / m.omset) * 100).toFixed(1) + '%' : '-';
      const cells  = [
        m.nama,
        fmtRp(m.omset),
        fmtRp(m.labaKotor),
        fmtRp(m.pemasukan),
        fmtRp(m.pengeluaran),
        fmtRp(m.labaBersih),
        m.jumlahTx,
        m.jumlahItem,
        margin,
      ];

      // Warna abu jika tidak ada transaksi
      if (m.jumlahTx === 0) {
        doc.rect(MARGIN, y, TBL_W, ROW_H).fill('#f1f5f9');
      }

      y = drawRow(cells, y, false, false, idx % 2 === 0, m.labaBersih);
    });

    // ── Baris TOTAL ──
    const totalMargin = ringkasan.omset > 0
      ? ((ringkasan.labaBersih / ringkasan.omset) * 100).toFixed(1) + '%' : '-';
    y = drawRow([
      `TOTAL ${year}`,
      fmtRp(ringkasan.omset),
      fmtRp(ringkasan.labaKotor),
      fmtRp(ringkasan.pemasukan),
      fmtRp(ringkasan.pengeluaran),
      fmtRp(ringkasan.labaBersih),
      ringkasan.jumlahTx,
      ringkasan.jumlahItem,
      totalMargin,
    ], y, false, true);

    // ── Catatan kaki ──
    y += 16;
    doc.fontSize(8).font('Helvetica').fillColor(C_GRAY)
       .text('* Laba Bersih = Laba Kotor + Pemasukan Lain − Pengeluaran', MARGIN, y)
       .text('* Margin = Laba Bersih / Omset × 100%', MARGIN, y + 12);

    doc.end();
  } catch (err) {
    console.error('Export PDF error:', err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
};

// ─── Helper: get atau buat akun brankas per cabang ───────────────────────
const getBrankasAkun = async (cabangFilter, cabangId, projection = null) => {
  const Saldo = require('../models/Saldo');
  // Projection minimal (mis. { _id: 1, saldo: 1 }) untuk hindari load mutasi array besar.
  const q = Saldo.findOne({ akunId: 'brankas', ...cabangFilter });
  let akun = await (projection ? q.select(projection) : q);
  if (!akun && cabangId) {
    akun = await Saldo.create({
      akunId: 'brankas', namaAkun: 'Brankas', group: 'Tunai',
      icon: '🏦', saldo: 0, cabang: cabangId
    });
  }
  return akun;
};

// ─── GET saldo brankas ────────────────────────────────────────────────────
exports.getBrankas = async (req, res) => {
  try {
    // SuperAdmin tidak punya brankas sendiri
    if (req.user.role === 'superadmin') {
      return res.json({ success: true, data: { brankasAmount: 0 } });
    }
    const cabangFilter = req.cabangFilter || {};
    const cabangId = req.user.cabang?._id || req.user.cabang || null;
    const akun = await getBrankasAkun(cabangFilter, cabangId);
    res.json({ success: true, data: { brankasAmount: akun?.saldo || 0 } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── UPDATE saldo brankas ─────────────────────────────────────────────────
exports.updateBrankas = async (req, res) => {
  try {
    if (req.user.role === 'superadmin')
      return res.status(403).json({ success: false, message: 'SuperAdmin tidak bisa update brankas cabang' });
    const { brankasAmount } = req.body;
    if (typeof brankasAmount !== 'number' || brankasAmount < 0)
      return res.status(400).json({ success: false, message: 'Nominal tidak valid' });
    const cabangFilter = req.cabangFilter || {};
    const cabangId = req.user.cabang?._id || req.user.cabang || null;
    const Saldo = require('../models/Saldo');
    const akun = await getBrankasAkun(cabangFilter, cabangId, { _id: 1, saldo: 1 });
    if (!akun) return res.status(404).json({ success: false, message: 'Akun brankas tidak ditemukan' });
    const saldoBefore = akun.saldo;
    await Saldo.updateOne(
      { _id: akun._id },
      {
        $set: { saldo: brankasAmount },
        $push: {
          mutasi: {
            type: brankasAmount >= saldoBefore ? 'masuk' : 'keluar',
            keterangan: 'Update Saldo Brankas Manual',
            nominal: Math.abs(brankasAmount - saldoBefore),
            saldoBefore, saldoAfter: brankasAmount, createdAt: new Date()
          }
        }
      }
    );
    res.json({ success: true, data: { brankasAmount } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── TRANSFER Brankas → Kas Tunai ────────────────────────────────────────
exports.transferBrankas = async (req, res) => {
  try {
    const { amount, keterangan } = req.body;
    const nominal = Number(amount);
    if (!nominal || nominal <= 0) return res.status(400).json({ success: false, message: 'Nominal tidak valid' });

    const cabangFilter = req.user.role === 'superadmin' ? {} : { cabang: req.user.cabang?._id || req.user.cabang };
    const cabangId = req.user.cabang?._id || req.user.cabang || null;

    const Saldo = require('../models/Saldo');
    const brankas = await getBrankasAkun(cabangFilter, cabangId, { _id: 1, saldo: 1 });
    if (!brankas) return res.status(404).json({ success: false, message: 'Akun brankas tidak ditemukan' });
    if (nominal > brankas.saldo) return res.status(400).json({ success: false, message: `Saldo brankas tidak cukup. Saldo: Rp ${brankas.saldo.toLocaleString('id-ID')}` });

    // Kurangi brankas
    const brankasSebelum = brankas.saldo;
    const brankasSesudah = brankasSebelum - nominal;
    await Saldo.updateOne(
      { _id: brankas._id },
      {
        $set: { saldo: brankasSesudah },
        $push: {
          mutasi: { type: 'keluar', keterangan: keterangan || 'Transfer ke Kas Tunai', nominal, saldoBefore: brankasSebelum, saldoAfter: brankasSesudah, createdAt: new Date() }
        }
      }
    );

    // Tambah ke kas tunai per cabang
    const kasTunai = await Saldo.findOne(
      { akunId: { $regex: '^tunai' }, ...cabangFilter },
      { _id: 1, saldo: 1 }
    );
    let kasTunaiSesudah = null;
    if (kasTunai) {
      const sb = kasTunai.saldo;
      kasTunaiSesudah = sb + nominal;
      await Saldo.updateOne(
        { _id: kasTunai._id },
        {
          $set: { saldo: kasTunaiSesudah },
          $push: {
            mutasi: { type: 'masuk', keterangan: keterangan || 'Transfer dari Brankas', nominal, saldoBefore: sb, saldoAfter: kasTunaiSesudah, createdAt: new Date() }
          }
        }
      );
    }

    res.json({ success: true, data: { brankasAmount: brankasSesudah, kasTunai: kasTunaiSesudah }, message: `Rp ${nominal.toLocaleString('id-ID')} berhasil dipindahkan ke Kas Tunai` });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
exports.getModalSummary = async (req, res) => {
  try {
    const Saldo = require('../models/Saldo');
    const cabangQ = req.cabangFilter || {};
    const [saldos, products] = await Promise.all([
      Saldo.find({ isActive: true, ...cabangQ }),
      Product.find({ type: 'fisik', isActive: true, ...cabangQ }),
    ]);

    // Kas tunai
    const kasTunai = saldos.find(s => s.akunId.startsWith('tunai'))?.saldo || 0;

    // Brankas dari saldo per cabang
    const brankas = saldos.find(s => s.akunId === 'brankas')?.saldo || 0;

    // Modal produk fisik (stok × harga modal FIFO batch terlama)
    let modalProduk = 0;
    const produkDetail = products.map(p => {
      let modalPerUnit = 0;
      if (p.stockBatches && p.stockBatches.length > 0) {
        const activeBatch = p.stockBatches.find(b => b.remainingQty > 0);
        modalPerUnit = activeBatch ? activeBatch.purchasePrice : 0;
      } else {
        modalPerUnit = p.purchasePrice || 0;
      }
      const totalModal = modalPerUnit * (p.stock || 0);
      modalProduk += totalModal;
      return {
        name: p.name, code: p.code,
        stock: p.stock || 0, modalPerUnit, totalModal,
      };
    });

    // Saldo per group (Server Pulsa, Bank, E-Wallet)
    const saldoGroups = {};
    saldos.filter(s => !s.akunId.startsWith('tunai') && s.akunId !== 'brankas').forEach(s => {
      if (!saldoGroups[s.group]) saldoGroups[s.group] = 0;
      saldoGroups[s.group] += s.saldo;
    });

    const totalSaldoDigital = Object.values(saldoGroups).reduce((a, b) => a + b, 0);
    const totalKeseluruhan  = kasTunai + brankas + modalProduk + totalSaldoDigital;

    res.json({
      success: true,
      data: {
        kasTunai, brankas, modalProduk,
        totalSaldoDigital,
        saldoGroups,
        totalKeseluruhan,
        produkDetail: produkDetail.sort((a, b) => b.totalModal - a.totalModal).slice(0, 15),
      }
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══════════════════════════════════════════════════════════════
// EXPORT RINGKASAN MODAL
// ══════════════════════════════════════════════════════════════
exports.exportModalExcel = async (req, res) => {
  try {
    const Saldo = require('../models/Saldo');
    const cabangQ = req.cabangFilter || {};
    const [saldos, products] = await Promise.all([
      Saldo.find({ isActive: true, ...cabangQ }),
      Product.find({ type: 'fisik', isActive: true, ...cabangQ }),
    ]);

    const kasTunai  = saldos.find(s => s.akunId.startsWith('tunai'))?.saldo || 0;
    const brankas   = saldos.find(s => s.akunId === 'brankas')?.saldo || 0;
    // FIXED: settings tidak didefinisikan sebelumnya — ambil dari DB
    const settingsDoc = await Settings.findOne(cabangQ);
    const storeName = settingsDoc?.storeName || 'Konter Pulsa';

    let modalProduk = 0;
    const produkDetail = products.map(p => {
      const activeBatch = (p.stockBatches || []).find(b => b.remainingQty > 0);
      const modalPerUnit = activeBatch ? activeBatch.purchasePrice : (p.purchasePrice || 0);
      const totalModal = modalPerUnit * (p.stock || 0);
      modalProduk += totalModal;
      return { name: p.name, code: p.code, stock: p.stock || 0, modalPerUnit, totalModal };
    }).sort((a, b) => b.totalModal - a.totalModal);

    const saldoGroups = {};
    saldos.filter(s => s.akunId !== 'tunai').forEach(s => {
      if (!saldoGroups[s.group]) saldoGroups[s.group] = 0;
      saldoGroups[s.group] += s.saldo;
    });
    const totalSaldoAkun = Object.values(saldoGroups).reduce((a, b) => a + b, 0);
    const totalKeseluruhan = kasTunai + brankas + modalProduk + totalSaldoAkun;

    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = storeName;

    const addHeaderRow = (ws, title, cols) => {
      ws.mergeCells(`A1:${String.fromCharCode(64 + cols)}1`);
      ws.getCell('A1').value = title;
      ws.getCell('A1').font = { bold: true, size: 13 };
      ws.getCell('A1').alignment = { horizontal: 'center' };
      ws.mergeCells(`A2:${String.fromCharCode(64 + cols)}2`);
      ws.getCell('A2').value = storeName;
      ws.getCell('A2').alignment = { horizontal: 'center' };
      ws.getCell('A2').font = { color: { argb: 'FF64748B' } };
      ws.addRow([]);
    };

    const styleHeader = (row) => row.eachCell(c => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.alignment = { horizontal: 'center' };
    });

    // Sheet 1: Ringkasan
    const ws1 = wb.addWorksheet('Ringkasan Modal');
    addHeaderRow(ws1, 'RINGKASAN MODAL KESELURUHAN', 2);
    styleHeader(ws1.addRow(['Komponen', 'Nilai']));
    const rows1 = [
      ['Kas Tunai', kasTunai],
      ['Uang Brankas', brankas],
      ['Modal Produk Fisik', modalProduk],
      ...Object.entries(saldoGroups).map(([g, v]) => [`Saldo ${g}`, v]),
      ['TOTAL KESELURUHAN', totalKeseluruhan],
    ];
    rows1.forEach((r, i) => {
      const row = ws1.addRow(r);
      row.getCell(2).numFmt = '"Rp "#,##0';
      if (i === rows1.length - 1) {
        row.eachCell(c => { c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9C4' } }; });
      }
    });
    ws1.columns = [{ width: 28 }, { width: 20 }];

    // Sheet 2: Detail Produk
    const ws2 = wb.addWorksheet('Detail Produk');
    addHeaderRow(ws2, 'DETAIL MODAL PRODUK FISIK', 4);
    styleHeader(ws2.addRow(['Kode', 'Nama Produk', 'Stok', 'Modal/Unit', 'Total Modal']));
    produkDetail.forEach((p, i) => {
      const row = ws2.addRow([p.code, p.name, p.stock, p.modalPerUnit, p.totalModal]);
      if (i % 2 === 0) row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }; });
      row.getCell(4).numFmt = '"Rp "#,##0';
      row.getCell(5).numFmt = '"Rp "#,##0';
    });
    // Total
    const totRow = ws2.addRow(['', 'TOTAL', '', '', modalProduk]);
    totRow.eachCell(c => { c.font = { bold: true }; });
    totRow.getCell(5).numFmt = '"Rp "#,##0';
    ws2.columns = [{ width: 14 }, { width: 28 }, { width: 10 }, { width: 16 }, { width: 18 }];

    const filename = `Ringkasan-Modal-${new Date().toISOString().slice(0,10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.exportModalPDF = async (req, res) => {
  try {
    const Saldo = require('../models/Saldo');
    const cabangQ = req.cabangFilter || {};
    const settings = await Settings.findOne(cabangQ);
    const [saldos, products] = await Promise.all([
      Saldo.find({ isActive: true, ...cabangQ }),
      Product.find({ type: 'fisik', isActive: true, ...cabangQ }),
    ]);

    const kasTunai  = saldos.find(s => s.akunId === 'tunai')?.saldo || 0;
    const brankas   = saldos.find(s => s.akunId === 'brankas')?.saldo || 0;
    const storeName = settings?.storeName || 'Konter Pulsa';

    let modalProduk = 0;
    const produkDetail = products.map(p => {
      const activeBatch = (p.stockBatches || []).find(b => b.remainingQty > 0);
      const modalPerUnit = activeBatch ? activeBatch.purchasePrice : (p.purchasePrice || 0);
      const totalModal = modalPerUnit * (p.stock || 0);
      modalProduk += totalModal;
      return { name: p.name, code: p.code, stock: p.stock || 0, modalPerUnit, totalModal };
    }).sort((a, b) => b.totalModal - a.totalModal);

    const saldoGroups = {};
    saldos.filter(s => s.akunId !== 'tunai').forEach(s => {
      if (!saldoGroups[s.group]) saldoGroups[s.group] = 0;
      saldoGroups[s.group] += s.saldo;
    });
    const totalKeseluruhan = kasTunai + brankas + modalProduk + Object.values(saldoGroups).reduce((a, b) => a + b, 0);

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Ringkasan-Modal-${new Date().toISOString().slice(0,10)}.pdf"`);
    doc.pipe(res);

    const fmtRp = n => 'Rp ' + (n||0).toLocaleString('id-ID');
    const W = doc.page.width - 80;
    const M = 40;

    doc.fontSize(16).font('Helvetica-Bold').text('RINGKASAN MODAL KESELURUHAN', M, M, { width: W, align: 'center' });
    doc.fontSize(11).font('Helvetica').fillColor('#64748b').text(storeName, M, M + 22, { width: W, align: 'center' });
    doc.fontSize(9).text(`Dicetak: ${new Date().toLocaleDateString('id-ID', { day:'2-digit', month:'long', year:'numeric' })}`, M, M + 38, { width: W, align: 'center' });

    let y = M + 60;
    const ROW_H = 22;
    const drawRow = (label, val, bold = false, bg = null) => {
      if (bg) doc.rect(M, y, W, ROW_H).fill(bg);
      doc.fillColor(bold ? '#1e293b' : '#334155').font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
      doc.text(label, M + 8, y + 6, { width: W * 0.6 });
      doc.text(val, M + W * 0.6, y + 6, { width: W * 0.4, align: 'right' });
      doc.moveTo(M, y + ROW_H).lineTo(M + W, y + ROW_H).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
      y += ROW_H;
    };

    // Header
    doc.rect(M, y, W, ROW_H).fill('#1e293b');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(10);
    doc.text('Komponen', M + 8, y + 6); doc.text('Nilai', M + W * 0.6, y + 6, { width: W * 0.4, align: 'right' });
    y += ROW_H;

    drawRow('Kas Tunai', fmtRp(kasTunai), false, '#f8fafc');
    drawRow('Uang Brankas', fmtRp(brankas));
    drawRow('Modal Produk Fisik', fmtRp(modalProduk), false, '#f8fafc');
    Object.entries(saldoGroups).forEach(([g, v], i) => drawRow(`Saldo ${g}`, fmtRp(v), false, i % 2 === 0 ? null : '#f8fafc'));
    drawRow('TOTAL KESELURUHAN', fmtRp(totalKeseluruhan), true, '#fef9c3');

    y += 20;
    // Detail produk
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#1e293b').text('Detail Modal Produk Fisik', M, y);
    y += 18;

    doc.rect(M, y, W, ROW_H).fill('#1e293b');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9);
    doc.text('Kode', M+4, y+6, {width:60}); doc.text('Nama Produk', M+68, y+6, {width:200});
    doc.text('Stok', M+272, y+6, {width:40, align:'right'}); doc.text('Modal/Unit', M+316, y+6, {width:90, align:'right'}); doc.text('Total Modal', M+410, y+6, {width:90, align:'right'});
    y += ROW_H;

    produkDetail.slice(0, 20).forEach((p, i) => {
      if (y > doc.page.height - 80) { doc.addPage(); y = 40; }
      if (i % 2 === 0) doc.rect(M, y, W, ROW_H).fill('#f8fafc');
      doc.fillColor('#334155').font('Helvetica').fontSize(9);
      doc.text(p.code, M+4, y+6, {width:60}); doc.text(p.name, M+68, y+6, {width:200, ellipsis:true});
      doc.text(`${p.stock}`, M+272, y+6, {width:40, align:'right'}); doc.text(fmtRp(p.modalPerUnit), M+316, y+6, {width:90, align:'right'}); doc.text(fmtRp(p.totalModal), M+410, y+6, {width:90, align:'right'});
      doc.moveTo(M, y+ROW_H).lineTo(M+W, y+ROW_H).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
      y += ROW_H;
    });

    doc.end();
  } catch (err) { if (!res.headersSent) res.status(500).json({ success: false, message: err.message }); }
};

// ══════════════════════════════════════════════════════════════
// EXPORT LAPORAN SERVICE HP
// ══════════════════════════════════════════════════════════════
exports.exportServiceExcel = async (req, res) => {
  try {
    const ServiceTransaction = require('../models/ServiceTransaction');
    const ServiceFinance     = require('../models/ServiceFinance');
    const year  = parseInt(req.query.year)  || new Date().getFullYear();

    const yearStart = new Date(year, 0, 1);
    const yearEnd   = new Date(year, 11, 31, 23, 59, 59);

    const [txAll, finAll, settings] = await Promise.all([
      ServiceTransaction.find({ isVoid: { $ne: true }, receivedAt: { $gte: yearStart, $lte: yearEnd } }),
      ServiceFinance.find({ date: { $gte: yearStart, $lte: yearEnd } }),
      Settings.findOne(req.cabangFilter || {}),
    ]);

    const NAMA = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    const storeName = settings?.storeName || 'Konter Pulsa';

    const months = Array.from({ length: 12 }, (_, i) => {
      const txBulan  = txAll.filter(t => t.isPaid && new Date(t.paidAt || t.receivedAt).getMonth() === i);
      const finBulan = finAll.filter(f => new Date(f.date).getMonth() === i);
      const omset       = txBulan.reduce((s, t) => s + (t.totalCost||0), 0);
      const labaKotor   = txBulan.reduce((s, t) => s + (t.profit||0), 0);
      const pengeluaran = finBulan.filter(f => f.type==='pengeluaran').reduce((s,f) => s+f.amount, 0);
      return { nama: NAMA[i], omset, labaKotor, pengeluaran, labaBersih: omset-pengeluaran, jumlahTx: txBulan.length };
    });

    const ring = months.reduce((a, m) => ({
      omset: a.omset+m.omset, labaKotor: a.labaKotor+m.labaKotor,
      pengeluaran: a.pengeluaran+m.pengeluaran, labaBersih: a.labaBersih+m.labaBersih, jumlahTx: a.jumlahTx+m.jumlahTx
    }), { omset:0, labaKotor:0, pengeluaran:0, labaBersih:0, jumlahTx:0 });

    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();

    // Sheet rekap bulanan
    const ws = wb.addWorksheet(`Service ${year}`);
    ws.mergeCells('A1:G1');
    ws.getCell('A1').value = `LAPORAN SERVICE HP — ${year}`;
    ws.getCell('A1').font = { bold: true, size: 13 }; ws.getCell('A1').alignment = { horizontal:'center' };
    ws.mergeCells('A2:G2');
    ws.getCell('A2').value = storeName; ws.getCell('A2').alignment = { horizontal:'center' };
    ws.addRow([]);

    const hdr = ws.addRow(['Bulan','Omset','Laba Kotor','Pengeluaran','Laba Bersih','Unit Servis','Margin %']);
    hdr.eachCell(c => { c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1E293B'}}; c.font={bold:true,color:{argb:'FFFFFFFF'}}; c.alignment={horizontal:'center'}; });

    months.forEach((m, i) => {
      const margin = m.omset > 0 ? ((m.labaBersih/m.omset)*100).toFixed(1)+'%' : '0%';
      const row = ws.addRow([m.nama, m.omset, m.labaKotor, m.pengeluaran, m.labaBersih, m.jumlahTx, margin]);
      if (i%2===0) row.eachCell(c => { c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF8FAFC'}}; });
      [2,3,4,5].forEach(n => { row.getCell(n).numFmt='"Rp "#,##0'; row.getCell(n).alignment={horizontal:'right'}; });
      if (m.labaBersih < 0) row.getCell(5).font = { color:{argb:'FFEF4444'}, bold:true };
      else if (m.labaBersih > 0) row.getCell(5).font = { color:{argb:'FF16A34A'}, bold:true };
    });

    const tot = ws.addRow([`TOTAL ${year}`, ring.omset, ring.labaKotor, ring.pengeluaran, ring.labaBersih, ring.jumlahTx,
      ring.omset>0?((ring.labaBersih/ring.omset)*100).toFixed(1)+'%':'0%']);
    tot.eachCell((c,n) => { c.font={bold:true,color:{argb:'FFFFFFFF'}}; c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1E293B'}};
      if([2,3,4,5].includes(n)){c.numFmt='"Rp "#,##0';c.alignment={horizontal:'right'};} });

    ws.columns = [{width:14},{width:18},{width:16},{width:16},{width:16},{width:12},{width:10}];

    const filename = `Laporan-Service-${year}.xlsx`;
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
    await wb.xlsx.write(res); res.end();
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.exportServicePDF = async (req, res) => {
  try {
    const ServiceTransaction = require('../models/ServiceTransaction');
    const ServiceFinance     = require('../models/ServiceFinance');
    const year  = parseInt(req.query.year) || new Date().getFullYear();

    const yearStart = new Date(year, 0, 1);
    const yearEnd   = new Date(year, 11, 31, 23, 59, 59);

    const [txAll, finAll, settings] = await Promise.all([
      ServiceTransaction.find({ isVoid: { $ne: true }, receivedAt: { $gte: yearStart, $lte: yearEnd } }),
      ServiceFinance.find({ date: { $gte: yearStart, $lte: yearEnd } }),
      Settings.findOne(req.cabangFilter || {}),
    ]);

    const NAMA = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
    const storeName = settings?.storeName || 'Konter Pulsa';
    const fmtRp = n => 'Rp '+(n||0).toLocaleString('id-ID');

    const months = Array.from({ length: 12 }, (_, i) => {
      const txBulan  = txAll.filter(t => t.isPaid && new Date(t.paidAt || t.receivedAt).getMonth() === i);
      const finBulan = finAll.filter(f => new Date(f.date).getMonth() === i);
      const omset     = txBulan.reduce((s,t) => s+(t.totalCost||0), 0);
      const pengeluaran = finBulan.filter(f=>f.type==='pengeluaran').reduce((s,f)=>s+f.amount,0);
      return { nama:NAMA[i], omset, labaKotor:txBulan.reduce((s,t)=>s+(t.profit||0),0), pengeluaran, labaBersih:omset-pengeluaran, jumlahTx:txBulan.length };
    });
    const ring = months.reduce((a,m)=>({omset:a.omset+m.omset,labaKotor:a.labaKotor+m.labaKotor,pengeluaran:a.pengeluaran+m.pengeluaran,labaBersih:a.labaBersih+m.labaBersih,jumlahTx:a.jumlahTx+m.jumlahTx}),{omset:0,labaKotor:0,pengeluaran:0,labaBersih:0,jumlahTx:0});

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin:40, size:'A4', layout:'landscape' });
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename="Laporan-Service-${year}.pdf"`);
    doc.pipe(res);

    const W = doc.page.width-80, M = 40;
    const COLS = [{label:'Bulan',w:0.14},{label:'Omset',w:0.15},{label:'Laba Kotor',w:0.13},{label:'Pengeluaran',w:0.13},{label:'Laba Bersih',w:0.14},{label:'Unit',w:0.08},{label:'Margin',w:0.08}];
    let colX=[M]; for(let i=0;i<COLS.length-1;i++) colX.push(colX[i]+COLS[i].w*W);

    doc.fontSize(15).font('Helvetica-Bold').fillColor('#1e293b').text(`LAPORAN SERVICE HP — ${year}`,M,M,{width:W,align:'center'});
    doc.fontSize(10).font('Helvetica').fillColor('#64748b').text(storeName,M,M+20,{width:W,align:'center'});
    doc.fontSize(9).text(`Dicetak: ${new Date().toLocaleDateString('id-ID',{day:'2-digit',month:'long',year:'numeric'})}`,M,M+36,{width:W,align:'center'});

    let y=M+58; const ROW_H=22, HDR_H=24;
    const drawRow=(cells,rowY,isHdr=false,isTot=false,isEven=false,laba=0)=>{
      if(isHdr||isTot) doc.rect(M,rowY,W,isHdr?HDR_H:ROW_H).fill('#1e293b');
      else if(isEven) doc.rect(M,rowY,W,ROW_H).fill('#f8fafc');
      cells.forEach((txt,i)=>{
        const col=COLS[i],cx=colX[i],cw=col.w*W,h=isHdr?HDR_H:ROW_H;
        let color=isHdr||isTot?'#ffffff':'#334155';
        if(!isHdr&&!isTot&&i===4) color=laba>0?'#16a34a':laba<0?'#dc2626':'#64748b';
        doc.fontSize(isHdr||isTot?9:8.5).font(isHdr||isTot||i===4?'Helvetica-Bold':'Helvetica').fillColor(color);
        doc.text(String(txt),cx+4,rowY+h/2-4,{width:cw-8,align:col.align||(i===0?'left':'right'),lineBreak:false});
      });
      doc.moveTo(M,rowY+(isHdr?HDR_H:ROW_H)).lineTo(M+W,rowY+(isHdr?HDR_H:ROW_H)).strokeColor(isHdr||isTot?'#1e293b':'#e2e8f0').lineWidth(isHdr||isTot?1.5:0.5).stroke();
      return rowY+(isHdr?HDR_H:ROW_H);
    };

    y=drawRow(COLS.map(c=>c.label),y,true);
    months.forEach((m,i)=>{
      const margin=m.omset>0?((m.labaBersih/m.omset)*100).toFixed(1)+'%':'-';
      y=drawRow([m.nama,fmtRp(m.omset),fmtRp(m.labaKotor),fmtRp(m.pengeluaran),fmtRp(m.labaBersih),m.jumlahTx,margin],y,false,false,i%2===0,m.labaBersih);
    });
    y=drawRow([`TOTAL ${year}`,fmtRp(ring.omset),fmtRp(ring.labaKotor),fmtRp(ring.pengeluaran),fmtRp(ring.labaBersih),ring.jumlahTx,ring.omset>0?((ring.labaBersih/ring.omset)*100).toFixed(1)+'%':'-'],y,false,true);

    doc.end();
  } catch(err){ if(!res.headersSent) res.status(500).json({success:false,message:err.message}); }
};
// ── Target Omset Per Cabang ───────────────────────────────────────────────
exports.getTargetOmset = async (req, res) => {
  try {
    const cabangFilter = req.cabangFilter || {};
    let s = await Settings.findOne(cabangFilter);
    // Fallback: kalau tidak ada settings per cabang, cek settings lama (tanpa cabang)
    if (!s && cabangFilter.cabang) s = await Settings.findOne({ cabang: { $exists: false } });
    if (!s) s = await Settings.create({ ...cabangFilter });

    const now        = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const Transaction = require('../models/Transaction');
    const cabangQ    = req.cabangFilter || {};

    const agg = await Transaction.aggregate([
      { $match: { ...cabangQ, type: 'penjualan', isVoid: { $ne: true }, transactionDate: { $gte: monthStart } } },
      { $group: { _id: null, omset: { $sum: '$total' }, laba: { $sum: '$totalProfit' }, count: { $sum: 1 } } }
    ]);

    const omsetBulanIni = agg[0]?.omset || 0;
    const targetOmset   = s.targetOmset || 0;
    const persentase    = targetOmset > 0 ? Math.min(Math.round((omsetBulanIni / targetOmset) * 100), 100) : 0;
    const sisaHari      = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();

    res.json({
      success: true,
      data: {
        targetOmset, omsetBulanIni, persentase, sisaHari,
        laba: agg[0]?.laba || 0,
        jumlahTx: agg[0]?.count || 0,
        bulan: now.toLocaleString('id-ID', { month: 'long', year: 'numeric' })
      }
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.setTargetOmset = async (req, res) => {
  try {
    const { targetOmset } = req.body;
    if (!targetOmset || isNaN(targetOmset)) return res.status(400).json({ success: false, message: 'Target omset tidak valid' });

    const cabangFilter = req.cabangFilter || {};
    // Cari settings per cabang dulu, fallback ke settings lama, baru buat baru
    let s = await Settings.findOne(cabangFilter);
    if (!s && cabangFilter.cabang) s = await Settings.findOne({ cabang: { $exists: false } });
    if (!s) s = new Settings({ ...cabangFilter });

    // Pastikan cabang ter-set agar konsisten
    if (cabangFilter.cabang && !s.cabang) s.cabang = cabangFilter.cabang;

    s.targetOmset = Number(targetOmset);
    await s.save();

    res.json({ success: true, message: 'Target omset berhasil disimpan', data: { targetOmset: s.targetOmset } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── GET: Statistik per kategori (fisik/digital/jasa) ─────────
exports.getKategoriStats = async (req, res) => {
  try {
    const cabangQ = req.cabangFilter || {};
    const { periode = 'hari' } = req.query;
    const now = new Date();

    let dateStart;
    if (periode === 'hari') {
      dateStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    } else if (periode === 'minggu') {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      dateStart = new Date(now.getFullYear(), now.getMonth(), diff, 0, 0, 0, 0);
    } else {
      dateStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    }

    const txs = await Transaction.find({
      transactionDate: { $gte: dateStart },
      type: 'penjualan',
      isVoid: { $ne: true },
      ...cabangQ
    }).select('items total');

    const stats = {
      fisik:   { omset: 0, laba: 0, transaksi: 0 },
      digital: { omset: 0, laba: 0, transaksi: 0 },
      jasa:    { omset: 0, laba: 0, transaksi: 0 },
    };

    for (const tx of txs) {
      const types = new Set((tx.items || []).map(i => i.type));

      // Tentukan kategori dominan transaksi
      let dominan = null;
      if (types.has('fisik'))   dominan = 'fisik';
      if (types.has('digital')) dominan = 'digital';
      if (types.has('jasa'))    dominan = 'jasa';

      // Hitung per item
      for (const item of (tx.items || [])) {
        const cat = item.type === 'fisik' ? 'fisik' : item.type === 'digital' ? 'digital' : 'jasa';
        const omset = item.subtotal || 0;
        // FIXED: prioritaskan item.profit yang sudah dihitung saat transaksi
        // modalAmount bukan modal produk (bisa berisi nominal tarik tunai dll)
        let laba;
        if (item.profit !== undefined && item.profit !== null) {
          laba = item.profit; // pakai profit tersimpan, termasuk kalau nilainya 0
        } else {
          const modal = (item.purchasePrice || 0) * (item.quantity || 1);
          laba = omset - modal;
        }
        stats[cat].omset += omset;
        stats[cat].laba  += laba;
      }

      // Hitung transaksi — berdasarkan item dominan
      if (dominan) stats[dominan].transaksi += 1;
    }

    res.json({ success: true, data: stats });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══════════════════════════════════════════════════════════════════════════
// INVESTOR PORTAL
// ══════════════════════════════════════════════════════════════════════════

// POST /api/investor/login
exports.investorLogin = (req, res) => {
  const { password } = req.body;
  if (password !== process.env.INVESTOR_PASSWORD) {
    return res.status(401).json({ success: false, message: 'Password salah' });
  }
  const jwt = require('jsonwebtoken');
  const token = jwt.sign({ role: 'investor' }, process.env.JWT_SECRET, { expiresIn: '1d' });
  res.json({ success: true, token });
};

// GET /api/investor/stats?periode=hari|minggu|bulan
exports.getInvestorStats = async (req, res) => {
  try {
    const jwt = require('jsonwebtoken');
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer')) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'investor') return res.status(403).json({ success: false, message: 'Forbidden' });

    const { periode = 'hari' } = req.query;
    const now = new Date();
    let dateStart;
    if (periode === 'hari') {
      dateStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    } else if (periode === 'minggu') {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      dateStart = new Date(now.getFullYear(), now.getMonth(), diff, 0, 0, 0, 0);
    } else {
      dateStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    }

    // Filter hanya cabang Galaxy Cell milik investor
    const mongoose = require('mongoose');
    const INVESTOR_CABANG_ID = new mongoose.Types.ObjectId('69ef7e395c5f15b9e76d2dde');

    const txs = await Transaction.find({
      transactionDate: { $gte: dateStart },
      type: 'penjualan',
      isVoid: { $ne: true },
      cabang: INVESTOR_CABANG_ID
    }).select('total totalProfit items');

    const stats = {
      fisik:   { omset: 0, laba: 0, transaksi: 0 },
      digital: { omset: 0, laba: 0, transaksi: 0 },
    };

    let totalOmset = 0;
    let totalLaba  = 0;

    for (const tx of txs) {
      totalOmset += tx.total || 0;
      totalLaba  += tx.totalProfit || 0;

      const types = new Set((tx.items || []).map(i => i.type));
      if (types.has('fisik'))   stats.fisik.transaksi   += 1;
      if (types.has('digital')) stats.digital.transaksi += 1;

      for (const item of (tx.items || [])) {
        const cat = item.type === 'fisik' ? 'fisik' : 'digital';
        stats[cat].omset += item.subtotal || 0;
        let laba = 0;
        if (item.profit !== undefined && item.profit !== null) {
          laba = item.profit;
        } else {
          laba = (item.subtotal || 0) - (item.purchasePrice || 0) * (item.quantity || 1);
        }
        stats[cat].laba += laba;
      }
    }

    res.json({
      success: true,
      data: {
        totalOmset, totalLaba,
        totalTx: txs.length,
        periode,
        fisik: stats.fisik,
        digital: stats.digital
      }
    });
  } catch (err) {
    if (err.name === 'JsonWebTokenError') return res.status(401).json({ success: false, message: 'Token tidak valid' });
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/investor/chart?periode=hari|minggu|bulan
exports.getInvestorChart = async (req, res) => {
  try {
    const jwt = require('jsonwebtoken');
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer')) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'investor') return res.status(403).json({ success: false, message: 'Forbidden' });

    const { periode = 'hari' } = req.query;
    const now = new Date();
    const mongoose = require('mongoose');
    const INVESTOR_CABANG_ID = new mongoose.Types.ObjectId('69ef7e395c5f15b9e76d2dde');

    let slots = [];

    if (periode === 'hari') {
      // Per jam 00-23
      for (let h = 0; h <= now.getHours(); h++) {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, 0, 0, 0);
        const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, 59, 59, 999);
        slots.push({ label: `${String(h).padStart(2,'0')}:00`, start, end });
      }
    } else if (periode === 'minggu') {
      // Per hari 7 hari (Senin-hari ini)
      const day  = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      for (let i = 0; i < 7; i++) {
        const d     = new Date(now.getFullYear(), now.getMonth(), diff + i);
        if (d > now) break;
        const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
        const end   = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
        const label = d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric' });
        slots.push({ label, start, end });
      }
    } else {
      // Per hari dalam bulan ini
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      for (let i = 1; i <= Math.min(now.getDate(), daysInMonth); i++) {
        const start = new Date(now.getFullYear(), now.getMonth(), i, 0, 0, 0, 0);
        const end   = new Date(now.getFullYear(), now.getMonth(), i, 23, 59, 59, 999);
        slots.push({ label: `${i}/${now.getMonth()+1}`, start, end });
      }
    }

    // Ambil semua tx sekali, lalu group di memory
    const firstStart = slots[0].start;
    const lastEnd    = slots[slots.length - 1].end;
    const txs = await Transaction.find({
      transactionDate: { $gte: firstStart, $lte: lastEnd },
      type: 'penjualan',
      isVoid: { $ne: true },
      cabang: INVESTOR_CABANG_ID
    }).select('transactionDate total totalProfit items');

    const chartData = slots.map(slot => {
      const slotTx = txs.filter(t => t.transactionDate >= slot.start && t.transactionDate <= slot.end);
      let fisikOmset = 0, digitalOmset = 0;
      for (const tx of slotTx) {
        for (const item of (tx.items || [])) {
          if (item.type === 'fisik')   fisikOmset   += item.subtotal || 0;
          else                         digitalOmset += item.subtotal || 0;
        }
      }
      let fisikLaba = 0, digitalLaba = 0;
      for (const tx of slotTx) {
        for (const item of (tx.items || [])) {
          let laba = 0;
          if (item.profit !== undefined && item.profit !== null) laba = item.profit;
          else laba = (item.subtotal || 0) - (item.purchasePrice || 0) * (item.quantity || 1);
          if (item.type === 'fisik') fisikLaba   += laba;
          else                       digitalLaba += laba;
        }
      }
      return { label: slot.label, fisik: fisikOmset, digital: digitalOmset, fisikLaba, digitalLaba };
    });

    res.json({ success: true, data: chartData });
  } catch (err) {
    if (err.name === 'JsonWebTokenError') return res.status(401).json({ success: false, message: 'Token tidak valid' });
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/investor/saldo — kas tunai & total saldo digital Galaxy Cell
exports.getInvestorSaldo = async (req, res) => {
  try {
    const jwt = require('jsonwebtoken');
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer')) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'investor') return res.status(403).json({ success: false, message: 'Forbidden' });

    const mongoose = require('mongoose');
    const Saldo = require('../models/Saldo');
    const INVESTOR_CABANG_ID = new mongoose.Types.ObjectId('69ef7e395c5f15b9e76d2dde');

    const akuns = await Saldo.find({ cabang: INVESTOR_CABANG_ID, isActive: true }).select('namaAkun group saldo');

    const kasTunai      = akuns.filter(a => a.group === 'Tunai').reduce((s, a) => s + a.saldo, 0);
    const saldoDigital  = akuns.filter(a => a.group !== 'Tunai').reduce((s, a) => s + a.saldo, 0);

    res.json({ success: true, data: { kasTunai, saldoDigital } });
  } catch (err) {
    if (err.name === 'JsonWebTokenError') return res.status(401).json({ success: false, message: 'Token tidak valid' });
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/investor/monthly?bulan=6&tahun=2026
exports.getInvestorMonthly = async (req, res) => {
  try {
    const jwt = require('jsonwebtoken');
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer')) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'investor') return res.status(403).json({ success: false, message: 'Forbidden' });

    const mongoose = require('mongoose');
    const { Finance } = require('../models/index');
    const INVESTOR_CABANG_ID = new mongoose.Types.ObjectId('69ef7e395c5f15b9e76d2dde');

    const now    = new Date();
    const bulan  = parseInt(req.query.bulan  || now.getMonth() + 1);
    const tahun  = parseInt(req.query.tahun  || now.getFullYear());

    const dateStart = new Date(tahun, bulan - 1, 1, 0, 0, 0, 0);
    const dateEnd   = new Date(tahun, bulan, 0, 23, 59, 59, 999);

    // Ambil transaksi bulan ini
    const txs = await Transaction.find({
      transactionDate: { $gte: dateStart, $lte: dateEnd },
      type: 'penjualan',
      isVoid: { $ne: true },
      cabang: INVESTOR_CABANG_ID
    }).select('total totalProfit items');

    // Ambil finance bulan ini
    const fins = await Finance.find({
      date: { $gte: dateStart, $lte: dateEnd },
      cabang: INVESTOR_CABANG_ID
    }).select('type category amount');

    const stats = {
      fisik:   { omset: 0, laba: 0, transaksi: 0 },
      digital: { omset: 0, laba: 0, transaksi: 0 },
    };

    let totalOmset = 0, totalLaba = 0;

    for (const tx of txs) {
      totalOmset += tx.total || 0;
      totalLaba  += tx.totalProfit || 0;
      const types = new Set((tx.items || []).map(i => i.type));
      if (types.has('fisik'))   stats.fisik.transaksi   += 1;
      if (types.has('digital')) stats.digital.transaksi += 1;
      for (const item of (tx.items || [])) {
        const cat = item.type === 'fisik' ? 'fisik' : 'digital';
        stats[cat].omset += item.subtotal || 0;
        let laba = 0;
        if (item.profit !== undefined && item.profit !== null) laba = item.profit;
        else laba = (item.subtotal || 0) - (item.purchasePrice || 0) * (item.quantity || 1);
        stats[cat].laba += laba;
      }
    }

    const pengeluaran = fins.filter(f => f.type === 'pengeluaran' && f.category !== 'Pembelian Stok').reduce((s, f) => s + f.amount, 0);
    const cashbackFee = fins.filter(f => f.type === 'pemasukan' && f.category === 'Cashback / Fee').reduce((s, f) => s + f.amount, 0);
    const labaBersih  = totalLaba - pengeluaran + cashbackFee;

    res.json({
      success: true,
      data: {
        bulan, tahun,
        totalOmset, totalLaba, pengeluaran, cashbackFee, labaBersih,
        totalTx: txs.length,
        fisik: stats.fisik,
        digital: stats.digital
      }
    });
  } catch (err) {
    if (err.name === 'JsonWebTokenError') return res.status(401).json({ success: false, message: 'Token tidak valid' });
    res.status(500).json({ success: false, message: err.message });
  }
};
