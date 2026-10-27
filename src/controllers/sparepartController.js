const mongoose = require('mongoose');
const SparePartStock = require('../models/SparePartStock');
const SparePartLog   = require('../models/SparePartLog');
const Cabang = require('../models/Cabang');

// Resolver cabang untuk create: superadmin dari body, owner validate ownership, lainnya dari user.cabang
async function resolveCabangForCreate(req) {
  if (req.user.role === 'superadmin') {
    return req.body.cabang || null;
  }
  if (req.user.role === 'owner') {
    if (!req.body.cabang) {
      const err = new Error('Cabang diperlukan');
      err.status = 400;
      throw err;
    }
    if (!mongoose.isValidObjectId(req.body.cabang)) {
      const err = new Error('Cabang tidak valid');
      err.status = 400;
      throw err;
    }
    const owned = await Cabang.findOne({ _id: req.body.cabang, owner: req.user._id });
    if (!owned) {
      const err = new Error('Cabang bukan milik kamu');
      err.status = 403;
      throw err;
    }
    return owned._id;
  }
  return req.user.cabang?._id || req.user.cabang || null;
}

// GET /api/sparepart
exports.getSpareparts = async (req, res) => {
  try {
    const { search, includeInactive } = req.query;
    const cabangQ = req.cabangFilter || {};
    const query = { ...cabangQ };
    if (includeInactive !== 'true') query.isActive = true;
    if (search) query.nama = { $regex: search, $options: 'i' };

    const data = await SparePartStock.find(query).sort({ nama: 1 });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/sparepart/:id
exports.getSparepart = async (req, res) => {
  try {
    const cabangQ = req.cabangFilter || {};
    const doc = await SparePartStock.findOne({ _id: req.params.id, ...cabangQ });
    if (!doc) return res.status(404).json({ success: false, message: 'Sparepart tidak ditemukan' });
    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/sparepart
exports.createSparepart = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const cabangId = await resolveCabangForCreate(req);
    if (!cabangId) return res.status(400).json({ success: false, message: 'Cabang wajib diisi' });

    const { nama, kategori, hargaBeli, hargaJual, stok, satuan, isActive } = req.body;
    const stokAwal = Number(stok) || 0;
    let saved;

    await session.withTransaction(async () => {
      const [doc] = await SparePartStock.create([{
        nama,
        kategori: kategori || '',
        hargaBeli: Number(hargaBeli) || 0,
        hargaJual: Number(hargaJual) || 0,
        stok: stokAwal,
        satuan: satuan || 'unit',
        cabang: cabangId,
        isActive: isActive !== undefined ? !!isActive : true,
      }], { session });

      if (stokAwal > 0) {
        await SparePartLog.create([{
          sparepart: doc._id,
          cabang: doc.cabang,
          jenis: 'masuk',
          jumlah: stokAwal,
          stokSebelum: 0,
          stokSesudah: stokAwal,
          keterangan: 'Stok awal',
          createdBy: req.user._id,
        }], { session });
      }

      saved = doc;
    });

    res.status(201).json({ success: true, data: saved });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  } finally {
    session.endSession();
  }
};

// PUT /api/sparepart/:id
exports.updateSparepart = async (req, res) => {
  try {
    const cabangQ = req.cabangFilter || {};
    const doc = await SparePartStock.findOne({ _id: req.params.id, ...cabangQ });
    if (!doc) return res.status(404).json({ success: false, message: 'Sparepart tidak ditemukan' });

    const fields = ['nama', 'kategori', 'satuan', 'isActive'];
    fields.forEach(f => { if (req.body[f] !== undefined) doc[f] = req.body[f]; });
    if (req.body.hargaBeli !== undefined) doc.hargaBeli = Number(req.body.hargaBeli) || 0;
    if (req.body.hargaJual !== undefined) doc.hargaJual = Number(req.body.hargaJual) || 0;
    if (req.body.stok !== undefined) doc.stok = Number(req.body.stok) || 0;

    await doc.save();
    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/sparepart/:id — soft delete (adminOnly di route)
exports.deleteSparepart = async (req, res) => {
  try {
    const cabangQ = req.cabangFilter || {};
    const doc = await SparePartStock.findOne({ _id: req.params.id, ...cabangQ });
    if (!doc) return res.status(404).json({ success: false, message: 'Sparepart tidak ditemukan' });
    doc.isActive = false;
    await doc.save();
    res.json({ success: true, message: 'Sparepart dinonaktifkan' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/sparepart/:id/add-stock
exports.addStock = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const jumlah = Number(req.body.jumlah);
    if (!jumlah || jumlah <= 0) {
      return res.status(400).json({ success: false, message: 'Jumlah harus lebih dari 0' });
    }

    const cabangQ = req.cabangFilter || {};
    let notFound = false;
    let saved;

    await session.withTransaction(async () => {
      const doc = await SparePartStock.findOne({ _id: req.params.id, ...cabangQ }).session(session);
      if (!doc) { notFound = true; return; }

      const stokSebelum = doc.stok || 0;
      doc.stok = stokSebelum + jumlah;
      await doc.save({ session });

      await SparePartLog.create([{
        sparepart: doc._id,
        cabang: doc.cabang,
        jenis: 'masuk',
        jumlah,
        hargaBeli: Number(req.body.hargaBeli) || 0,
        stokSebelum,
        stokSesudah: doc.stok,
        keterangan: req.body.keterangan || 'Tambah stok',
        createdBy: req.user._id,
      }], { session });

      saved = doc;
    });

    if (notFound) return res.status(404).json({ success: false, message: 'Sparepart tidak ditemukan' });
    res.json({ success: true, data: saved, message: 'Stok berhasil ditambahkan' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  } finally {
    session.endSession();
  }
};

// GET /api/sparepart/:id/log — riwayat per sparepart
exports.getSparePartLog = async (req, res) => {
  try {
    const cabangQ = req.cabangFilter || {};
    const sparepart = await SparePartStock.findOne({ _id: req.params.id, ...cabangQ });
    if (!sparepart) return res.status(404).json({ success: false, message: 'Sparepart tidak ditemukan' });

    const page  = Math.max(parseInt(req.query.page)  || 1, 1);
    const limit = Math.max(parseInt(req.query.limit) || 20, 1);
    const skip  = (page - 1) * limit;

    const query = { sparepart: sparepart._id };
    if (req.query.jenis && ['masuk', 'keluar'].includes(req.query.jenis)) {
      query.jenis = req.query.jenis;
    }

    const total = await SparePartLog.countDocuments(query);
    const data  = await SparePartLog.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('createdBy', 'name')
      .populate('serviceTransaction', 'invoiceNumber');

    res.json({
      success: true,
      data,
      total,
      page,
      totalPages: Math.max(Math.ceil(total / limit), 1),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/sparepart/logs/pembelian — semua log 'masuk' per cabang
exports.getLogPembelian = async (req, res) => {
  try {
    const cabangQ = req.cabangFilter || {};
    const page  = Math.max(parseInt(req.query.page)  || 1, 1);
    const limit = Math.max(parseInt(req.query.limit) || 20, 1);
    const skip  = (page - 1) * limit;

    const query = { ...cabangQ, jenis: 'masuk' };
    if (req.query.sparepart && mongoose.isValidObjectId(req.query.sparepart)) {
      query.sparepart = req.query.sparepart;
    }
    if (req.query.startDate || req.query.endDate) {
      query.createdAt = {};
      if (req.query.startDate) query.createdAt.$gte = new Date(req.query.startDate);
      if (req.query.endDate) {
        const e = new Date(req.query.endDate);
        e.setHours(23, 59, 59, 999);
        query.createdAt.$lte = e;
      }
    }

    const total = await SparePartLog.countDocuments(query);
    const data  = await SparePartLog.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('sparepart', 'nama')
      .populate('createdBy', 'name');

    res.json({
      success: true,
      data,
      total,
      page,
      totalPages: Math.max(Math.ceil(total / limit), 1),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
