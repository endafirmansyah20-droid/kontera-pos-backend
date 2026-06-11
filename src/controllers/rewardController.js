const Reward = require('../models/Reward');
const { Customer } = require('../models/index');
const PointLog = require('../models/PointLog');

// ─── GET: semua reward (per cabang) ──────────────────────────
exports.getRewards = async (req, res) => {
  try {
    const cabangQ = req.cabangFilter || {};
    const rewards = await Reward.find({ ...cabangQ, isActive: true }).sort({ pointsRequired: 1 });
    res.json({ success: true, data: rewards });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── GET: semua reward termasuk nonaktif (admin/owner) ───────
exports.getAllRewards = async (req, res) => {
  try {
    const cabangQ = req.cabangFilter || {};
    const rewards = await Reward.find(cabangQ).sort({ createdAt: -1 });
    res.json({ success: true, data: rewards });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── POST: tambah reward baru (admin/owner) ──────────────────
exports.createReward = async (req, res) => {
  try {
    const cabangQ = req.cabangFilter || {};
    const { name, description, pointsRequired, stock, image } = req.body;
    if (!name || !pointsRequired) return res.status(400).json({ success: false, message: 'Nama dan poin wajib diisi' });

    const reward = await Reward.create({
      name, description, pointsRequired: Number(pointsRequired),
      stock: Number(stock) || 0, image: image || '',
      cabang: cabangQ.cabang || null,
      createdBy: req.user._id,
    });
    res.status(201).json({ success: true, data: reward });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── PUT: update reward (admin/owner) ────────────────────────
exports.updateReward = async (req, res) => {
  try {
    const reward = await Reward.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!reward) return res.status(404).json({ success: false, message: 'Reward tidak ditemukan' });
    res.json({ success: true, data: reward });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── DELETE: hapus reward (admin/owner) ──────────────────────
exports.deleteReward = async (req, res) => {
  try {
    await Reward.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ─── POST: tukar poin dengan hadiah (kasir/admin) ────────────
exports.redeemReward = async (req, res) => {
  try {
    const { customerId, rewardId } = req.body;

    const customer = await Customer.findById(customerId);
    if (!customer) return res.status(404).json({ success: false, message: 'Pelanggan tidak ditemukan' });
    if (!customer.isMember) return res.status(400).json({ success: false, message: 'Pelanggan bukan member' });

    const reward = await Reward.findById(rewardId);
    if (!reward || !reward.isActive) return res.status(404).json({ success: false, message: 'Hadiah tidak tersedia' });
    if (reward.stock <= 0) return res.status(400).json({ success: false, message: 'Stok hadiah habis' });
    if (customer.points < reward.pointsRequired) return res.status(400).json({
      success: false,
      message: `Poin tidak cukup. Dibutuhkan ${reward.pointsRequired} poin, tersedia ${customer.points} poin`
    });

    // Kurangi poin pelanggan
    customer.points -= reward.pointsRequired;
    await customer.save();

    // Kurangi stok hadiah
    reward.stock -= 1;
    await reward.save();

    // Catat log poin
    await PointLog.create({
      customer: customerId,
      type: 'redeem',
      points: -reward.pointsRequired,
      description: `Tukar hadiah: ${reward.name}`,
      createdBy: req.user._id,
    });

    res.json({
      success: true,
      data: {
        reward: reward.name,
        pointsUsed: reward.pointsRequired,
        sisaPoin: customer.points,
        stokSisa: reward.stock,
      }
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
