const mongoose = require('mongoose');
const ServicePrice = require('../models/ServicePrice');
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

// GET /api/service-price
exports.getServicePrices = async (req, res) => {
  try {
    const { search, merek, isActive } = req.query;
    const cabangQ = req.cabangFilter || {};
    const query = { ...cabangQ };

    if (isActive === 'false') query.isActive = false;
    else if (isActive === 'true') query.isActive = true;
    else query.isActive = true;

    if (merek) query.merek = { $regex: `^${merek}$`, $options: 'i' };

    if (search) {
      query.$or = [
        { tipeHP:         { $regex: search, $options: 'i' } },
        { jenisKerusakan: { $regex: search, $options: 'i' } },
      ];
    }

    const data = await ServicePrice.find(query).sort({ merek: 1, tipeHP: 1, jenisKerusakan: 1 });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/service-price
exports.createServicePrice = async (req, res) => {
  try {
    const cabangId = await resolveCabangForCreate(req);
    if (!cabangId) return res.status(400).json({ success: false, message: 'Cabang wajib diisi' });

    const { tipeHP, merek, jenisKerusakan, harga, keterangan } = req.body;

    const saved = await ServicePrice.create({
      tipeHP,
      merek,
      jenisKerusakan,
      harga: Number(harga) || 0,
      keterangan: keterangan || '',
      cabang: cabangId,
    });

    res.status(201).json({ success: true, data: saved });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

// PUT /api/service-price/:id
exports.updateServicePrice = async (req, res) => {
  try {
    const cabangQ = req.cabangFilter || {};
    const doc = await ServicePrice.findOne({ _id: req.params.id, ...cabangQ });
    if (!doc) return res.status(404).json({ success: false, message: 'Daftar harga service tidak ditemukan' });

    const fields = ['tipeHP', 'merek', 'jenisKerusakan', 'keterangan', 'isActive'];
    fields.forEach(f => { if (req.body[f] !== undefined) doc[f] = req.body[f]; });
    if (req.body.harga !== undefined) doc.harga = Number(req.body.harga) || 0;

    await doc.save();
    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE /api/service-price/:id — soft delete (adminOnly di route)
exports.deleteServicePrice = async (req, res) => {
  try {
    const cabangQ = req.cabangFilter || {};
    const doc = await ServicePrice.findOne({ _id: req.params.id, ...cabangQ });
    if (!doc) return res.status(404).json({ success: false, message: 'Daftar harga service tidak ditemukan' });
    doc.isActive = false;
    await doc.save();
    res.json({ success: true, message: 'Daftar harga service dinonaktifkan' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
