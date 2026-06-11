const Pembelian = require('../models/Pembelian');
const Product = require('../models/Product');
const Saldo = require('../models/Saldo');
const { StockLog } = require('../models/index');

// GET semua pembelian
exports.getAll = async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const skip = (page - 1) * limit;
    const cabangQ = req.cabangFilter || {};
    const query = search ? {
      ...cabangQ,
      $or: [
        { nomorPO: { $regex: search, $options: 'i' } },
        { supplier: { $regex: search, $options: 'i' } },
      ]
    } : { ...cabangQ };
    const [data, total] = await Promise.all([
      Pembelian.find(query).sort('-tanggal').skip(skip).limit(Number(limit)),
      Pembelian.countDocuments(query)
    ]);
    res.json({ success: true, data, total, pages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// POST buat pembelian baru
exports.create = async (req, res) => {
  try {
    const { items, supplier, tanggal, catatan } = req.body;
    if (!items || items.length === 0) return res.status(400).json({ success: false, message: 'Tidak ada item' });

    const processedItems = [];
    let totalHarga = 0;
    let totalItem = 0;
    const peringatanHarga = [];

    for (const item of items) {
      const product = await Product.findById(item.productId);
      if (!product) continue;

      const hargaModalLama = product.currentPurchasePrice || product.purchasePrice || 0;
      const hargaModalBaru = parseFloat(item.hargaModalBaru);
      const selisihModal = hargaModalBaru - hargaModalLama;
      const perluUpdateHarga = Math.abs(selisihModal) > 0;
      const subtotal = hargaModalBaru * item.jumlah;

      processedItems.push({
        product: product._id,
        productCode: product.code,
        productName: product.name,
        jumlah: item.jumlah,
        hargaModalBaru,
        hargaModalLama,
        hargaJualSekarang: product.sellPrice,
        selisihModal,
        perluUpdateHarga,
        subtotal,
      });

      totalHarga += subtotal;
      totalItem += item.jumlah;

      if (perluUpdateHarga) {
        peringatanHarga.push({
          productId: product._id,
          productName: product.name,
          productCode: product.code,
          hargaJualSekarang: product.sellPrice,
          hargaModalLama,
          hargaModalBaru,
          selisihModal,
        });
      }

      // Tambah stok dengan batch baru
      product.stock += item.jumlah;
      product.purchasePrice = hargaModalBaru; // update harga modal
      if (!product.stockBatches) product.stockBatches = [];
      product.stockBatches.push({
        quantity: item.jumlah,
        remainingQty: item.jumlah,
        purchasePrice: hargaModalBaru,
        receivedDate: tanggal ? new Date(tanggal) : new Date(),
      });
      product.markModified('stockBatches');
      await product.save();

      // Log stok
      await StockLog.create({
        product: product._id,
        productCode: product.code,
        productName: product.name,
        type: 'masuk',
        quantity: item.jumlah,
        notes: `Pembelian${supplier ? ' dari ' + supplier : ''} | Modal: Rp ${hargaModalBaru.toLocaleString('id-ID')}`,
        createdBy: req.user._id,
      });
    }

    const cabangId = req.user.role === 'superadmin' ? null : (req.user.cabang?._id || req.user.cabang || null);
    const pembelian = await Pembelian.create({
  items: processedItems,
  supplier,
  tanggal: tanggal || new Date(),
  totalItem,
  totalHarga,
  catatan,
  createdBy: req.user._id,
  createdByName: req.user.name,
  cabang: cabangId,
});

    res.status(201).json({
      success: true,
      data: pembelian,
      peringatanHarga,
      message: `Pembelian ${pembelian.nomorPO} berhasil disimpan`
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// GET detail
exports.getDetail = async (req, res) => {
  try {
    const data = await Pembelian.findById(req.params.id);
    if (!data) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// POST update harga jual produk setelah peringatan
exports.updateHargaJual = async (req, res) => {
  try {
    const { updates } = req.body; // [{ productId, hargaJualBaru }]
    for (const u of updates) {
      await Product.findByIdAndUpdate(u.productId, { sellPrice: u.hargaJualBaru });
    }
    res.json({ success: true, message: 'Harga jual berhasil diupdate' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// POST batalkan pembelian
exports.batalkan = async (req, res) => {
  try {
    const { alasan } = req.body;
    const pembelian = await Pembelian.findById(req.params.id);
    if (!pembelian) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });
    if (pembelian.isBatal) return res.status(400).json({ success: false, message: 'Pembelian sudah dibatalkan' });

    // Kembalikan stok
    for (const item of pembelian.items) {
      const product = await Product.findById(item.product);
      if (!product) continue;

      product.stock -= item.jumlah;
      if (product.stock < 0) product.stock = 0;

      // Hapus batch yang ditambahkan
      if (product.stockBatches?.length > 0) {
        let sisa = item.jumlah;
        for (let i = product.stockBatches.length - 1; i >= 0 && sisa > 0; i--) {
          const ambil = Math.min(product.stockBatches[i].remainingQty, sisa);
          product.stockBatches[i].remainingQty -= ambil;
          sisa -= ambil;
        }
        product.stockBatches = product.stockBatches.filter(b => b.remainingQty > 0);
      }
      product.markModified('stockBatches');
      await product.save();

      await StockLog.create({
        product: product._id,
        productCode: item.productCode,
        productName: item.productName,
        type: 'keluar',
        quantity: item.jumlah,
        notes: `Batal Pembelian ${pembelian.nomorPO}${alasan ? ': ' + alasan : ''}`,
        createdBy: req.user._id,
      });
    }

    pembelian.isBatal = true;
    pembelian.alasanBatal = alasan || '';
    pembelian.batalBy = req.user._id;
    pembelian.batalAt = new Date();
    await pembelian.save();

    res.json({ success: true, message: `Pembelian ${pembelian.nomorPO} berhasil dibatalkan` });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
// PUT edit pembelian (admin only)
exports.edit = async (req, res) => {
  try {
    const { supplier, catatan, tanggal, items } = req.body;
    const pembelian = await Pembelian.findById(req.params.id);
    if (!pembelian) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });
    if (pembelian.isBatal) return res.status(400).json({ success: false, message: 'Pembelian yang dibatalkan tidak bisa diedit' });

    // Update field dasar
    if (supplier !== undefined) pembelian.supplier = supplier;
    if (catatan !== undefined) pembelian.catatan = catatan;
    if (tanggal !== undefined) pembelian.tanggal = new Date(tanggal);

    // Update items jika dikirim
    if (items && Array.isArray(items)) {
      // Proses setiap item lama — rollback stok dulu
      for (const oldItem of pembelian.items) {
        const product = await Product.findById(oldItem.product);
        if (!product) continue;

        // Cek apakah item ini masih ada di items baru
        const newItem = items.find(i => i.product === String(oldItem.product));

        if (!newItem) {
          // Item dihapus — kurangi stok kembali
          product.stock -= oldItem.jumlah;
          if (product.stock < 0) product.stock = 0;
          await StockLog.create({
            product: product._id, productCode: oldItem.productCode, productName: oldItem.productName,
            type: 'keluar', quantity: oldItem.jumlah,
            notes: `Edit Pembelian ${pembelian.nomorPO}: Item dihapus`,
            createdBy: req.user._id,
          });
        } else {
          // Item masih ada — hitung selisih jumlah
          const selisihJumlah = newItem.jumlah - oldItem.jumlah;
          if (selisihJumlah !== 0) {
            product.stock += selisihJumlah;
            if (product.stock < 0) product.stock = 0;
            await StockLog.create({
              product: product._id, productCode: oldItem.productCode, productName: oldItem.productName,
              type: selisihJumlah > 0 ? 'masuk' : 'keluar',
              quantity: Math.abs(selisihJumlah),
              notes: `Edit Pembelian ${pembelian.nomorPO}: Jumlah diubah`,
              createdBy: req.user._id,
            });
          }
          // Update harga modal produk jika berubah
          if (newItem.hargaModalBaru !== oldItem.hargaModalBaru) {
            product.purchasePrice = newItem.hargaModalBaru;
          }
        }
        await product.save();
      }

      // Rebuild items array
      const updatedItems = [];
      let totalHarga = 0;
      let totalItem = 0;

      for (const ni of items) {
        const product = await Product.findById(ni.product);
        if (!product) continue;
        const subtotal = ni.hargaModalBaru * ni.jumlah;
        updatedItems.push({
          product: product._id,
          productCode: product.code,
          productName: product.name,
          jumlah: ni.jumlah,
          hargaModalBaru: ni.hargaModalBaru,
          hargaModalLama: ni.hargaModalLama || ni.hargaModalBaru,
          hargaJualSekarang: product.sellPrice,
          selisihModal: ni.hargaModalBaru - (ni.hargaModalLama || ni.hargaModalBaru),
          perluUpdateHarga: false,
          subtotal,
        });
        totalHarga += subtotal;
        totalItem += ni.jumlah;
      }

      pembelian.items = updatedItems;
      pembelian.totalHarga = totalHarga;
      pembelian.totalItem = totalItem;
    }

    await pembelian.save();
    res.json({ success: true, data: pembelian, message: `Pembelian ${pembelian.nomorPO} berhasil diupdate` });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
