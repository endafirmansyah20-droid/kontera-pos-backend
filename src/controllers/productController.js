const Product = require('../models/Product');
const { StockLog } = require('../models/index');

exports.getProducts = async (req, res) => {
  try {
    const { category, type, search, lowStock } = req.query;
    const cabangQ = req.cabangFilter || {};
    let query = { ...cabangQ };
    if (category) query.category = category;
    if (type) query.type = type;
    if (search) query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { code: { $regex: search, $options: 'i' } }
    ];
    if (lowStock === 'true') {
      const { Settings } = require('../models/index');
      const settings = await Settings.findOne();
      const minStockAlert = settings?.minStockAlert || 5;
      query.$expr = { $lte: ['$stock', { $ifNull: ['$minStock', minStockAlert] }] };
    }
    const products = await Product.find(query).sort('name');
    res.json({ success: true, data: products });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getProductByCode = async (req, res) => {
  try {
    const cabangQ = req.cabangFilter || {};
    const product = await Product.findOne({ code: req.params.code.toUpperCase(), ...cabangQ });
    if (!product) return res.status(404).json({ success: false, message: 'Produk tidak ditemukan' });
    res.json({ success: true, data: product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.createProduct = async (req, res) => {
  try {
    const { code, name, category, type, sellPrice, purchasePrice, stock, minStock, provider, denomination, description, unit } = req.body;

    const cabangQ = req.cabangFilter || {}; const existing = await Product.findOne({ code: code.toUpperCase(), ...cabangQ });
    if (existing) return res.status(400).json({ success: false, message: 'Kode produk sudah digunakan' });

    const productData = {
      code: code.toUpperCase(), name, category, type, sellPrice, minStock,
      provider, denomination, description, unit,
      cabang: req.user.role !== 'superadmin' ? req.user.cabang?._id : null,
    };

    if (type === 'fisik' && stock > 0 && purchasePrice) {
      productData.stock = stock;
      productData.stockBatches = [{ quantity: stock, remainingQty: stock, purchasePrice }];
    } else if (type === 'digital') {
      productData.purchasePrice = purchasePrice;
    }

    const product = await Product.create(productData);

    if (type === 'fisik' && stock > 0) {
      await StockLog.create({
        product: product._id, productCode: product.code, productName: product.name,
        type: 'masuk', quantity: stock, purchasePrice, notes: 'Stok awal', createdBy: req.user._id
      });
    }

    res.status(201).json({ success: true, data: product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Produk tidak ditemukan' });

    const fields = ['name', 'code', 'type', 'category', 'sellPrice', 'minStock', 'provider',
                    'denomination', 'description', 'unit', 'isActive', 'earnPoints', 'pointValue'];

    // Hanya update field yang dikirim (tidak undefined)
    fields.forEach(f => {
      if (req.body[f] !== undefined) product[f] = req.body[f];
    });

    // purchasePrice hanya untuk digital & jasa
    if (req.body.purchasePrice !== undefined && product.type !== 'fisik') {
      product.purchasePrice = req.body.purchasePrice;
    }

    // sellPrice & minStock pastikan angka
    if (req.body.sellPrice !== undefined) product.sellPrice = Number(req.body.sellPrice);
    if (req.body.minStock !== undefined) product.set({ minStock: Number(req.body.minStock) });
    

    await product.save();
    res.json({ success: true, data: product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.deleteProduct = async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Produk dihapus' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Tambah stok masuk (FIFO: buat batch baru)
exports.toggleEarnPoints = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Produk tidak ditemukan' });
    product.earnPoints = !product.earnPoints;
    await product.save();
    res.json({ success: true, data: { earnPoints: product.earnPoints } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.addStock = async (req, res) => {
  try {
    const { quantity, purchasePrice, notes, expiryDate } = req.body;
    const qty   = parseInt(quantity);
    const price = parseFloat(purchasePrice);

    if (!qty || qty <= 0)   return res.status(400).json({ success: false, message: 'Jumlah stok harus lebih dari 0' });
    if (!price || price < 0) return res.status(400).json({ success: false, message: 'Harga modal tidak valid' });

    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Produk tidak ditemukan' });
    if (product.type !== 'fisik') return res.status(400).json({ success: false, message: 'Hanya produk fisik yang memiliki stok' });

    const batchData = { quantity: qty, remainingQty: qty, purchasePrice: price };
    if (expiryDate) batchData.expiryDate = new Date(expiryDate);

    product.stockBatches.push(batchData);
    product.stock = (product.stock || 0) + qty;
    await product.save();

    await StockLog.create({
      product: product._id, productCode: product.code, productName: product.name,
      type: 'masuk', quantity: qty, purchasePrice: price, notes, createdBy: req.user._id
    });

    const io = req.app.get('io');
    io?.emit('stockUpdated', { productId: product._id, stock: product.stock });

    res.json({ success: true, data: product, message: 'Stok berhasil ditambahkan' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getStockLogs = async (req, res) => {
  try {
    const logs = await StockLog.find({ product: req.params.id }).sort('-createdAt').limit(50);
    res.json({ success: true, data: logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Set poin massal untuk semua produk fisik ─────────────────
exports.bulkSetPointValue = async (req, res) => {
  try {
    const { pointValue } = req.body;
    if (pointValue === undefined || pointValue < 0) return res.status(400).json({ success: false, message: 'Nilai poin tidak valid' });
    const cabangQ = req.cabangFilter || {};
    const result = await Product.updateMany(
      { type: 'fisik', ...cabangQ },
      { $set: { pointValue: Number(pointValue) } }
    );
    res.json({ success: true, message: `${result.modifiedCount} produk fisik diupdate`, modifiedCount: result.modifiedCount });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.getLowStock = async (req, res) => {
  try {
    const { Settings } = require('../models/index');
    const settings = await Settings.findOne();
    const lowStockThreshold = settings?.lowStockThreshold || 5;
    const cabangQ = req.cabangFilter || {};

    const products = await Product.find({
      type: 'fisik',
      isActive: true,
      ...cabangQ,
      $expr: { $lte: ['$stock', { $ifNull: ['$minStock', lowStockThreshold] }] }
    }).select('code name stock minStock category');

    res.json({ success: true, data: products, count: products.length });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
