const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const { earnPointsAfterTransaction } = require('./pointController');
const Product = require('../models/Product');
const Saldo = require('../models/Saldo');
const { Customer, Finance, StockLog } = require('../models/index');

// Helper: kurangi stok FIFO
// FIXED: fungsi sebelumnya nested (fungsi di dalam fungsi) dan tidak punya fallback
// jika stockBatches kosong padahal stock > 0 → error "tidak mencukupi" palsu
async function deductStockFIFO(product, qty) {
  // Fallback: jika batch kosong tapi stock ada (misal setelah import lama / void fix)
  // buat 1 batch dummy agar FIFO bisa jalan
  if ((!product.stockBatches || product.stockBatches.length === 0) && product.stock > 0) {
    product.stockBatches = [{
      quantity: product.stock,
      remainingQty: product.stock,
      purchasePrice: product.purchasePrice || 0,
      receivedDate: new Date(),
      notes: 'Batch otomatis (fallback)'
    }];
  }

  let remaining = qty;
  let totalCost = 0;
  let totalQty  = 0;

  for (let i = 0; i < product.stockBatches.length && remaining > 0; i++) {
    const batch = product.stockBatches[i];
    if (batch.remainingQty <= 0) continue;
    const take = Math.min(batch.remainingQty, remaining);
    totalCost += take * batch.purchasePrice;
    totalQty  += take;
    batch.remainingQty -= take;
    remaining -= take;
  }

  if (remaining > 0) throw new Error(`Stok ${product.name} tidak mencukupi`);

  product.stockBatches = product.stockBatches.filter(b => b.remainingQty > 0);
  product.stock -= qty;

  return { avgCost: totalQty > 0 ? totalCost / totalQty : product.purchasePrice || 0 };
}

