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

// Normalize hargaList dari body: dukung format baru (hargaList array) & lama (harga + keterangan)
function parseHargaList(body) {
  if (Array.isArray(body.hargaList) && body.hargaList.length > 0) {
    const cleaned = body.hargaList
      .map(h => ({
        harga: Number(h?.harga) || 0,
        keterangan: typeof h?.keterangan === 'string' ? h.keterangan.trim() : '',
      }))
      .filter(h => h.harga > 0);
    return cleaned;
  }
  // Fallback: client lama kirim single harga + keterangan
  if (body.harga !== undefined) {
    const harga = Number(body.harga) || 0;
    if (harga > 0) {
      return [{ harga, keterangan: (body.keterangan || '').trim() }];
    }
  }
  return [];
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

    // Group by tipeHP; item tanpa tipeHP masuk ke grup 'Lainnya'
    const groupMap = new Map();
    for (const item of data) {
      const tipe = (item.tipeHP && item.tipeHP.trim()) || 'Lainnya';
      if (!groupMap.has(tipe)) groupMap.set(tipe, []);
      groupMap.get(tipe).push(item);
    }
    const grouped = Array.from(groupMap.entries())
      .map(([tipeHP, items]) => ({ tipeHP, items }))
      .sort((a, b) => a.tipeHP.localeCompare(b.tipeHP));

    res.json({ success: true, data: grouped });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/service-price/tipe — list distinct tipeHP untuk dropdown filter
exports.getTipeHPList = async (req, res) => {
  try {
    const cabangQ = req.cabangFilter || {};
    const rawTipes = await ServicePrice.distinct('tipeHP', { ...cabangQ, isActive: true });

    const set = new Set();
    let hasEmpty = false;
    for (const t of rawTipes) {
      const v = (t || '').trim();
      if (v) set.add(v);
      else hasEmpty = true;
    }
    const list = Array.from(set).sort((a, b) => a.localeCompare(b));
    if (hasEmpty) list.push('Lainnya');

    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/service-price
exports.createServicePrice = async (req, res) => {
  try {
    const cabangId = await resolveCabangForCreate(req);
    if (!cabangId) return res.status(400).json({ success: false, message: 'Cabang wajib diisi' });

    const { tipeHP, merek, jenisKerusakan } = req.body;
    const hargaList = parseHargaList(req.body);
    if (hargaList.length === 0) {
      return res.status(400).json({ success: false, message: 'Minimal 1 harga wajib diisi' });
    }

    const saved = await ServicePrice.create({
      tipeHP,
      merek,
      jenisKerusakan,
      hargaList,
      // Mirror ke legacy field agar kode lain yang masih baca `harga` tetap jalan
      harga: hargaList[0].harga,
      keterangan: hargaList[0].keterangan,
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

    const fields = ['tipeHP', 'merek', 'jenisKerusakan', 'isActive'];
    fields.forEach(f => { if (req.body[f] !== undefined) doc[f] = req.body[f]; });

    // Hanya replace hargaList/legacy field jika client memang mengirim data harga baru
    const hasHargaInput = Array.isArray(req.body.hargaList) || req.body.harga !== undefined;
    if (hasHargaInput) {
      const hargaList = parseHargaList(req.body);
      if (hargaList.length === 0) {
        return res.status(400).json({ success: false, message: 'Minimal 1 harga wajib diisi' });
      }
      doc.hargaList  = hargaList;
      doc.harga      = hargaList[0].harga;
      doc.keterangan = hargaList[0].keterangan;
    } else if (req.body.keterangan !== undefined) {
      // Dukung client lama yang cuma update keterangan tanpa ubah harga
      doc.keterangan = req.body.keterangan;
    }

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
