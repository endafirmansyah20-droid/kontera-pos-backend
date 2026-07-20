const ClosingKas = require('../models/ClosingKas');
const KasSummary = require('../models/KasSummary');
const Transaction = require('../models/Transaction');
const { Finance, StockLog } = require('../models/index');
const Saldo = require('../models/Saldo');
const mongoose = require('mongoose');
const Product = require('../models/Product');

// Helper: get atau buat KasSummary per cabang
const getKasSummary = async (cabangId = null) => {
  const q = cabangId ? { cabang: cabangId } : { cabang: null };
  let ks = await KasSummary.findOne(q);
  if (!ks) ks = await KasSummary.create({ totalCashPlus: 0, totalCashMinus: 0, cabang: cabangId || null });
  return ks;
};

exports.getSummaryHariIni = async (req, res) => {
  try {
    const { tanggal } = req.query;
    const tgl = tanggal ? new Date(tanggal) : new Date();
    const start = new Date(tgl); start.setHours(0, 0, 0, 0);
    const end = new Date(tgl); end.setHours(23, 59, 59, 999);

    const cabangQ = req.cabangFilter || {};
    const kasTunaiKey = req.user.cabang ? `tunai-${(req.user.cabang?.kode || '').toLowerCase()}` : 'tunai';
    // FIXED: Konversi cabang ke ObjectId dan String untuk query yang kompatibel
    const cabangIdRaw = cabangQ.cabang;
    const cabangObjId = cabangIdRaw && mongoose.Types.ObjectId.isValid(cabangIdRaw)
      ? new mongoose.Types.ObjectId(String(cabangIdRaw)) : null;
    const cabangStr = cabangIdRaw ? String(cabangIdRaw) : null;
    const kasTunaiQuery = cabangObjId
      ? { akunId: 'tunai', $or: [{ cabang: cabangObjId }, { cabang: cabangStr }] }
      : { akunId: kasTunaiKey };
    const [txCash, txQris, txTransfer, pengeluaran, kasTunai, ks] = await Promise.all([
      Transaction.find({ transactionDate: { $gte: start, $lte: end }, paymentMethod: 'cash', isVoid: false, type: 'penjualan', ...cabangQ }),
      Transaction.find({ transactionDate: { $gte: start, $lte: end }, paymentMethod: 'qris', isVoid: false, type: 'penjualan', ...cabangQ }),
      Transaction.find({ transactionDate: { $gte: start, $lte: end }, paymentMethod: 'transfer', isVoid: false, type: 'penjualan', ...cabangQ }),
      Finance.find({ date: { $gte: start, $lte: end }, type: 'pengeluaran', ...cabangQ }),
      Saldo.findOne(kasTunaiQuery).then(r => r || Saldo.findOne({ akunId: kasTunaiKey })),
      getKasSummary(cabangObjId)
    ]);

    res.json({
      success: true,
      data: {
        tanggal: tgl,
        totalPemasukanCash: txCash.reduce((s, t) => s + t.total, 0),
        totalPengeluaranCash: pengeluaran.reduce((s, f) => s + f.amount, 0),
        totalTransaksiCash: txCash.reduce((s, t) => s + t.total, 0) - pengeluaran.reduce((s, f) => s + f.amount, 0),
        jumlahTransaksiCash: txCash.length,
        totalQris: txQris.reduce((s, t) => s + t.total, 0),
        totalTransfer: txTransfer.reduce((s, t) => s + t.total, 0),
        jumlahTransaksiQris: txQris.length,
        jumlahTransaksiTransfer: txTransfer.length,
        saldoSistem: kasTunai?.saldo || 0,
        // Kumulatif Cash Plus & Minus
        totalCashPlusKumulatif: ks.totalCashPlus,
        totalCashMinusKumulatif: ks.totalCashMinus,
      }
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.createClosing = async (req, res) => {
  try {
    const { type = 'cash' } = req.body;

    // ── CLOSING PRODUK ────────────────────────────────────
    if (type === 'produk') {
      const { produkItems, catatan, shift, uangPlusSetor, cashPlusUsed } = req.body;
      const cashPlusUsedAmount = parseFloat(cashPlusUsed) || 0;
      const uangPlusSetorAmount = parseFloat(uangPlusSetor) || 0;
      if (!produkItems || produkItems.length === 0) {
        return res.status(400).json({ success: false, message: 'Tidak ada produk yang dihitung' });
      }

      const cabangIdForKs = req.user.cabang?._id || req.user.cabang || null;
      const cabangQ2 = req.cabangFilter || {};
      const cabangIdRaw = cabangQ2.cabang;
      const cabangObjId = cabangIdRaw
        ? (mongoose.Types.ObjectId.isValid(cabangIdRaw)
            ? new mongoose.Types.ObjectId(String(cabangIdRaw))
            : cabangIdRaw)
        : null;
      const cabangStr = cabangIdRaw ? String(cabangIdRaw) : null;
      const tunaiKodeKey = `tunai-${(req.user.cabang?.kode || '').toLowerCase()}`;

      const session = await mongoose.startSession();
      let closingDoc;
      try {
        await session.withTransaction(async () => {
          let cashPlus = 0;
          let cashMinus = 0;
          const processedItems = [];

          for (const item of produkItems) {
            const product = await Product.findById(item.productId).session(session);
            if (!product) continue;

            const stokSistemSekarang = product.stock;
            const selisihStok = item.stokFisik - stokSistemSekarang;
            const nilaiSelisih = selisihStok * product.sellPrice;

            if (selisihStok > 0) cashPlus += nilaiSelisih;
            else if (selisihStok < 0) cashMinus += Math.abs(nilaiSelisih);

            processedItems.push({
              productId: item.productId,
              productCode: product.code,
              productName: product.name,
              stokSistem: stokSistemSekarang,
              stokFisik: item.stokFisik,
              selisih: selisihStok,
              hargaJual: product.sellPrice,
              nilaiSelisih,
            });

            if (selisihStok !== 0) {
              const stokLama = product.stock;
              product.stock = item.stokFisik;

              if (selisihStok < 0 && product.stockBatches?.length > 0) {
                let kurang = Math.abs(selisihStok);
                for (let i = 0; i < product.stockBatches.length && kurang > 0; i++) {
                  const ambil = Math.min(product.stockBatches[i].remainingQty, kurang);
                  product.stockBatches[i].remainingQty -= ambil;
                  kurang -= ambil;
                }
                product.stockBatches = product.stockBatches.filter(b => b.remainingQty > 0);
              } else if (selisihStok > 0 && product.stockBatches?.length > 0) {
                product.stockBatches[product.stockBatches.length - 1].remainingQty += selisihStok;
              }

              await product.save({ session });

              await StockLog.create([{
                product: product._id, productCode: product.code, productName: product.name,
                type: 'adjustment', quantity: Math.abs(selisihStok),
                notes: `Closing Produk: ${stokLama} → ${item.stokFisik}`,
                createdBy: req.user._id
              }], { session });
            }
          }

          // Ambil/buat KasSummary dalam session (helper tidak session-aware)
          let ks = await KasSummary.findOne({ cabang: cabangIdForKs || null }).session(session);
          if (!ks) {
            const createdKs = await KasSummary.create(
              [{ totalCashPlus: 0, totalCashMinus: 0, cabang: cabangIdForKs || null }],
              { session }
            );
            ks = createdKs[0];
          }

          // Lookup Saldo Kas Tunai sekali — dipakai untuk uangPlusSetor + cashPlusUsed
          let kasTunai = null;
          if (uangPlusSetorAmount > 0 || cashPlusUsedAmount > 0) {
            kasTunai = cabangObjId
              ? (await Saldo.findOne({ akunId: 'tunai', $or: [{ cabang: cabangObjId }, { cabang: cabangStr }] }).session(session))
                || (await Saldo.findOne({ akunId: tunaiKodeKey }).session(session))
              : await Saldo.findOne({ akunId: tunaiKodeKey }).session(session);
          }

          // Setor sisa Uang Plus → Kas Tunai
          if (uangPlusSetorAmount > 0 && kasTunai) {
            const sb = kasTunai.saldo;
            const newSaldo = sb + uangPlusSetorAmount;
            await Saldo.updateOne(
              { _id: kasTunai._id },
              {
                $set: { saldo: newSaldo },
                $push: {
                  mutasi: {
                    type: 'masuk',
                    amount: uangPlusSetorAmount,
                    keterangan: `Setor Uang Plus dari Closing Cash → Closing Produk`,
                    saldoBefore: sb,
                    saldoAfter: newSaldo,
                    createdBy: req.user._id,
                    date: new Date()
                  }
                }
              },
              { session }
            );
            kasTunai.saldo = newSaldo; // sinkronkan local copy untuk mutasi berikutnya
          }

          // Setor Cash Plus yang dipakai tutup selisih produk → Kas Tunai
          // (uang riil pendapatan sah — fisik sudah dipisah saat Closing Cash, sekarang masuk balik)
          if (cashPlusUsedAmount > 0 && kasTunai) {
            const sb = kasTunai.saldo;
            const newSaldo = sb + cashPlusUsedAmount;
            await Saldo.updateOne(
              { _id: kasTunai._id },
              {
                $set: { saldo: newSaldo },
                $push: {
                  mutasi: {
                    type: 'masuk',
                    amount: cashPlusUsedAmount,
                    keterangan: `Setor Cash Plus (dipakai tutup selisih produk) — Closing Produk`,
                    saldoBefore: sb,
                    saldoAfter: newSaldo,
                    createdBy: req.user._id,
                    date: new Date()
                  }
                }
              },
              { session }
            );
            kasTunai.saldo = newSaldo;
          }

          // Update pool Cash Plus & Minus (logika tidak diubah)
          if (uangPlusSetorAmount > 0) {
            ks.totalCashPlus = Math.max(0, ks.totalCashPlus - uangPlusSetorAmount);
            ks.lastResetCashPlus = new Date();
            ks.lastResetBy = req.user._id;
          }

          const effectiveCashMinus = Math.max(0, cashMinus - cashPlusUsedAmount);
          const netSelisihProduk = cashPlus - effectiveCashMinus;
          if (netSelisihProduk > 0) {
            ks.totalCashPlus += netSelisihProduk;
          } else if (netSelisihProduk < 0) {
            ks.totalCashMinus += Math.abs(netSelisihProduk);
          }
          if (cashPlusUsedAmount > 0) ks.totalCashPlus = Math.max(0, ks.totalCashPlus - cashPlusUsedAmount);
          await ks.save({ session });

          const [created] = await ClosingKas.create([{
            type: 'produk', shift: shift || 'full',
            produkItems: processedItems,
            totalSelisihProduk: processedItems.filter(p => p.selisih !== 0).length,
            cashPlus, cashMinus, netCash: cashPlus - cashMinus,
            uangPlusSetor: uangPlusSetorAmount,
            uangPlusReset: uangPlusSetorAmount > 0,
            cashPlusUsed: cashPlusUsedAmount,
            catatan, createdBy: req.user._id, createdByName: req.user.name,
            cabang: req.user.cabang?._id || req.user.cabang || null,
            saldoSistem: 0, totalFisik: 0, selisih: 0, statusSelisih: 'sesuai',
            totalPemasukanCash: 0, totalPengeluaranCash: 0,
            totalTransaksiCash: 0, jumlahTransaksi: 0, totalQris: 0, totalTransfer: 0,
          }], { session });
          closingDoc = created;
        });

        return res.status(201).json({ success: true, data: closingDoc });
      } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
      } finally {
        await session.endSession();
      }
    }

    // ── CLOSING CASH ──────────────────────────────────────
    const {
      tanggal, shift, uangFisik, totalFisik, saldoSistem,
      totalPemasukanCash, totalPengeluaranCash, totalTransaksiCash,
      jumlahTransaksi, catatan, catatanSelisih, totalQris, totalTransfer
    } = req.body;

    const selisih = totalFisik - saldoSistem;
    const statusSelisih = selisih === 0 ? 'sesuai' : selisih > 0 ? 'lebih' : 'kurang';
    const cashPlus  = selisih > 0 ? selisih : 0;
    const cashMinus = selisih < 0 ? Math.abs(selisih) : 0;
    const netCash   = cashPlus - cashMinus;

    // FIXED: Kas sistem hanya diubah jika uang laci KURANG dari sistem
    // Lebih → kas sistem tetap, selisih masuk cashPlus
    // Kurang → kas sistem ikut turun ke nilai laci, selisih masuk cashMinus
    // FIXED: Prioritaskan tunai+cabang dulu, baru fallback ke tunai-kode
    // FIXED: Konversi cabang ke ObjectId agar query MongoDB cocok
    const cabangQ2 = req.cabangFilter || {};
    const cabangIdRaw = cabangQ2.cabang;
    const cabangObjId = cabangIdRaw ? (mongoose.Types.ObjectId.isValid(cabangIdRaw) ? new mongoose.Types.ObjectId(String(cabangIdRaw)) : cabangIdRaw) : null;
    // FIXED: Support cabang tersimpan sebagai String atau ObjectId
    const cabangStr = cabangIdRaw ? String(cabangIdRaw) : null;
    const kasTunai = cabangObjId
      ? await Saldo.findOne({ akunId: 'tunai', $or: [{ cabang: cabangObjId }, { cabang: cabangStr }] })
        || await Saldo.findOne({ akunId: `tunai-${(req.user.cabang?.kode||'').toLowerCase()}` })
      : await Saldo.findOne({ akunId: `tunai-${(req.user.cabang?.kode||'').toLowerCase()}` });
    const saldoKasSebelum = kasTunai?.saldo || 0;

    if (kasTunai && cashMinus > 0) {
      // FIXED: Pakai updateOne langsung agar tidak trigger validasi mutasi lama
      await Saldo.updateOne(
        { _id: kasTunai._id },
        {
          $set: { saldo: totalFisik },
          $push: {
            mutasi: {
              type: 'keluar',
              amount: cashMinus,
              keterangan: `Closing Cash ${shift} — Kekurangan kas Rp ${cashMinus.toLocaleString('id-ID')}`,
              saldoBefore: saldoKasSebelum,
              saldoAfter: totalFisik,
              createdBy: req.user._id,
              date: new Date()
            }
          }
        }
      );
    }
    // Jika lebih → kas sistem tetap, tidak ada update saldo

    // Update kumulatif Cash Plus & Minus
    const cabangIdForKs = req.user.cabang?._id || req.user.cabang || null;
    const ks = await getKasSummary(cabangIdForKs);
    ks.totalCashPlus  += cashPlus;
    ks.totalCashMinus += cashMinus;
    await ks.save();

    const closing = await ClosingKas.create({
      type: 'cash', tanggal: tanggal || new Date(), shift,
      saldoSistem, totalPemasukanCash, totalPengeluaranCash,
      totalTransaksiCash, jumlahTransaksi,
      totalQris: totalQris || 0, totalTransfer: totalTransfer || 0,
      uangFisik, totalFisik, selisih, statusSelisih,
      cashPlus, cashMinus, netCash,
      catatan, catatanSelisih,
      saldoKasSebelum, saldoKasSetelah: totalFisik,
      createdBy: req.user._id, createdByName: req.user.name, cabang: req.user.cabang?._id || req.user.cabang || null,
    });

    res.status(201).json({ success: true, data: closing });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getRiwayat = async (req, res) => {
  try {
    const { page = 1, limit = 50, type } = req.query;
    const skip = (page - 1) * limit;
    const cabangQ = req.cabangFilter || {};
    const query = { ...cabangQ, ...(type && type !== 'semua' ? { type } : {}) };
    const [data, total] = await Promise.all([
      ClosingKas.find(query).sort('-createdAt').skip(skip).limit(Number(limit)),
      ClosingKas.countDocuments(query)
    ]);
    res.json({ success: true, data, total, pages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getDetail = async (req, res) => {
  try {
    const closing = await ClosingKas.findById(req.params.id);
    if (!closing) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });
    res.json({ success: true, data: closing });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// GET kumulatif Cash Plus & Minus
exports.getKasSummary = async (req, res) => {
  try {
    const cabangIdForKs = req.user.cabang?._id || req.user.cabang || null;
    const ks = await getKasSummary(cabangIdForKs);
    res.json({ success: true, data: ks });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// POST reset Cash Minus (tutup buku bulanan)
exports.resetCashMinus = async (req, res) => {
  try {
    const cabangIdForKs = req.user.cabang?._id || req.user.cabang || null;
    const ks = await getKasSummary(cabangIdForKs);
    const prevMinus = ks.totalCashMinus;
    const prevPlus  = ks.totalCashPlus;
    ks.totalCashMinus = 0;
    ks.totalCashPlus  = 0;
    ks.lastResetCashMinus = new Date();
    ks.lastResetBy = req.user._id;
    await ks.save();
    res.json({
      success: true,
      message: `Tutup buku berhasil. Cash Plus Rp ${prevPlus.toLocaleString('id-ID')} & Cash Minus Rp ${prevMinus.toLocaleString('id-ID')} direset ke 0`,
      data: ks
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};