exports.createTransaction = async (req, res) => {
  const { items, customerName, customerPhone, customerId, paymentMethod, amountPaid, discount, notes, type, isGrosir } = req.body;
  const session = await mongoose.startSession();
  let transaction;
  let earnedPoints = 0;

  try {
    await session.withTransaction(async () => {
      const processedItems = [];
      let subtotal = 0;
      let totalProfit = 0;

      for (const item of items) {
        let purchasePrice = 0;
        let productData = null;

        const isRealProduct = item.productId &&
          !item.productId.toString().startsWith('d-') &&
          !item.productId.toString().startsWith('trf-') &&
          !item.productId.toString().startsWith('tt-') &&
          !item.productId.toString().startsWith('transfer-') &&
          !item.productId.toString().startsWith('digital-') &&
          !item.productId.toString().startsWith('jasa-');

        if (isRealProduct) {
          const product = await Product.findById(item.productId).session(session);
          if (!product) throw new Error(`Produk ${item.productName} tidak ditemukan`);

          if (product.type === 'fisik') {
            const { avgCost } = await deductStockFIFO(product, item.quantity);
            purchasePrice = avgCost;
            await product.save({ validateBeforeSave: false, session });

            await StockLog.create([{
              product: product._id, productCode: product.code, productName: product.name,
              type: 'keluar', quantity: item.quantity, notes: 'Terjual', createdBy: req.user._id
            }], { session });
          } else {
            purchasePrice = product.purchasePrice;
          }
          productData = product;
        } else {
          purchasePrice = item.purchasePrice || 0;
          // Untuk jasa, modal = 0, profit = sellPrice penuh
          if (item.type === 'jasa') {
            purchasePrice = 0;
          }
        }

        // Mode Grosir: untuk produk fisik, pakai hargaGrosir sebagai harga jual
        const itemType = productData?.type || item.type;
        const effectiveSellPrice = (isGrosir === true && itemType === 'fisik' && (productData?.hargaGrosir || item.hargaGrosir))
          ? (productData?.hargaGrosir || item.hargaGrosir)
          : item.sellPrice;

        const itemSubtotal = effectiveSellPrice * item.quantity;
        // Untuk tarik_tunai, profit = fee saja (bukan sellPrice - nominal tarik)
        const itemProfit = item.category === 'tarik_tunai'
          ? (effectiveSellPrice * item.quantity) + (item.cashback || 0)
          : itemSubtotal - (purchasePrice * item.quantity) + (item.cashback || 0);

        processedItems.push({
          product: productData?._id,
          productCode: productData?.code || item.productCode,
          productName: item.productName,
          category: productData?.category || item.category,
          type: productData?.type || item.type,
          quantity: item.quantity,
          sellPrice: effectiveSellPrice,
          purchasePrice,
          subtotal: itemSubtotal,
          profit: itemProfit,
          targetNumber: item.targetNumber,
          notes: item.notes,
          cashback: item.cashback || 0,

          // Simpan data saldo digital
          sumberDana: item.sumberDana || null,
          sumberDanaLabel: item.sumberDanaLabel || null,
          sumberDanaIcon: item.sumberDanaIcon || null,
          modalAmount: item.modalAmount || null,
          transferData: item.transferData || null,
          pointValue: productData?.pointValue || 0, // poin custom per produk
        });

        subtotal += itemSubtotal;
        totalProfit += itemProfit;
      }

      const discountAmt = discount || 0;
      const total = subtotal - discountAmt;
      const change = amountPaid ? amountPaid - total : 0;

      const cabangId = req.user.role === 'superadmin'
        ? (req.body.cabang || null)
        : (req.user.cabang?._id || req.user.cabang || null);

      // Model.create dengan session HARUS pakai array form
      const [tx] = await Transaction.create([{
        items: processedItems,
        customerName: customerName || 'Umum',
        customerPhone,
        customer: customerId,
        subtotal,
        discount: discountAmt,
        total,
        totalProfit,
        paymentMethod: paymentMethod || 'cash',
        paymentStatus: paymentMethod === 'hutang' ? 'hutang' : 'lunas',
        amountPaid,
        change: change > 0 ? change : 0,
        transferData: req.body.transferData || null,
        type: type || 'penjualan',
        isGrosir: isGrosir === true,
        cabang: cabangId,
        cashier: req.user._id,
        cashierName: req.user.name,
        notes
      }], { session });
      transaction = tx;

      // Update customer data
      if (customerId) {
        await Customer.findByIdAndUpdate(customerId, {
          $inc: { totalTransactions: 1, totalSpent: total }
        }, { session });
      }

      // ── Update Kas Tunai untuk pembayaran cash ────────────────
      if (paymentMethod === 'cash') {
        const kasTunai = await Saldo.findOne({ akunId: { $regex: '^tunai' }, ...(req.cabangFilter || {}) }).session(session);
        if (kasTunai) {
          const sb = kasTunai.saldo;
          kasTunai.saldo += total;
          kasTunai.mutasi.push({
            type: 'masuk',
            amount: total,
            keterangan: `Transaksi tunai ${transaction.invoiceNumber}`,
            saldoBefore: sb,
            saldoAfter: kasTunai.saldo,
            createdBy: req.user._id
          });
          await kasTunai.save({ validateBeforeSave: false, session });
        }
      }

      // ── Kurangi Kas Tunai untuk transaksi Tarik Tunai ─────────
      // Tarik tunai: kasir keluarkan uang tunai ke pelanggan → kas tunai BERKURANG sebesar nominal
      const tarikItems = transaction.items.filter(i => i.category === 'tarik_tunai');
      if (tarikItems.length > 0) {
        const kasTunai = await Saldo.findOne({ akunId: { $regex: '^tunai' }, ...(req.cabangFilter || {}) }).session(session);
        if (kasTunai) {
          for (const ti of tarikItems) {
            const nominal = ti.modalAmount || 0;
            if (nominal > 0) {
              const sb = kasTunai.saldo;
              kasTunai.saldo -= nominal;
              kasTunai.mutasi.push({
                type: 'keluar',
                amount: nominal,
                keterangan: `Tarik Tunai ${transaction.invoiceNumber} — kas keluar ke pelanggan`,
                saldoBefore: sb,
                saldoAfter: kasTunai.saldo,
                createdBy: req.user._id
              });
            }
          }
          await kasTunai.save({ validateBeforeSave: false, session });
        }
      }

      // Catat hutang jika pembayaran hutang
      if (paymentMethod === 'hutang') {
        await Finance.create([{
          type: 'piutang',
          category: 'Hutang Pelanggan',
          description: `Hutang dari transaksi ${transaction.invoiceNumber}`,
          amount: total,
          relatedParty: customerName,
          reference: transaction.invoiceNumber,
          createdBy: req.user._id
        }], { session });
      }
    });

    // ── Post-commit: earn poin (di luar transaction — kegagalan tidak perlu rollback state utama) ──
    if (customerId && type !== 'hutang') {
      try {
        earnedPoints = await earnPointsAfterTransaction(
          customerId, transaction._id, transaction.items, req.user._id, req.cabangFilter
        );
      } catch (e) { /* skip jika gagal earn poin */ }
    }

    const io = req.app.get('io');
    io?.emit('newTransaction', { transaction });
    io?.emit('stockUpdated');

    const populated = await Transaction.findById(transaction._id).populate('customer', 'name phone');

    // ── Step 5: Kirim WA notifikasi via Fonnte (NON-BLOCKING) ──
    // Transaksi selesai dulu, WA dikirim di background
    res.status(201).json({ success: true, data: populated, earnedPoints });

    // Fire and forget - tidak mempengaruhi response transaksi
    if (earnedPoints > 0 && customerId) {
      setTimeout(async () => {
        try {
          const { Settings } = require('../models/index');
          const cabangQ = req.cabangFilter || {};
          const settings = await Settings.findOne(cabangQ) || await Settings.findOne();
          const fonnte = settings?.fonnteSettings;

          if (!fonnte?.enabled || !fonnte?.token || !fonnte?.device) return;

          const customer = await require('../models/index').Customer.findById(customerId).select('name phone points');
          const phone = customer?.phone?.replace(/^0/, '62').replace(/[^0-9]/g, '');
          if (!phone || phone.length < 10) return;

          // Render rincian transaksi
          const fmt = (n) => `Rp ${Number(n||0).toLocaleString('id-ID')}`;
          let rincian = '';
          if (transaction.type === 'tarik_tunai') {
            const nominal = transaction.items?.[0]?.subtotal || 0;
            const admin   = transaction.total - nominal;
            rincian = `💸 Tarik Tunai\nNominal: ${fmt(nominal)}\nAdmin: ${fmt(admin)}`;
          } else {
            const lines = (transaction.items || []).map(item => {
              const qty = item.quantity || 1;
              return `- ${item.productName} x${qty} = ${fmt(item.subtotal)}`;
            });
            rincian = `🧾 Rincian Transaksi:\n${lines.join('\n')}`;
          }

          // Render template pesan
          const defaultTemplate = 'Halo {nama}! 👋\nTerima kasih sudah berbelanja di {toko}.\n\n{rincian}\n\n💰 Total: {total}\n⭐ Poin didapat: +{poin} poin\n🏆 Total poin kamu: {totalPoin} poin\n\nSampai jumpa lagi! 🙏';
          const template = fonnte.template || defaultTemplate;
          const pesan = template
            .replace('{nama}',      customer.name || 'Pelanggan')
            .replace('{toko}',      settings.storeName || 'Toko Kami')
            .replace('{rincian}',   rincian)
            .replace('{total}',     fmt(transaction.total))
            .replace('{poin}',      `+${earnedPoints}`)
            .replace('{totalPoin}', (customer.points || 0).toLocaleString('id-ID'))
            .replace('{invoice}',   transaction.invoiceNumber || '');

          // Kirim ke Fonnte API
          const https = require('https');
          const postData = JSON.stringify({ target: phone, message: pesan, device: fonnte.device });
          const options = {
            hostname: 'api.fonnte.com',
            path: '/send',
            method: 'POST',
            headers: {
              'Authorization': fonnte.token,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData)
            }
          };
          const req2 = https.request(options, (res2) => {
            let data = '';
            res2.on('data', d => data += d);
            res2.on('end', () => console.log('Fonnte WA sent:', phone, data));
          });
          req2.on('error', e => console.error('Fonnte error:', e.message));
          req2.write(postData);
          req2.end();
        } catch (e) { console.error('WA notification error:', e.message); }
      }, 15000); // delay 15 detik di background
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  } finally {
    await session.endSession();
  }
};

