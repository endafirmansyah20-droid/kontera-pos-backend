const Saldo = require('../models/Saldo');

const DEFAULT_AKUN = [
  { akunId: 'radar_pulsa',     namaAkun: 'Radar Pulsa',     group: 'Server Pulsa', icon: '📡' },
  { akunId: 'mitra_bukalapak', namaAkun: 'Mitra Bukalapak', group: 'Server Pulsa', icon: '🛒' },
  { akunId: 'digipos',         namaAkun: 'Digipos',          group: 'Server Pulsa', icon: '💻' },
  { akunId: 'brimo',           namaAkun: 'BRIMO',            group: 'Bank',         icon: '🏦' },
  { akunId: 'bri_merchant',    namaAkun: 'BRI Merchant',     group: 'Bank',         icon: '🏧' },
  { akunId: 'bca',             namaAkun: 'BCA',              group: 'Bank',         icon: '🏦' },
  { akunId: 'seabank',         namaAkun: 'SeaBank',          group: 'Bank',         icon: '🏦' },
  { akunId: 'dana1',           namaAkun: 'DANA 1',           group: 'E-Wallet',     icon: '💙' },
  { akunId: 'dana2',           namaAkun: 'DANA 2',           group: 'E-Wallet',     icon: '💙' },
  { akunId: 'ovo',             namaAkun: 'OVO',              group: 'E-Wallet',     icon: '💜' },
  { akunId: 'gopay',           namaAkun: 'GoPay',            group: 'E-Wallet',     icon: '💚' },
  { akunId: 'isaku',           namaAkun: 'ISAKU',            group: 'E-Wallet',     icon: '🟠' },
  { akunId: 'tunai',           namaAkun: 'Kas Tunai',        group: 'Tunai',        icon: '💵' },
];

// Init akun default per cabang jika belum ada
const initAkunPerCabang = async (cabangId) => {
  const existing = await Saldo.find({ cabang: cabangId }).select('akunId');
  const existingIds = new Set(existing.map(s => s.akunId));

  for (const akun of DEFAULT_AKUN) {
    if (!existingIds.has(akun.akunId)) {
      try {
        await Saldo.create({ ...akun, saldo: 0, cabang: cabangId });
      } catch (e) {
        // Jika unique conflict, skip
      }
    }
  }
};

