const { Customer, Settings } = require('../models/index');
const PointLog = require('../models/PointLog');

// ─── Helper: hitung poin dari nominal belanja ─────────────────
async function calcEarnPoints(totalBelanja, cabangFilter = {}) {
  const settings = await Settings.findOne(cabangFilter);
  const perRupiah = settings?.pointSettings?.pointPerRupiah || 50;
  return Math.floor(totalBelanja / perRupiah);
}

// ─── GET: info poin pelanggan ─────────────────────────────────
exports.getCustomerPoints = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id).select('name phone points totalPoints isMember memberSince');
    if (!customer) return res.status(404).json({ success: false, message: 'Pelanggan tidak ditemukan' });

    const settings  = await Settings.findOne(req.cabangFilter || {});
    const pointSettings = settings?.pointSettings || {};

    const logs = await PointLog.find({ customer: req.params.id })
      .sort({ createdAt: -1 }).limit(20);

    res.json({ success: true, data: { customer, logs, pointSettings } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── POST: tambah poin manual (admin) ────────────────────────
exports.addPointsManual = async (req, res) => {
  try {
    const { points, description } = req.body;
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ success: false, message: 'Pelanggan tidak ditemukan' });

    customer.points      += points;
    customer.totalPoints += points;
    if (!customer.isMember) { customer.isMember = true; customer.memberSince = new Date(); }
    await customer.save();

    await PointLog.create({
      customer: customer._id, type: 'manual', points,
      description: description || `Penambahan poin manual oleh admin`,
      createdBy: req.user._id,
    });

    res.json({ success: true, data: { points: customer.points, totalPoints: customer.totalPoints } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── POST: aktivasi member ────────────────────────────────────
exports.activateMember = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) return res.status(404).json({ success: false, message: 'Pelanggan tidak ditemukan' });

    // Cek apakah sudah member
    if (customer.isMember) return res.status(400).json({ success: false, message: 'Pelanggan sudah terdaftar sebagai member' });

    // Cek duplikat nomor HP
    if (customer.phone) {
      const existing = await Customer.findOne({ phone: customer.phone, isMember: true, _id: { $ne: customer._id } });
      if (existing) return res.status(400).json({ success: false, message: `Nomor HP ini sudah terdaftar sebagai member atas nama ${existing.name}` });
    }

    customer.isMember    = true;
    customer.memberSince = customer.memberSince || new Date();
    await customer.save();

    res.json({ success: true, data: customer });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── GET: cek berapa poin yang akan didapat dari nominal ─────
exports.previewPoints = async (req, res) => {
  try {
    const { total } = req.query;
    const points = await calcEarnPoints(Number(total) || 0, req.cabangFilter || {});
    const settings = await Settings.findOne(req.cabangFilter || {});
    const rupiahPerPoint = settings?.pointSettings?.rupiahPerPoint || 10;
    const minRedeem      = settings?.pointSettings?.minRedeemPoints || 100;
    res.json({ success: true, data: { points, rupiahPerPoint, minRedeemPoints: minRedeem } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── POST: hitung & tambah poin setelah transaksi (per item) ──
// items: array dari transaction.items (sudah punya productType, pointValue, quantity)
exports.earnPointsAfterTransaction = async (customerId, transactionId, items, userId, cabangFilter) => {
  try {
    if (!customerId) return 0;
    const customer = await Customer.findById(customerId);
    if (!customer || !customer.isMember) return 0;

    // Ambil settings per cabang — jangan fallback ke doc arbitrary lintas cabang.
    // Kalau cabang tidak jelas atau belum punya Settings sendiri, pakai default literal.
    const settings = cabangFilter?.cabang
      ? await Settings.findOne({ cabang: cabangFilter.cabang })
      : null;
    if (settings?.pointSettings?.enabled === false) return 0;
    const perRupiah = settings?.pointSettings?.pointPerRupiah || 50;

    let totalPoints = 0;

    for (const item of (items || [])) {
      const qty        = item.quantity || 1;
      const isFisik    = item.type === 'fisik';
      const pointValue = item.pointValue || 0; // poin custom per produk

      if (pointValue > 0) {
        // Pakai poin custom per produk (fisik maupun digital)
        totalPoints += pointValue * qty;
      } else if (!isFisik) {
        // Digital tanpa poin custom → pakai PROFIT (admin fee) bukan subtotal
        // Lebih adil: top up 20rb admin 2rb = top up 100rb admin 2rb → poin sama
        const profit = item.profit || (item.subtotal - (item.modalAmount || item.purchasePrice || 0) * qty);
        if (profit > 0) totalPoints += Math.floor(profit / perRupiah);
      }
      // Fisik dengan pointValue=0 → tidak dapat poin
    }

    if (totalPoints <= 0) return 0;

    customer.points      += totalPoints;
    customer.totalPoints += totalPoints;
    await customer.save();

    await PointLog.create({
      customer: customerId, type: 'earn', points: totalPoints,
      description: `Poin dari transaksi`,
      transaction: transactionId,
      createdBy: userId,
    });

    return totalPoints;
  } catch { return 0; }
};

// ─── POST: redeem poin (dipakai di kasir) ────────────────────
exports.redeemPoints = async (req, res) => {
  try {
    const { customerId, pointsToRedeem } = req.body;
    const customer = await Customer.findById(customerId);
    if (!customer) return res.status(404).json({ success: false, message: 'Pelanggan tidak ditemukan' });
    if (!customer.isMember) return res.status(400).json({ success: false, message: 'Pelanggan bukan member' });

    // Scope ke cabang milik customer (bukan doc Settings arbitrary lintas cabang).
    // Kalau customer tidak punya cabang / cabang belum punya Settings, pakai default literal.
    const settings = customer.cabang
      ? await Settings.findOne({ cabang: customer.cabang })
      : null;
    const rupiahPerPoint = settings?.pointSettings?.rupiahPerPoint || 10;
    const minRedeem      = settings?.pointSettings?.minRedeemPoints || 100;

    if (pointsToRedeem < minRedeem) return res.status(400).json({ success: false, message: `Minimum redeem ${minRedeem} poin` });
    if (customer.points < pointsToRedeem) return res.status(400).json({ success: false, message: 'Poin tidak cukup' });

    const diskon = pointsToRedeem * rupiahPerPoint;
    customer.points -= pointsToRedeem;
    await customer.save();

    await PointLog.create({
      customer: customerId, type: 'redeem', points: -pointsToRedeem,
      description: `Redeem ${pointsToRedeem} poin = diskon ${diskon.toLocaleString('id-ID')}`,
      createdBy: req.user._id,
    });

    res.json({ success: true, data: { diskon, sisaPoin: customer.points } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