// GET riwayat transaksi yang dibatalkan (admin/owner only)
exports.getVoidedTransactions = async (req, res) => {
  try {
    const { startDate, endDate, search, page = 1, limit = 20 } = req.query;
    let query = { isVoid: true, ...(req.cabangFilter || {}) };

    if (startDate || endDate) {
      query.voidAt = {};
      if (startDate) query.voidAt.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.voidAt.$lte = end;
      }
    }
    if (search) query.$or = [
      { invoiceNumber: { $regex: search, $options: 'i' } },
      { customerName: { $regex: search, $options: 'i' } },
      { voidByName: { $regex: search, $options: 'i' } }
    ];

    const skip = (page - 1) * limit;
    const [transactions, total] = await Promise.all([
      Transaction.find(query)
        .sort('-voidAt')
        .skip(skip)
        .limit(Number(limit))
        .select('invoiceNumber transactionDate voidAt voidReason voidByName cashierName customerName total paymentMethod isGrosir items'),
      Transaction.countDocuments(query)
    ]);

    res.json({ success: true, data: transactions, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getTransactions = async (req, res) => {
  try {
    const { startDate, endDate, paymentMethod, type, search, page = 1, limit = 20, profitMinus, year, month } = req.query;
    let query = { isVoid: false, ...(req.cabangFilter || {}) };
    // FIXED: Filter transaksi profit minus (anomali)
    if (profitMinus === 'true') query.totalProfit = { $lt: 0 };

    // Filter periode: year/month lebih spesifik, jadi kalau dikirim
    // mereka menang atas startDate/endDate. Kalau bukan angka valid, diabaikan.
    const yearNum  = Number.parseInt(year, 10);
    const monthNum = Number.parseInt(month, 10);
    const hasYear  = Number.isInteger(yearNum) && yearNum >= 1000 && yearNum <= 9999;
    const hasMonth = Number.isInteger(monthNum) && monthNum >= 1 && monthNum <= 12;

    if (hasYear) {
      const startMonthIdx = hasMonth ? monthNum - 1 : 0;
      const endMonthIdx1  = hasMonth ? monthNum : 12; // "day 0 of next month" trick
      query.transactionDate = {
        $gte: new Date(yearNum, startMonthIdx, 1, 0, 0, 0, 0),
        $lte: new Date(yearNum, endMonthIdx1, 0, 23, 59, 59, 999),
      };
    } else if (startDate || endDate) {
      query.transactionDate = {};
      if (startDate) query.transactionDate.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.transactionDate.$lte = end;
      }
    }
    if (paymentMethod) query.paymentMethod = paymentMethod;
    if (type) query.type = type;
    if (search) query.$or = [
      { invoiceNumber: { $regex: search, $options: 'i' } },
      { customerName: { $regex: search, $options: 'i' } }
    ];

    const skip = (page - 1) * limit;
    const [transactions, total] = await Promise.all([
      Transaction.find(query).sort('-transactionDate').skip(skip).limit(Number(limit)).populate('customer', 'name phone'),
      Transaction.countDocuments(query)
    ]);

    res.json({ success: true, data: transactions, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET jumlah transaksi anomali hari ini (untuk widget dashboard)
exports.getAnomalyCount = async (req, res) => {
  try {
    const start = new Date(); start.setHours(0,0,0,0);
    const end   = new Date(); end.setHours(23,59,59,999);
    const query = {
      isVoid: false,
      ...(req.cabangFilter || {}),
      transactionDate: { $gte: start, $lte: end },
      totalProfit: { $lt: 0 }
    };
    const count = await Transaction.countDocuments(query);
    const txs   = await Transaction.find(query).select('invoiceNumber totalProfit total transactionDate items').limit(10).sort('-transactionDate');
    res.json({ success: true, count, data: txs });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getTransaction = async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.id).populate('customer cashier', 'name phone');
    if (!transaction) return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan' });
    res.json({ success: true, data: transaction });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.voidTransaction = async (req, res) => {
  const { voidReason } = req.body;

  // ── Validasi role karyawan: hanya boleh void transaksi hari ini (di luar transaction) ──
  const isPrivileged = ['superadmin', 'owner', 'admin'].includes(req.user.role);
  if (!isPrivileged) {
    try {
      const txCheck = await Transaction.findOne({ _id: req.params.id, isVoid: false });
      if (!txCheck) return res.status(400).json({ success: false, message: 'Transaksi tidak ditemukan atau sudah dibatalkan' });

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const txDate = new Date(txCheck.transactionDate);
      txDate.setHours(0, 0, 0, 0);

      if (txDate < today) {
        return res.status(403).json({ success: false, message: 'Karyawan hanya bisa membatalkan transaksi hari ini' });
      }
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  const session = await mongoose.startSession();
  let transaction;
  let raceConflict = false;

  try {
    await session.withTransaction(async () => {
      // Atomic check & lock — cegah double void race condition
      transaction = await Transaction.findOneAndUpdate(
        { _id: req.params.id, isVoid: false },
        { $set: { isVoid: true, voidReason, voidAt: new Date(), voidBy: req.user._id, voidByName: req.user.name } },
        { new: true, session }
      );
      if (!transaction) {
        raceConflict = true;
        return; // no-op → transaction commit (tidak ada perubahan yang terjadi)
      }

      for (const item of transaction.items) {

        // ── FISIK: kembalikan stok + stockBatch ──────────────
        if (item.type === 'fisik' && item.product) {
          const returnedPurchasePrice = item.purchasePrice || 0;
          await Product.findByIdAndUpdate(
            item.product,
            {
              $inc: { stock: item.quantity },
              $push: {
                stockBatches: {
                  quantity: item.quantity,
                  remainingQty: item.quantity,
                  purchasePrice: returnedPurchasePrice,
                  receivedDate: new Date(),
                  notes: `Retur void: ${voidReason}`
                }
              }
            },
            { session }
          );
          await StockLog.create([{
            product: item.product,
            productCode: item.productCode,
            productName: item.productName,
            type: 'masuk',
            quantity: item.quantity,
            notes: `Retur void: ${voidReason}`,
            createdBy: req.user._id
          }], { session });
        }

        // ── DIGITAL: kembalikan saldo ─────────────────────
        if (item.type === 'digital' && item.sumberDana) {

          if (item.category === 'tarik_tunai') {
            // Void tarik tunai:
            // → Kurangi saldo akun sumber (batalkan transfer masuk dari pelanggan)
            // → Tambah kas tunai kembali (uang balik ke kas)
            const nominalTarik = item.modalAmount || 0;

            if (nominalTarik > 0) {
              const akunSumber = await Saldo.findOne({ akunId: item.sumberDana, ...(req.cabangFilter||{}) }).session(session);
              if (akunSumber) {
                const sb = akunSumber.saldo;
                akunSumber.saldo -= nominalTarik;
                akunSumber.mutasi.push({
                  type: 'keluar',
                  amount: nominalTarik,
                  keterangan: `VOID Tarik Tunai | ${transaction.invoiceNumber}`,
                  saldoBefore: sb,
                  saldoAfter: akunSumber.saldo,
                  createdBy: req.user._id
                });
                await akunSumber.save({ validateBeforeSave: false, session });
              }

              const kasTunai = await Saldo.findOne({ akunId: { $regex: '^tunai' }, ...(req.cabangFilter||{}) }).session(session);
              if (kasTunai) {
                const sb = kasTunai.saldo;
                kasTunai.saldo += nominalTarik;
                kasTunai.mutasi.push({
                  type: 'masuk',
                  amount: nominalTarik,
                  keterangan: `VOID Tarik Tunai kembali | ${transaction.invoiceNumber}`,
                  saldoBefore: sb,
                  saldoAfter: kasTunai.saldo,
                  createdBy: req.user._id
                });
                await kasTunai.save({ validateBeforeSave: false, session });
              }
            }

          } else {
            // Void digital biasa (pulsa, kuota, ewallet, transfer, game, dll):
            // → Kembalikan modal ke saldo sumber
            const modalKembali = item.modalAmount || item.purchasePrice || 0;
            const cashbackKembali = item.cashback || 0;

            if (modalKembali > 0) {
              const akun = await Saldo.findOne({ akunId: item.sumberDana, cabang: req.user.cabang?._id || req.user.cabang }).session(session)
                      || await Saldo.findOne({ akunId: item.sumberDana, ...(req.cabangFilter || {}) }).session(session)
                      || await Saldo.findOne({ akunId: item.sumberDana }).session(session);
              if (akun) {
                const sb = akun.saldo;
                // Kembalikan modal
                akun.saldo += modalKembali;
                akun.mutasi.push({
                  type: 'masuk',
                  amount: modalKembali,
                  keterangan: `VOID ${item.productName}${item.targetNumber ? ' → ' + item.targetNumber : ''} | ${transaction.invoiceNumber}`,
                  saldoBefore: sb,
                  saldoAfter: akun.saldo,
                  createdBy: req.user._id
                });
                // Kurangi cashback yang sudah diterima
                if (cashbackKembali > 0) {
                  const sb2 = akun.saldo;
                  akun.saldo -= cashbackKembali;
                  akun.mutasi.push({
                    type: 'keluar',
                    amount: cashbackKembali,
                    keterangan: `VOID Cashback ${item.productName} | ${transaction.invoiceNumber}`,
                    saldoBefore: sb2,
                    saldoAfter: akun.saldo,
                    createdBy: req.user._id
                  });
                }
                await akun.save({ validateBeforeSave: false, session });
              }
            }
          }
        }
      }

      // ── Kembalikan saldo akun jika pembayaran transfer / qris ──
      if (['transfer', 'qris'].includes(transaction.paymentMethod) && transaction.transferData?.akunId) {
        const labelMetode = transaction.paymentMethod === 'qris' ? 'QRIS' : 'Transfer';
        const akunBank = await Saldo.findOne({ akunId: transaction.transferData.akunId, ...(req.cabangFilter||{}) }).session(session)
                      || await Saldo.findOne({ akunId: transaction.transferData.akunId }).session(session);
        if (akunBank) {
          const sb = akunBank.saldo;
          akunBank.saldo -= transaction.total; // kurangi (void = batalkan masuk tadi)
          akunBank.mutasi.push({
            type: 'keluar',
            amount: transaction.total,
            keterangan: `VOID ${labelMetode} | ${transaction.invoiceNumber}`,
            saldoBefore: sb,
            saldoAfter: akunBank.saldo,
            createdBy: req.user._id
          });
          await akunBank.save({ validateBeforeSave: false, session });
        }
      }
      if (transaction.paymentMethod === 'cash') {
        const kasTunai = await Saldo.findOne({ akunId: 'tunai', ...(req.cabangFilter||{}) }).session(session)
                      || await Saldo.findOne({ akunId: 'tunai' }).session(session);
        if (kasTunai) {
          const sb = kasTunai.saldo;
          kasTunai.saldo -= transaction.total;
          kasTunai.mutasi.push({
            type: 'keluar',
            amount: transaction.total,
            keterangan: `VOID Transaksi ${transaction.invoiceNumber}`,
            saldoBefore: sb,
            saldoAfter: kasTunai.saldo,
            createdBy: req.user._id
          });
          await kasTunai.save({ validateBeforeSave: false, session });
        }
      }

      // ── Batalkan poin member jika ada ────────────────────────
      if (transaction.customer) {
        const PointLog = require('../models/PointLog');

        // Cari log poin yang berasal dari transaksi ini
        const earnLog = await PointLog.findOne({
          transaction: transaction._id,
          type: 'earn'
        }).session(session);

        // Kurangi totalTransactions dan totalSpent
        await Customer.findByIdAndUpdate(transaction.customer, {
          $inc: {
            totalTransactions: -1,
            totalSpent: -(transaction.total || 0)
          }
        }, { session });

        if (earnLog && earnLog.points > 0) {
          const customer = await Customer.findById(transaction.customer).session(session);
          if (customer) {
            // Kurangi poin sebesar yang pernah didapat
            const pointsToDeduct = Math.min(earnLog.points, customer.points);
            customer.points      -= pointsToDeduct;
            customer.totalPoints -= pointsToDeduct;
            await customer.save({ session });

            // Catat di PointLog
            await PointLog.create([{
              customer: transaction.customer,
              type: 'expire',
              points: -pointsToDeduct,
              description: `Poin dibatalkan karena void transaksi ${transaction.invoiceNumber}`,
              transaction: transaction._id,
              createdBy: req.user._id,
            }], { session });
          }
        }
      }
    });

    if (raceConflict) {
      return res.status(400).json({ success: false, message: 'Transaksi tidak ditemukan atau sudah dibatalkan' });
    }

    const io = req.app.get('io');
    io?.emit('saldoUpdated');

    res.json({ success: true, message: 'Transaksi dibatalkan & saldo dikembalikan' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  } finally {
    await session.endSession();
  }
};

exports.getTodaySummary = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const cabangQ = req.cabangFilter || {};
    const transactions = await Transaction.find({
      transactionDate: { $gte: today, $lt: tomorrow },
      isVoid: false,
      type: 'penjualan',
      ...cabangQ
    });

    const summary = {
      totalTransactions: transactions.length,
      totalItems: transactions.reduce((s, t) => s + (t.items?.length || 0), 0),
      totalRevenue: transactions.reduce((s, t) => s + t.total, 0),
      totalProfit: transactions.reduce((s, t) => s + t.totalProfit, 0),
      totalCost: transactions.reduce((s, t) => s + (t.total - t.totalProfit), 0)
    };

    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET transaksi per sumber dana
exports.getTransaksiPerSumber = async (req, res) => {
  try {
    const { akunId } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const cabangQ = req.cabangFilter || {};

    const query = {
      'items.sumberDana': akunId,
      isVoid: false,
      type: 'penjualan',
      ...cabangQ
    };

    const transactions = await Transaction.find(query)
      .sort({ transactionDate: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const result = transactions.map(tx => ({
      _id: tx._id,
      invoiceNumber: tx.invoiceNumber,
      transactionDate: tx.transactionDate,
      customerName: tx.customerName,
      cashierName: tx.cashierName,
      items: tx.items.filter(i => i.sumberDana === akunId)
    }));

    const total = await Transaction.countDocuments(query);

    res.json({ success: true, data: result, total, pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// PUT edit nominal item transaksi
exports.editItemTransaksi = async (req, res) => {
  try {
    const { transactionId, itemId } = req.params;
    const { sellPrice, purchasePrice, cashback } = req.body;

    const transaction = await Transaction.findById(transactionId);
    if (!transaction) return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan' });

    const itemIndex = transaction.items.findIndex(i => i._id.toString() === itemId);
    if (itemIndex === -1) return res.status(404).json({ success: false, message: 'Item tidak ditemukan' });

    const item = transaction.items[itemIndex];
    const oldSellPrice   = item.sellPrice || 0;
    const oldModalAmount = item.modalAmount || item.purchasePrice || 0;
    const oldCashback    = item.cashback || 0;

    const newSellPrice   = parseFloat(sellPrice)    || oldSellPrice;
    const newModalAmount = parseFloat(purchasePrice) || oldModalAmount;
    const newCashback    = parseFloat(cashback)      || 0;

    const Saldo = require('../models/Saldo');

    // ── Update saldo sumber dana (modal berubah) ──────────
    if (item.sumberDana) {
      const akun = await Saldo.findOne({ akunId: item.sumberDana, ...(req.cabangFilter || {}) })
                    || await Saldo.findOne({ akunId: item.sumberDana });
      if (akun) {
        let totalSelisih = 0;

        if (item.category === 'tarik_tunai') {
          // Tarik tunai: nominal naik → saldo BERTAMBAH (customer bayar lebih)
          // nominal turun → saldo BERKURANG (customer bayar kurang)
          const selisihNominal  = newModalAmount - oldModalAmount;
          const selisihCashback = newCashback - oldCashback;
          totalSelisih = selisihNominal + selisihCashback;
        } else {
          // Transaksi biasa: modal naik → saldo BERKURANG
          const selisihModal    = oldModalAmount - newModalAmount;
          const selisihCashback = newCashback - oldCashback;
          totalSelisih = selisihModal + selisihCashback;
        }

        if (totalSelisih !== 0) {
          const sb = akun.saldo;
          akun.saldo += totalSelisih;
          akun.mutasi.push({
            type: totalSelisih >= 0 ? 'masuk' : 'keluar',
            amount: Math.abs(totalSelisih),
            keterangan: `Edit transaksi ${transaction.invoiceNumber} — penyesuaian modal/cashback`,
            saldoBefore: sb,
            saldoAfter: akun.saldo,
            createdBy: req.user._id
          });
          await akun.save({ validateBeforeSave: false });
        }
      }
    }

    // ── Update kas tunai jika bayar cash (harga jual berubah) ──
    const selisihHargaJual = newSellPrice - oldSellPrice;
    if (selisihHargaJual !== 0 && transaction.paymentMethod === 'cash') {
      const kasTunai = await Saldo.findOne({ akunId: { $regex: '^tunai' }, ...(req.cabangFilter||{}) });
      if (kasTunai) {
        const sb = kasTunai.saldo;
        kasTunai.saldo += selisihHargaJual;
        kasTunai.mutasi.push({
          type: selisihHargaJual >= 0 ? 'masuk' : 'keluar',
          amount: Math.abs(selisihHargaJual),
          keterangan: `Edit harga jual ${transaction.invoiceNumber} — penyesuaian kas tunai`,
          saldoBefore: sb,
          saldoAfter: kasTunai.saldo,
          createdBy: req.user._id
        });
        await kasTunai.save({ validateBeforeSave: false });
      }
    }

    // ── Update kas tunai untuk tarik_tunai (nominal berubah) ─
    // Tarik tunai: kasir keluarkan uang tunai ke pelanggan → kas tunai BERKURANG
    // Kalau nominal berubah, selisihnya harus dikurangi dari kas tunai
    if (item.category === 'tarik_tunai') {
      const selisihNominal = newModalAmount - oldModalAmount;
      if (selisihNominal !== 0) {
        const kasTunai = await Saldo.findOne({ akunId: { $regex: '^tunai' }, ...(req.cabangFilter||{}) });
        if (kasTunai) {
          const sb = kasTunai.saldo;
          kasTunai.saldo -= selisihNominal; // FIXED: kurangi (kas keluar ke pelanggan)
          kasTunai.mutasi.push({
            type: selisihNominal >= 0 ? 'keluar' : 'masuk',
            amount: Math.abs(selisihNominal),
            keterangan: `Edit tarik tunai ${transaction.invoiceNumber} — penyesuaian kas`,
            saldoBefore: sb,
            saldoAfter: kasTunai.saldo,
            createdBy: req.user._id
          });
          await kasTunai.save({ validateBeforeSave: false });
        }
      }
    }

    // ── Update saldo akun transfer/qris jika bayar transfer/qris ──
    if (selisihHargaJual !== 0 && ['transfer', 'qris'].includes(transaction.paymentMethod)) {
      // Cari akun tujuan dari mutasi saldo yang ada keterangan invoice ini
      const allSaldos = await Saldo.find({
        'mutasi.keterangan': { $regex: transaction.invoiceNumber }
      });
      for (const akun of allSaldos) {
        if (akun.akunId === 'tunai' || akun.akunId === item.sumberDana) continue;
        const sb = akun.saldo;
        akun.saldo += selisihHargaJual;
        akun.mutasi.push({
          type: selisihHargaJual >= 0 ? 'masuk' : 'keluar',
          amount: Math.abs(selisihHargaJual),
          keterangan: `Edit harga jual ${transaction.invoiceNumber} — penyesuaian saldo`,
          saldoBefore: sb,
          saldoAfter: akun.saldo,
          createdBy: req.user._id
        });
        await akun.save({ validateBeforeSave: false });
      }
    }

    // ── Update item transaksi ─────────────────────────────
    transaction.items[itemIndex].sellPrice    = newSellPrice;
    transaction.items[itemIndex].subtotal     = newSellPrice * item.quantity;
    transaction.items[itemIndex].purchasePrice= newModalAmount;
    transaction.items[itemIndex].modalAmount  = newModalAmount;
    transaction.items[itemIndex].cashback     = newCashback;
    transaction.items[itemIndex].profit       = item.category === 'tarik_tunai'
      ? newSellPrice + newCashback
      : (newSellPrice - newModalAmount) + newCashback;

    // ── Recalculate total transaksi ───────────────────────
    transaction.subtotal    = transaction.items.reduce((s, i) => s + i.subtotal, 0);
    transaction.total       = transaction.subtotal - (transaction.discount || 0);
    transaction.totalProfit = transaction.items.reduce((s, i) => s + (i.profit || 0), 0);

    await transaction.save({ validateBeforeSave: false });

    // ── Koreksi poin member jika ada customer ter-link ────
    if (transaction.customer) {
      try {
        const PointLog = require('../models/PointLog');
        const { Customer } = require('../models/index');

        // Cari log poin dari transaksi ini
        const existingLog = await PointLog.findOne({ transaction: transaction._id, type: 'earn' });
        if (existingLog) {
          const oldPoints = existingLog.points;

          // Hitung ulang poin dari totalProfit terbaru
          const settings = await require('../models/index').Settings.findOne(req.cabangFilter || {});
          const pointPer = settings?.pointSettings?.pointPerRupiah || 50;
          const newPoints = Math.floor(transaction.totalProfit / pointPer);

          const selisihPoin = newPoints - oldPoints;
          if (selisihPoin !== 0) {
            // Update log poin
            existingLog.points = newPoints;
            existingLog.description = `Poin transaksi ${transaction.invoiceNumber} (dikoreksi)`;
            await existingLog.save();

            // Update saldo poin customer
            await Customer.findByIdAndUpdate(transaction.customer, {
              $inc: { points: selisihPoin, totalPoints: selisihPoin }
            });
          }
        }
      } catch(e) { console.error('Gagal koreksi poin:', e.message); }
    }

    res.json({ success: true, data: transaction, message: 'Transaksi berhasil diupdate' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
// GET daftar hutang pelanggan (belum lunas)
exports.getHutangPelanggan = async (req, res) => {
  try {
    const cabangQ = req.cabangFilter || {};
    const { status } = req.query; // 'hutang' atau 'lunas' atau kosong = semua
    const query = {
      paymentMethod: 'hutang',
      isVoid: false,
      ...cabangQ,
      ...(status ? { paymentStatus: status } : {})
    };
    const data = await Transaction.find(query)
      .sort('-transactionDate')
      .select('invoiceNumber transactionDate customerName total paymentStatus paidAt paidBy isGrosir items');
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// POST bayar hutang pelanggan
exports.bayarHutang = async (req, res) => {
  const { Finance } = require('../models/index');
  const { metode = 'cash', akunId } = req.body; // metode: cash | transfer | qris
  const cabangQ = req.cabangFilter || {};

  // Validasi metode & akun tujuan SEBELUM mengubah state apapun
  if (!['cash', 'transfer', 'qris'].includes(metode)) {
    return res.status(400).json({ success: false, message: 'Metode pembayaran tidak valid' });
  }
  if ((metode === 'transfer' || metode === 'qris') && !akunId) {
    return res.status(400).json({ success: false, message: 'Akun tujuan wajib dipilih untuk pembayaran transfer/QRIS' });
  }

  const session = await mongoose.startSession();
  let invoiceNumber;
  try {
    await session.withTransaction(async () => {
      const transaction = await Transaction.findById(req.params.id).session(session);
      if (!transaction) throw { status: 404, message: 'Transaksi tidak ditemukan' };
      if (transaction.paymentStatus === 'lunas') throw { status: 400, message: 'Hutang sudah lunas' };
      if (transaction.isVoid) throw { status: 400, message: 'Transaksi sudah dibatalkan' };

      // Cari akun tujuan; wajib ada — jangan biarkan fail-silent
      const akun = metode === 'cash'
        ? await Saldo.findOne({ akunId: { $regex: '^tunai' }, ...cabangQ }).session(session)
        : await Saldo.findOne({ akunId, ...cabangQ }).session(session);
      if (!akun) {
        throw { status: 400, message: metode === 'cash' ? 'Akun Kas Tunai tidak ditemukan' : 'Akun tujuan tidak ditemukan' };
      }

      // Update status hutang + catat metode bayar
      transaction.paymentStatus  = 'lunas';
      transaction.paidAt         = new Date();
      transaction.paidBy         = req.user._id;
      transaction.paidWithMetode = metode;
      await transaction.save({ validateBeforeSave: false, session });

      // Tambah saldo + catat mutasi
      const sb = akun.saldo;
      akun.saldo += transaction.total;
      const label = metode === 'cash' ? 'Tunai' : metode === 'qris' ? 'QRIS' : 'Transfer';
      akun.mutasi.push({
        type: 'masuk',
        amount: transaction.total,
        keterangan: `Bayar Hutang (${label}) ${transaction.invoiceNumber} - ${transaction.customerName}`,
        refTransaksi: transaction.invoiceNumber,
        saldoBefore: sb,
        saldoAfter: akun.saldo,
        createdBy: req.user._id
      });
      await akun.save({ validateBeforeSave: false, session });

      // Update record piutang: catat akun tujuan supaya rollback saat delete/edit akurat
      await Finance.findOneAndUpdate(
        { description: { $regex: transaction.invoiceNumber }, type: 'piutang' },
        { isPaid: true, sumberDana: akun.akunId, sumberDanaName: akun.namaAkun, paidDate: new Date() },
        { session }
      );

      invoiceNumber = transaction.invoiceNumber;
    });

    const io = req.app.get('io');
    io?.emit('saldoUpdated');

    res.json({ success: true, message: `Hutang ${invoiceNumber} berhasil dilunasi` });
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ success: false, message: err.message });
    res.status(500).json({ success: false, message: err.message });
  } finally {
    await session.endSession();
  }
};