// GET semua akun saldo
exports.getAllSaldo = async (req, res) => {
  try {
    const cabangQ = req.cabangFilter || {};
    const cabangId = req.user.cabang?._id || req.user.cabang || null;

    // Auto-init akun default untuk cabang ini jika belum ada
    if (cabangId) {
      const count = await Saldo.countDocuments({ cabang: cabangId });
      if (count === 0) await initAkunPerCabang(cabangId);
    }

    const saldos = await Saldo.find({ isActive: true, ...cabangQ }).select('-mutasi').sort('group namaAkun');
    const totalSaldo = saldos
      .filter(a => a.akunId !== 'tunai' && !a.akunId.startsWith('tunai-'))
      .reduce((s, a) => s + a.saldo, 0);
    res.json({ success: true, data: saldos, totalSaldo });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// GET mutasi per akun — 100 terakhir, dalam 1 bulan terakhir
exports.getMutasi = async (req, res) => {
  try {
    const cabangQ = req.cabangFilter || {};
    const akun = await Saldo.findOne({ akunId: req.params.akunId, ...cabangQ })
      .populate('mutasi.createdBy', 'name');
    if (!akun) return res.status(404).json({ success: false, message: 'Akun tidak ditemukan' });

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

    const mutasi = akun.mutasi
      .filter(m => new Date(m.createdAt) >= monthStart)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 100);

    res.json({ success: true, data: mutasi, akun: { namaAkun: akun.namaAkun, saldo: akun.saldo, icon: akun.icon, iconFile: akun.iconFile } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// POST isi saldo / top up
exports.topUpSaldo = async (req, res) => {
  try {
    const { akunId, amount, keterangan } = req.body;
    if (!amount || amount === 0) return res.status(400).json({ success: false, message: 'Nominal tidak valid' });

    const cabangQ = req.cabangFilter || {};
    const akun = await Saldo.findOne({ akunId, ...cabangQ });
    if (!akun) return res.status(404).json({ success: false, message: 'Akun tidak ditemukan' });

    const nominal = Number(amount);
    const saldoBefore = akun.saldo;
    akun.saldo += nominal; // bisa + atau -

    akun.mutasi.push({
      type: nominal >= 0 ? 'masuk' : 'keluar',
      amount: Math.abs(nominal),
      keterangan: keterangan || (nominal >= 0 ? 'Top Up Saldo' : 'Pengurangan Saldo'),
      saldoBefore,
      saldoAfter: akun.saldo,
      createdBy: req.user?._id
    });

    await akun.save({ validateBeforeSave: false });

    const io = req.app.get('io');
    io?.emit('saldoUpdated', { akunId, saldo: akun.saldo });

    res.json({ success: true, data: akun, message: 'Saldo berhasil diupdate' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// POST transfer antar akun
exports.transferSaldo = async (req, res) => {
  try {
    const { fromAkunId, toAkunId, amount, keterangan, biayaTransfer } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ success: false, message: 'Nominal tidak valid' });
    if (fromAkunId === toAkunId) return res.status(400).json({ success: false, message: 'Akun asal & tujuan tidak boleh sama' });

    const cabangQ = req.cabangFilter || {};
    const fromAkun = await Saldo.findOne({ akunId: fromAkunId, ...cabangQ });
    const toAkun = await Saldo.findOne({ akunId: toAkunId, ...cabangQ });
    if (!fromAkun || !toAkun) return res.status(404).json({ success: false, message: 'Akun tidak ditemukan' });

    const totalKeluar = Number(amount) + (Number(biayaTransfer) || 0);
    if (fromAkun.saldo < totalKeluar) return res.status(400).json({ success: false, message: `Saldo ${fromAkun.namaAkun} tidak mencukupi` });

    const ket = keterangan || `Transfer ke ${toAkun.namaAkun}`;

    // Kurangi saldo asal
    const fromBefore = fromAkun.saldo;
    fromAkun.saldo -= totalKeluar;
    fromAkun.mutasi.push({ type: 'keluar', amount: totalKeluar, keterangan: ket, saldoBefore: fromBefore, saldoAfter: fromAkun.saldo, createdBy: req.user._id });

    // Tambah saldo tujuan
    const toBefore = toAkun.saldo;
    toAkun.saldo += Number(amount);
    toAkun.mutasi.push({ type: 'masuk', amount: Number(amount), keterangan: `Transfer dari ${fromAkun.namaAkun}`, saldoBefore: toBefore, saldoAfter: toAkun.saldo, createdBy: req.user._id });

    await fromAkun.save({ validateBeforeSave: false });
    await toAkun.save({ validateBeforeSave: false });

    const io = req.app.get('io');
    io?.emit('saldoUpdated');

    res.json({ success: true, message: `Transfer berhasil: ${fromAkun.namaAkun} → ${toAkun.namaAkun}` });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// POST koreksi saldo manual (admin)
exports.koreksiSaldo = async (req, res) => {
  try {
    const { akunId, saldoBaru, keterangan } = req.body;
    const cabangQ = req.cabangFilter || {};
    const akun = await Saldo.findOne({ akunId, ...cabangQ });
    if (!akun) return res.status(404).json({ success: false, message: 'Akun tidak ditemukan' });
    const saldoBefore = akun.saldo;
    const selisih = Number(saldoBaru) - saldoBefore;
    akun.saldo = Number(saldoBaru);
    akun.mutasi.push({
      type: selisih >= 0 ? 'masuk' : 'keluar',
      amount: Math.abs(selisih),
      keterangan: keterangan || 'Koreksi Saldo Manual',
      saldoBefore, saldoAfter: akun.saldo,
      createdBy: req.user._id
    });
    await akun.save({ validateBeforeSave: false });
    res.json({ success: true, data: akun, message: 'Saldo berhasil dikoreksi' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// POST kurangi saldo (dipanggil dari transaksi)
exports.kurangiSaldo = async (akunId, amount, keterangan, userId, refTransaksi) => {
  try {
    const akun = await Saldo.findOne({ akunId });
    if (!akun) return;
    const saldoBefore = akun.saldo;
    akun.saldo -= Number(amount);
    akun.mutasi.push({ type: 'keluar', amount: Number(amount), keterangan, refTransaksi, saldoBefore, saldoAfter: akun.saldo, createdBy: userId });
    await akun.save({ validateBeforeSave: false });
  } catch (err) { console.error('Error kurangi saldo:', err.message); }
};

// POST tambah akun saldo baru
exports.tambahAkun = async (req, res) => {
  try {
    const { akunId, namaAkun, group, icon, iconFile, allowedMenus, menuOrder } = req.body;
    if (!akunId || !namaAkun || !group) {
      return res.status(400).json({ success: false, message: 'akunId, namaAkun, dan group wajib diisi' });
    }
    const cabangId = req.user.role === 'superadmin' ? null : (req.user.cabang?._id || req.user.cabang || null);
    const cabangQ = req.cabangFilter || {};
    // Cek duplikat akunId per cabang
    const existing = await Saldo.findOne({ akunId, ...cabangQ });
    if (existing) return res.status(400).json({ success: false, message: 'ID Akun sudah digunakan di cabang ini' });

    const akun = await Saldo.create({
      akunId, namaAkun, group,
      icon: icon || '💳',
      iconFile: iconFile || '',
      saldo: 0,
      allowedMenus: Array.isArray(allowedMenus) ? allowedMenus : [],
      menuOrder:    Array.isArray(menuOrder)    ? menuOrder    : [],
      cabang: cabangId,
    });
    res.status(201).json({ success: true, data: akun, message: 'Akun berhasil ditambahkan' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// PUT update akun saldo
exports.updateAkun = async (req, res) => {
  try {
    const { namaAkun, group, icon, iconFile, isActive, allowedMenus, menuOrder } = req.body;
    const update = { namaAkun, group, icon, isActive };
    if (iconFile     !== undefined) update.iconFile     = iconFile;
    if (allowedMenus !== undefined) update.allowedMenus = Array.isArray(allowedMenus) ? allowedMenus : [];
    if (menuOrder    !== undefined) update.menuOrder    = Array.isArray(menuOrder)    ? menuOrder    : [];
    const akun = await Saldo.findOneAndUpdate(
      { akunId: req.params.akunId, ...(req.cabangFilter || {}) },
      update,
      { new: true, runValidators: true }
    );
    if (!akun) return res.status(404).json({ success: false, message: 'Akun tidak ditemukan' });
    res.json({ success: true, data: akun, message: 'Akun berhasil diupdate' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// DELETE nonaktifkan akun saldo
exports.deleteAkun = async (req, res) => {
  try {
    const cabangQ = req.cabangFilter || {};
    const akun = await Saldo.findOne({ akunId: req.params.akunId, ...cabangQ });
    if (!akun) return res.status(404).json({ success: false, message: 'Akun tidak ditemukan' });
    if (akun.saldo !== 0) return res.status(400).json({ success: false, message: 'Saldo harus 0 sebelum dihapus' });
    akun.isActive = false;
    await akun.save({ validateBeforeSave: false });
    res.json({ success: true, message: 'Akun dinonaktifkan' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// GET semua akun termasuk nonaktif (untuk admin)
exports.getAllAkunAdmin = async (req, res) => {
  try {
    const cabangQ = req.cabangFilter || {};
    const saldos = await Saldo.find({ ...cabangQ }).select('-mutasi').sort('group namaAkun');
    res.json({ success: true, data: saldos });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
