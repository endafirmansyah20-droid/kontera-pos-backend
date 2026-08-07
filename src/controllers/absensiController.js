const mongoose = require('mongoose');
const Absensi  = require('../models/Absensi');
const Cabang   = require('../models/Cabang');
const User     = require('../models/User');
const { publicUrl, removeByPublicUrl } = require('../utils/uploader');

// ── Konstanta ─────────────────────────────────────────────────────
// Radius toleransi jarak check-in dari koordinat cabang (meter).
// Kalau cabang.lokasi belum di-set (nullable), validasi skip.
const MAX_JARAK_METER = 100;

// ── Helper: normalize tanggal ke 00:00 WIB (UTC+7) ────────────────
// Query per-tanggal harus konsisten timezone supaya unique index
// (user, tanggal) bekerja benar dan tidak ada off-by-one antar user
// yang absen menjelang tengah malam UTC.
function normalizeTanggalWIB(date = new Date()) {
  const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
  const wib = new Date(date.getTime() + WIB_OFFSET_MS);
  wib.setUTCHours(0, 0, 0, 0);
  return new Date(wib.getTime() - WIB_OFFSET_MS);
}

// ── Helper: Haversine distance dalam meter ────────────────────────
function haversineMeter(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371000; // radius bumi meter
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ── Helper: parse & validasi lokasi dari body ─────────────────────
// Body dari multer form-data: lat & lng string; akurasi opsional.
function parseLokasi(body) {
  const lat = parseFloat(body.lat);
  const lng = parseFloat(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const akurasi = body.akurasi != null ? parseFloat(body.akurasi) : undefined;
  const out = { lat, lng };
  if (Number.isFinite(akurasi)) out.akurasi = akurasi;
  return out;
}

// Cleanup file yang sudah ter-upload kalau validasi gagal — cegah orphan file di disk.
function cleanupUploadedFile(req) {
  if (req.file?.filename) {
    try { removeByPublicUrl(publicUrl('absensi', req.file.filename)); } catch (_) {}
  }
}

// ══════════════════════════════════════════════════════════════════
// STAFF ENDPOINTS
// ══════════════════════════════════════════════════════════════════

// ── POST /api/absensi/checkin ─────────────────────────────────────
exports.checkIn = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Foto check-in wajib diupload' });
    }
    const lokasi = parseLokasi(req.body);
    if (!lokasi) {
      cleanupUploadedFile(req);
      return res.status(400).json({ success: false, message: 'Koordinat lokasi (lat, lng) wajib dan valid' });
    }

    const user     = req.user;
    const cabangId = user.cabang?._id || user.cabang;
    const cabang   = await Cabang.findById(cabangId);
    if (!cabang) {
      cleanupUploadedFile(req);
      return res.status(400).json({ success: false, message: 'Cabang tidak ditemukan' });
    }

    // Validasi jarak — hanya kalau cabang sudah punya koordinat tersimpan
    if (Number.isFinite(cabang.lokasi?.lat) && Number.isFinite(cabang.lokasi?.lng)) {
      const jarak = haversineMeter(cabang.lokasi.lat, cabang.lokasi.lng, lokasi.lat, lokasi.lng);
      if (jarak > MAX_JARAK_METER) {
        cleanupUploadedFile(req);
        return res.status(400).json({
          success: false,
          message: `Lokasi terlalu jauh dari cabang (${Math.round(jarak)} m, maksimal ${MAX_JARAK_METER} m). Pastikan Anda berada di lokasi cabang.`,
          meta: { jarak: Math.round(jarak), maxJarak: MAX_JARAK_METER },
        });
      }
    }

    const tanggal = normalizeTanggalWIB();
    const now     = new Date();
    const fotoUrl = publicUrl('absensi', req.file.filename);

    // Cek record existing untuk hari ini
    const existing = await Absensi.findOne({ user: user._id, tanggal });
    if (existing) {
      cleanupUploadedFile(req);
      // Beri pesan sesuai state
      if (existing.status === 'hadir' && existing.checkIn?.waktu) {
        return res.status(409).json({ success: false, message: 'Anda sudah check-in hari ini' });
      }
      if (['izin', 'sakit', 'cuti'].includes(existing.status)) {
        return res.status(409).json({
          success: false,
          message: `Anda sudah mengajukan ${existing.status} hari ini`,
        });
      }
      return res.status(409).json({ success: false, message: 'Sudah ada catatan absensi hari ini' });
    }

    const doc = await Absensi.create({
      user: user._id,
      cabang: cabangId,
      tanggal,
      status: 'hadir',
      checkIn: { waktu: now, lokasi, fotoUrl },
    });

    res.status(201).json({ success: true, message: 'Check-in berhasil', data: doc });
  } catch (err) {
    cleanupUploadedFile(req);
    // Duplicate key race (unique user+tanggal)
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Anda sudah absen hari ini' });
    }
    console.error('[absensi.checkIn]', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/absensi/checkout ────────────────────────────────────
exports.checkOut = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Foto check-out wajib diupload' });
    }
    const lokasi = parseLokasi(req.body);
    if (!lokasi) {
      cleanupUploadedFile(req);
      return res.status(400).json({ success: false, message: 'Koordinat lokasi (lat, lng) wajib dan valid' });
    }

    const user     = req.user;
    const cabangId = user.cabang?._id || user.cabang;
    const cabang   = await Cabang.findById(cabangId);
    if (!cabang) {
      cleanupUploadedFile(req);
      return res.status(400).json({ success: false, message: 'Cabang tidak ditemukan' });
    }

    // Validasi jarak juga untuk checkout — konsistensi
    if (Number.isFinite(cabang.lokasi?.lat) && Number.isFinite(cabang.lokasi?.lng)) {
      const jarak = haversineMeter(cabang.lokasi.lat, cabang.lokasi.lng, lokasi.lat, lokasi.lng);
      if (jarak > MAX_JARAK_METER) {
        cleanupUploadedFile(req);
        return res.status(400).json({
          success: false,
          message: `Lokasi terlalu jauh dari cabang (${Math.round(jarak)} m, maksimal ${MAX_JARAK_METER} m).`,
          meta: { jarak: Math.round(jarak), maxJarak: MAX_JARAK_METER },
        });
      }
    }

    const tanggal = normalizeTanggalWIB();
    const now     = new Date();

    const doc = await Absensi.findOne({ user: user._id, tanggal });
    if (!doc) {
      cleanupUploadedFile(req);
      return res.status(404).json({ success: false, message: 'Anda belum check-in hari ini' });
    }
    if (doc.status !== 'hadir') {
      cleanupUploadedFile(req);
      return res.status(400).json({ success: false, message: `Anda status ${doc.status} hari ini, tidak perlu check-out` });
    }
    if (doc.checkOut?.waktu) {
      cleanupUploadedFile(req);
      return res.status(409).json({ success: false, message: 'Anda sudah check-out hari ini' });
    }

    doc.checkOut = { waktu: now, lokasi, fotoUrl: publicUrl('absensi', req.file.filename) };
    await doc.save();

    res.json({ success: true, message: 'Check-out berhasil', data: doc });
  } catch (err) {
    cleanupUploadedFile(req);
    console.error('[absensi.checkOut]', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/absensi/izin ────────────────────────────────────────
// Body: { status: 'izin'|'sakit'|'cuti', keterangan, tanggal? (opsional, default hari ini) }
// File: lampiran (opsional, mis. surat sakit)
exports.ajukanIzin = async (req, res) => {
  try {
    const { status, keterangan } = req.body;
    if (!['izin', 'sakit', 'cuti'].includes(status)) {
      cleanupUploadedFile(req);
      return res.status(400).json({ success: false, message: 'Status harus izin, sakit, atau cuti' });
    }
    if (!keterangan || !String(keterangan).trim()) {
      cleanupUploadedFile(req);
      return res.status(400).json({ success: false, message: 'Keterangan wajib diisi' });
    }

    // Tanggal target: default hari ini; boleh future date untuk cuti/izin di depan
    let tanggal;
    if (req.body.tanggal) {
      const parsed = new Date(req.body.tanggal);
      if (isNaN(parsed.getTime())) {
        cleanupUploadedFile(req);
        return res.status(400).json({ success: false, message: 'Tanggal tidak valid' });
      }
      tanggal = normalizeTanggalWIB(parsed);
    } else {
      tanggal = normalizeTanggalWIB();
    }

    const user     = req.user;
    const cabangId = user.cabang?._id || user.cabang;

    // Cek existing — kalau sudah check-in hari itu tidak boleh ajukan izin
    const existing = await Absensi.findOne({ user: user._id, tanggal });
    if (existing) {
      cleanupUploadedFile(req);
      return res.status(409).json({
        success: false,
        message: existing.status === 'hadir'
          ? 'Sudah check-in di tanggal tersebut, tidak bisa ajukan izin'
          : `Sudah ada pengajuan ${existing.status} di tanggal tersebut`,
      });
    }

    const doc = await Absensi.create({
      user: user._id,
      cabang: cabangId,
      tanggal,
      status,
      keterangan: String(keterangan).trim(),
      lampiranUrl: req.file ? publicUrl('absensi', req.file.filename) : '',
      approvalStatus: 'pending',
    });

    // Emit socket event ke owner supaya dashboard live-update
    const io = req.app.get('io');
    io?.emit('absensi:new-izin', {
      cabang: cabangId,
      user: user._id,
      userName: user.name,
      status,
      tanggal,
    });

    res.status(201).json({ success: true, message: 'Pengajuan berhasil dikirim, menunggu persetujuan Owner', data: doc });
  } catch (err) {
    cleanupUploadedFile(req);
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Sudah ada catatan absensi di tanggal tersebut' });
    }
    console.error('[absensi.ajukanIzin]', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/absensi/hari-ini ─────────────────────────────────────
// Frontend cek: apakah user sudah check-in / check-out / punya izin hari ini?
exports.getHariIni = async (req, res) => {
  try {
    const tanggal = normalizeTanggalWIB();
    const doc = await Absensi.findOne({ user: req.user._id, tanggal })
      .populate('cabang', 'nama kode lokasi');

    // Info radius supaya frontend bisa tampilkan indikator/lingkaran di map
    const cabang = await Cabang.findById(req.user.cabang?._id || req.user.cabang)
      .select('nama kode lokasi').lean();

    res.json({
      success: true,
      data: doc,
      cabang,
      maxJarakMeter: MAX_JARAK_METER,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/absensi/riwayat ──────────────────────────────────────
// Query: ?bulan=YYYY-MM (default: bulan berjalan)
exports.getRiwayat = async (req, res) => {
  try {
    const now = new Date();
    let startDate, endDate;
    if (req.query.bulan) {
      const m = String(req.query.bulan).match(/^(\d{4})-(\d{2})$/);
      if (!m) return res.status(400).json({ success: false, message: 'Format bulan harus YYYY-MM' });
      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10) - 1;
      startDate = normalizeTanggalWIB(new Date(y, mo, 1));
      endDate   = normalizeTanggalWIB(new Date(y, mo + 1, 1));
    } else {
      startDate = normalizeTanggalWIB(new Date(now.getFullYear(), now.getMonth(), 1));
      endDate   = normalizeTanggalWIB(new Date(now.getFullYear(), now.getMonth() + 1, 1));
    }

    const rows = await Absensi.find({
      user: req.user._id,
      tanggal: { $gte: startDate, $lt: endDate },
    }).sort('-tanggal').lean();

    // Rekap kecil untuk header UI
    const rekap = { hadir: 0, izin: 0, sakit: 0, cuti: 0 };
    for (const r of rows) rekap[r.status] = (rekap[r.status] || 0) + 1;

    res.json({ success: true, data: rows, rekap });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Konstanta lembur ──────────────────────────────────────────────
const LEMBUR_MAX_LOOKBACK_DAYS  = 30;   // hari lampau maksimum yang boleh diajukan
const LEMBUR_MAX_DURASI_MENIT   = 12 * 60; // max 12 jam per klaim

// ── POST /api/absensi/lembur ──────────────────────────────────────
// Body: { tanggal (YYYY-MM-DD), jamMulai (ISO), jamSelesai (ISO), alasan }
exports.ajukanLembur = async (req, res) => {
  try {
    const { tanggal, jamMulai, jamSelesai, alasan } = req.body;

    if (!tanggal || !jamMulai || !jamSelesai || !alasan) {
      return res.status(400).json({ success: false, message: 'tanggal, jamMulai, jamSelesai, alasan wajib diisi' });
    }
    const alasanTrim = String(alasan).trim();
    if (!alasanTrim) {
      return res.status(400).json({ success: false, message: 'Alasan wajib diisi' });
    }
    if (alasanTrim.length > 500) {
      return res.status(400).json({ success: false, message: 'Alasan maksimal 500 karakter' });
    }

    const tglParsed = new Date(tanggal);
    if (isNaN(tglParsed.getTime())) {
      return res.status(400).json({ success: false, message: 'Tanggal tidak valid' });
    }
    const jm = new Date(jamMulai);
    const js = new Date(jamSelesai);
    if (isNaN(jm.getTime()) || isNaN(js.getTime())) {
      return res.status(400).json({ success: false, message: 'jamMulai/jamSelesai tidak valid' });
    }
    if (js <= jm) {
      return res.status(400).json({ success: false, message: 'jamSelesai harus setelah jamMulai' });
    }

    // Catatan: jamSelesai boleh di masa depan (dalam hari yang sama). Contoh:
    // karyawan submit jam 21:00 untuk lembur yang akan berakhir jam 23:00.
    // Guard "tanggal tidak boleh future" di bawah sudah cegah abuse tanggal besok.

    const durasiMenit = Math.round((js - jm) / 60000);
    if (durasiMenit <= 0) {
      return res.status(400).json({ success: false, message: 'Durasi lembur tidak valid' });
    }
    if (durasiMenit > LEMBUR_MAX_DURASI_MENIT) {
      return res.status(400).json({
        success: false,
        message: `Durasi lembur maksimal ${LEMBUR_MAX_DURASI_MENIT / 60} jam per klaim`,
      });
    }

    const tanggalNorm = normalizeTanggalWIB(tglParsed);
    // Retroactive lookback guard — hitung selisih hari kalender WIB
    const todayNorm = normalizeTanggalWIB();
    const lookbackDays = Math.floor((todayNorm - tanggalNorm) / 86400000);
    if (lookbackDays < 0) {
      return res.status(400).json({ success: false, message: 'Lembur tidak boleh diajukan untuk hari yang belum tiba' });
    }
    if (lookbackDays > LEMBUR_MAX_LOOKBACK_DAYS) {
      return res.status(400).json({
        success: false,
        message: `Lembur hanya bisa diajukan maksimal ${LEMBUR_MAX_LOOKBACK_DAYS} hari ke belakang`,
      });
    }

    const user = req.user;
    const doc = await Absensi.findOne({ user: user._id, tanggal: tanggalNorm });
    if (!doc) {
      return res.status(400).json({
        success: false,
        message: 'Tidak ada catatan absensi untuk tanggal tersebut. Lembur hanya bisa diajukan pada hari yang Anda hadir.',
      });
    }
    if (doc.status !== 'hadir') {
      return res.status(400).json({
        success: false,
        message: `Anda berstatus ${doc.status} di tanggal tersebut, tidak bisa mengajukan lembur`,
      });
    }

    // Guard: hanya 1 lembur aktif (pending/disetujui) per tanggal
    const adaAktif = (doc.lembur || []).some(l => l.approvalStatus === 'pending' || l.approvalStatus === 'disetujui');
    if (adaAktif) {
      return res.status(409).json({
        success: false,
        message: 'Sudah ada pengajuan lembur aktif untuk tanggal ini. Batalkan/tolak dulu sebelum ajukan baru.',
      });
    }

    doc.lembur.push({
      jamMulai: jm,
      jamSelesai: js,
      durasiMenit,
      alasan: alasanTrim,
      approvalStatus: 'pending',
    });
    await doc.save();

    const created = doc.lembur[doc.lembur.length - 1];

    // Notify owner via socket
    req.app.get('io')?.emit('lembur:new-pengajuan', {
      cabang: doc.cabang,
      user: user._id,
      userName: user.name,
      absensiId: doc._id,
      lemburId: created._id,
      tanggal: doc.tanggal,
      durasiMenit,
    });

    res.status(201).json({
      success: true,
      message: 'Pengajuan lembur dikirim, menunggu persetujuan Owner',
      data: { absensiId: doc._id, lembur: created },
    });
  } catch (err) {
    console.error('[absensi.ajukanLembur]', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/absensi/lembur/riwayat ───────────────────────────────
// Query: ?bulan=YYYY-MM (default: bulan berjalan)
exports.getRiwayatLembur = async (req, res) => {
  try {
    const now = new Date();
    let startDate, endDate;
    if (req.query.bulan) {
      const m = String(req.query.bulan).match(/^(\d{4})-(\d{2})$/);
      if (!m) return res.status(400).json({ success: false, message: 'Format bulan harus YYYY-MM' });
      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10) - 1;
      startDate = normalizeTanggalWIB(new Date(y, mo, 1));
      endDate   = normalizeTanggalWIB(new Date(y, mo + 1, 1));
    } else {
      startDate = normalizeTanggalWIB(new Date(now.getFullYear(), now.getMonth(), 1));
      endDate   = normalizeTanggalWIB(new Date(now.getFullYear(), now.getMonth() + 1, 1));
    }

    const rows = await Absensi.find({
      user: req.user._id,
      tanggal: { $gte: startDate, $lt: endDate },
      'lembur.0': { $exists: true },
    }).sort('-tanggal').lean();

    // Flatten ke entri lembur + rekap
    const items = [];
    const rekap = { pending: 0, disetujui: 0, ditolak: 0, totalMenitDisetujui: 0 };
    for (const r of rows) {
      for (const l of (r.lembur || [])) {
        items.push({
          _id: l._id,
          absensiId: r._id,
          tanggal: r.tanggal,
          jamMulai: l.jamMulai,
          jamSelesai: l.jamSelesai,
          durasiMenit: l.durasiMenit,
          alasan: l.alasan,
          approvalStatus: l.approvalStatus,
          approvedAt: l.approvedAt,
          alasanTolak: l.alasanTolak,
          createdAt: l.createdAt,
        });
        rekap[l.approvalStatus] = (rekap[l.approvalStatus] || 0) + 1;
        if (l.approvalStatus === 'disetujui') rekap.totalMenitDisetujui += (l.durasiMenit || 0);
      }
    }
    // Sort by createdAt DESC
    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
      success: true,
      data: items,
      rekap: { ...rekap, totalJamDisetujui: Number((rekap.totalMenitDisetujui / 60).toFixed(2)) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════
// OWNER ENDPOINTS
// ══════════════════════════════════════════════════════════════════

// Helper: pastikan owner benar-benar pemilik cabang yang diquery
async function ownerCabangIds(owner, cabangParam) {
  const all = await Cabang.find({ owner: owner._id }).select('_id nama kode').lean();
  if (cabangParam) {
    if (!mongoose.isValidObjectId(cabangParam)) {
      return { error: { status: 400, message: 'Cabang tidak valid' } };
    }
    const found = all.find(c => String(c._id) === String(cabangParam));
    if (!found) return { error: { status: 403, message: 'Cabang bukan milik Anda' } };
    return { all, ids: [found._id] };
  }
  return { all, ids: all.map(c => c._id) };
}

// ── GET /api/owner/absensi ────────────────────────────────────────
// Query: ?tanggal=YYYY-MM-DD (opsional), ?cabang=<id>, ?user=<id>, ?status=,
//        ?approvalStatus=, ?page=, ?limit=
exports.ownerListAbsensi = async (req, res) => {
  try {
    const owner = req.user;
    const scope = await ownerCabangIds(owner, req.query.cabang);
    if (scope.error) return res.status(scope.error.status).json({ success: false, message: scope.error.message });

    const query = { cabang: { $in: scope.ids } };

    if (req.query.tanggal) {
      const d = new Date(req.query.tanggal);
      if (isNaN(d.getTime())) return res.status(400).json({ success: false, message: 'Tanggal tidak valid' });
      const start = normalizeTanggalWIB(d);
      const end   = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      query.tanggal = { $gte: start, $lt: end };
    } else if (req.query.startDate || req.query.endDate) {
      query.tanggal = {};
      if (req.query.startDate) {
        const d = new Date(req.query.startDate);
        if (isNaN(d.getTime())) return res.status(400).json({ success: false, message: 'startDate tidak valid' });
        query.tanggal.$gte = normalizeTanggalWIB(d);
      }
      if (req.query.endDate) {
        const d = new Date(req.query.endDate);
        if (isNaN(d.getTime())) return res.status(400).json({ success: false, message: 'endDate tidak valid' });
        query.tanggal.$lte = new Date(normalizeTanggalWIB(d).getTime() + 24 * 60 * 60 * 1000 - 1);
      }
    }

    if (req.query.user) {
      if (!mongoose.isValidObjectId(req.query.user)) {
        return res.status(400).json({ success: false, message: 'User tidak valid' });
      }
      query.user = req.query.user;
    }
    if (req.query.status && ['hadir', 'izin', 'sakit', 'cuti'].includes(req.query.status)) {
      query.status = req.query.status;
    }
    if (req.query.approvalStatus && ['pending', 'disetujui', 'ditolak'].includes(req.query.approvalStatus)) {
      query.approvalStatus = req.query.approvalStatus;
    }

    const page  = Math.max(parseInt(req.query.page)  || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const skip  = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      Absensi.find(query)
        .sort('-tanggal -createdAt')
        .skip(skip).limit(limit)
        .populate('user', 'name username role')
        .populate('cabang', 'nama kode')
        .populate('approvedBy', 'name')
        .lean(),
      Absensi.countDocuments(query),
    ]);

    res.json({ success: true, data: rows, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/owner/absensi/summary ────────────────────────────────
// Rekap per cabang untuk periode tertentu (default: bulan berjalan).
// Query:
//   ?bulan=YYYY-MM atau ?startDate=&endDate=
//   ?cabang=<id>  — scope ke 1 cabang
//   ?user=<id>    — mode per-karyawan (output rekap user tsb + lembur breakdown)
exports.ownerSummaryAbsensi = async (req, res) => {
  try {
    const owner = req.user;
    const scope = await ownerCabangIds(owner, req.query.cabang);
    if (scope.error) return res.status(scope.error.status).json({ success: false, message: scope.error.message });

    const now = new Date();
    let startDate, endDate;
    if (req.query.bulan) {
      const m = String(req.query.bulan).match(/^(\d{4})-(\d{2})$/);
      if (!m) return res.status(400).json({ success: false, message: 'Format bulan harus YYYY-MM' });
      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10) - 1;
      startDate = normalizeTanggalWIB(new Date(y, mo, 1));
      endDate   = normalizeTanggalWIB(new Date(y, mo + 1, 1));
    } else if (req.query.startDate && req.query.endDate) {
      startDate = normalizeTanggalWIB(new Date(req.query.startDate));
      endDate   = new Date(normalizeTanggalWIB(new Date(req.query.endDate)).getTime() + 24 * 60 * 60 * 1000);
    } else {
      startDate = normalizeTanggalWIB(new Date(now.getFullYear(), now.getMonth(), 1));
      endDate   = normalizeTanggalWIB(new Date(now.getFullYear(), now.getMonth() + 1, 1));
    }

    // ── Mode per-karyawan ─────────────────────────────────────────
    if (req.query.user) {
      if (!mongoose.isValidObjectId(req.query.user)) {
        return res.status(400).json({ success: false, message: 'User tidak valid' });
      }
      const userId = new mongoose.Types.ObjectId(req.query.user);

      // Authz: user harus punya absensi di cabang milik owner (histori kerja apapun)
      const userDoc = await User.findOne({ _id: userId, cabang: { $in: scope.ids } })
        .select('name username role cabang').lean();
      const hasHistori = userDoc || await Absensi.exists({ user: userId, cabang: { $in: scope.ids } });
      if (!hasHistori) {
        return res.status(403).json({ success: false, message: 'Karyawan bukan bagian dari cabang Anda' });
      }

      const matchUser = {
        user: userId,
        cabang: { $in: scope.ids },
        tanggal: { $gte: startDate, $lt: endDate },
      };

      const [statusAgg, lemburAgg] = await Promise.all([
        Absensi.aggregate([
          { $match: matchUser },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        Absensi.aggregate([
          { $match: matchUser },
          { $unwind: '$lembur' },
          { $group: {
              _id: '$lembur.approvalStatus',
              count: { $sum: 1 },
              totalMenit: { $sum: '$lembur.durasiMenit' },
          }},
        ]),
      ]);

      const rekap = { hadir: 0, izin: 0, sakit: 0, cuti: 0, total: 0 };
      for (const r of statusAgg) {
        rekap[r._id] = r.count;
        rekap.total += r.count;
      }
      const lembur = {
        pending: 0, disetujui: 0, ditolak: 0,
        totalMenitDisetujui: 0, totalJamLembur: 0,
      };
      for (const r of lemburAgg) {
        if (!r._id) continue;
        lembur[r._id] = r.count;
        if (r._id === 'disetujui') lembur.totalMenitDisetujui = r.totalMenit || 0;
      }
      lembur.totalJamLembur = Number((lembur.totalMenitDisetujui / 60).toFixed(2));

      return res.json({
        success: true,
        startDate, endDate,
        user: userDoc || { _id: userId },
        rekap: { ...rekap, lembur },
      });
    }

    // ── Mode per-cabang (default) ────────────────────────────────
    const [perCabang, lemburPerCabang] = await Promise.all([
      Absensi.aggregate([
        { $match: { cabang: { $in: scope.ids }, tanggal: { $gte: startDate, $lt: endDate } } },
        { $group: {
            _id: { cabang: '$cabang', status: '$status' },
            count: { $sum: 1 },
        }},
      ]),
      Absensi.aggregate([
        { $match: { cabang: { $in: scope.ids }, tanggal: { $gte: startDate, $lt: endDate } } },
        { $unwind: '$lembur' },
        { $match: { 'lembur.approvalStatus': 'disetujui' } },
        { $group: {
            _id: '$cabang',
            totalMenit: { $sum: '$lembur.durasiMenit' },
            count: { $sum: 1 },
        }},
      ]),
    ]);

    const summary = scope.all.map(c => ({
      cabangId: c._id,
      cabangNama: c.nama,
      cabangKode: c.kode,
      hadir: 0, izin: 0, sakit: 0, cuti: 0, total: 0,
      lemburDisetujuiCount: 0,
      totalMenitLembur: 0,
      totalJamLembur: 0,
    }));
    const summaryByCabang = new Map(summary.map(s => [String(s.cabangId), s]));

    for (const row of perCabang) {
      const s = summaryByCabang.get(String(row._id.cabang));
      if (!s) continue;
      s[row._id.status] = row.count;
      s.total += row.count;
    }
    for (const row of lemburPerCabang) {
      const s = summaryByCabang.get(String(row._id));
      if (!s) continue;
      s.lemburDisetujuiCount = row.count;
      s.totalMenitLembur = row.totalMenit || 0;
      s.totalJamLembur = Number((s.totalMenitLembur / 60).toFixed(2));
    }

    // Global pending counts (untuk badge)
    const [pendingCount, lemburPendingCount] = await Promise.all([
      Absensi.countDocuments({
        cabang: { $in: scope.ids },
        approvalStatus: 'pending',
      }),
      Absensi.countDocuments({
        cabang: { $in: scope.ids },
        'lembur.approvalStatus': 'pending',
      }),
    ]);

    res.json({
      success: true,
      startDate, endDate,
      summary,
      pendingCount,
      lemburPendingCount,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/owner/absensi/:id ────────────────────────────────────
exports.ownerDetailAbsensi = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'ID tidak valid' });
    }
    const doc = await Absensi.findById(id)
      .populate('user', 'name username role')
      .populate('cabang', 'nama kode owner lokasi')
      .populate('approvedBy', 'name');
    if (!doc) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });

    // Authz: cabang harus milik owner
    if (!doc.cabang?.owner || String(doc.cabang.owner) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Bukan cabang milik Anda' });
    }

    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PATCH /api/owner/absensi/:id/approve ─────────────────────────
// Body: { approve: true|false, alasanTolak?: string }
exports.ownerApproveAbsensi = async (req, res) => {
  try {
    const { id } = req.params;
    const { approve, alasanTolak } = req.body;
    if (typeof approve !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Field approve (boolean) wajib' });
    }
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'ID tidak valid' });
    }

    const doc = await Absensi.findById(id).populate('cabang', 'owner nama');
    if (!doc) return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });
    if (!doc.cabang?.owner || String(doc.cabang.owner) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Bukan cabang milik Anda' });
    }
    if (!['izin', 'sakit', 'cuti'].includes(doc.status)) {
      return res.status(400).json({ success: false, message: 'Hanya pengajuan izin/sakit/cuti yang perlu approval' });
    }
    if (doc.approvalStatus && doc.approvalStatus !== 'pending') {
      return res.status(409).json({ success: false, message: `Sudah ${doc.approvalStatus}` });
    }

    doc.approvalStatus = approve ? 'disetujui' : 'ditolak';
    doc.approvedBy     = req.user._id;
    doc.approvedAt     = new Date();
    if (!approve) doc.alasanTolak = String(alasanTolak || '').trim();
    await doc.save();

    // Notify user via socket
    req.app.get('io')?.emit('absensi:approval', {
      absensiId: doc._id,
      user: doc.user,
      approvalStatus: doc.approvalStatus,
    });

    res.json({ success: true, message: `Pengajuan ${doc.approvalStatus}`, data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PATCH /api/owner/absensi/lembur/:lemburId/approve ────────────
// Body: { approve: true|false, alasanTolak?: string }
exports.ownerApproveLembur = async (req, res) => {
  try {
    const { lemburId } = req.params;
    const { approve, alasanTolak } = req.body;
    if (typeof approve !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Field approve (boolean) wajib' });
    }
    if (!mongoose.isValidObjectId(lemburId)) {
      return res.status(400).json({ success: false, message: 'lemburId tidak valid' });
    }

    // Cari parent Absensi via subdoc _id
    const doc = await Absensi.findOne({ 'lembur._id': lemburId })
      .populate('cabang', 'owner nama');
    if (!doc) return res.status(404).json({ success: false, message: 'Pengajuan lembur tidak ditemukan' });

    if (!doc.cabang?.owner || String(doc.cabang.owner) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Bukan cabang milik Anda' });
    }

    const sub = doc.lembur.id(lemburId);
    if (!sub) return res.status(404).json({ success: false, message: 'Pengajuan lembur tidak ditemukan' });

    const current = sub.approvalStatus;
    if (approve && current === 'disetujui') {
      return res.status(409).json({ success: false, message: 'Lembur sudah disetujui' });
    }
    if (!approve && current === 'ditolak') {
      return res.status(409).json({ success: false, message: 'Lembur sudah ditolak' });
    }

    sub.approvalStatus = approve ? 'disetujui' : 'ditolak';
    sub.approvedBy     = req.user._id;
    sub.approvedAt     = new Date();
    if (!approve) {
      sub.alasanTolak = String(alasanTolak || '').trim();
    } else {
      sub.alasanTolak = undefined;
    }
    await doc.save();

    // Notify user via socket
    req.app.get('io')?.emit('lembur:approval', {
      absensiId: doc._id,
      lemburId: sub._id,
      user: doc.user,
      approvalStatus: sub.approvalStatus,
    });

    res.json({
      success: true,
      message: `Pengajuan lembur ${sub.approvalStatus}`,
      data: { absensiId: doc._id, lembur: sub },
    });
  } catch (err) {
    console.error('[absensi.ownerApproveLembur]', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PATCH /api/owner/cabang/:id/lokasi ───────────────────────────
// Body: { lat, lng } — set koordinat cabang untuk validasi absensi
exports.ownerSetCabangLokasi = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: 'Cabang tidak valid' });
    }

    const cabang = await Cabang.findOne({ _id: id, owner: req.user._id });
    if (!cabang) return res.status(403).json({ success: false, message: 'Cabang bukan milik Anda' });

    // null untuk clear lokasi (matikan validasi jarak)
    if (req.body.lat === null && req.body.lng === null) {
      cabang.lokasi = { lat: null, lng: null };
      await cabang.save();
      return res.json({ success: true, message: 'Lokasi cabang dihapus', data: cabang });
    }

    const lat = parseFloat(req.body.lat);
    const lng = parseFloat(req.body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ success: false, message: 'Koordinat lat/lng tidak valid' });
    }

    cabang.lokasi = { lat, lng };
    await cabang.save();
    res.json({ success: true, message: 'Lokasi cabang berhasil disimpan', data: cabang });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports.MAX_JARAK_METER = MAX_JARAK_METER;
module.exports.normalizeTanggalWIB = normalizeTanggalWIB;
