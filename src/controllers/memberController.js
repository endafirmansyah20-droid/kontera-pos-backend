const { Customer, Settings } = require('../models/index');
const PointLog = require('../models/PointLog');
const Reward = require('../models/Reward');

const Transaction = require('../models/Transaction');

// ── POST: Login member pakai nomor HP ────────────────────────
exports.loginMember = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: 'Nomor HP wajib diisi' });

    const phoneClean = phone.replace(/[^0-9]/g, '').replace(/^62/, '0');
    const phoneAlt   = phoneClean.replace(/^0/, '62');

    const member = await Customer.findOne({
      isMember: true,
      $or: [
        { phone: phoneClean },
        { phone: phoneAlt },
        { phone: phone.trim() }
      ]
    });

    if (!member) return res.status(404).json({ success: false, message: 'Nomor tidak terdaftar sebagai member' });

    res.json({ success: true, data: {
      _id: member._id,
      name: member.name,
      phone: member.phone,
      points: member.points || 0,
      totalPoints: member.totalPoints || 0,
      totalTransactions: member.totalTransactions || 0,
      totalSpent: member.totalSpent || 0,
      memberSince: member.memberSince,
    }});
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── GET: Info poin dan riwayat member ───────────────────────
exports.getMemberInfo = async (req, res) => {
  try {
    const { id } = req.params;
    const member = await Customer.findById(id).select('name phone points totalPoints totalTransactions totalSpent memberSince isMember cabang');
    if (!member || !member.isMember) return res.status(404).json({ success: false, message: 'Member tidak ditemukan' });

    const logs = await PointLog.find({ customer: id }).sort({ createdAt: -1 }).limit(10);

    // Ambil settings per cabang
    const settings = await Settings.findOne(member.cabang ? { cabang: member.cabang } : {}) || await Settings.findOne();
    const pointSettings = settings?.pointSettings || {};
    const storeName     = settings?.storeName || 'Galaxy Cell';

    // Ambil reward yang tersedia
    const rewards = await Reward.find({
      isActive: true,
      stock: { $gt: 0 },
      ...(member.cabang ? { cabang: member.cabang } : {})
    }).sort({ pointsRequired: 1 });

    res.json({ success: true, data: {
      member: {
        _id: member._id,
        name: member.name,
        phone: member.phone,
        points: member.points || 0,
        totalPoints: member.totalPoints || 0,
        totalTransactions: member.totalTransactions || 0,
        totalSpent: member.totalSpent || 0,
        memberSince: member.memberSince,
      },
      logs,
      pointSettings,
      storeName,
      rewards,
    }});
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── GET: Riwayat transaksi member ───────────────────────────
exports.getMemberTransactions = async (req, res) => {
  try {
    const { id } = req.params;
    const customer = await Customer.findById(id).select('isMember');
    if (!customer || !customer.isMember) return res.status(404).json({ success: false, message: 'Member tidak ditemukan' });

    const transactions = await Transaction.find({
      customer: id,
      isVoid: false
    }).sort({ createdAt: -1 }).limit(20)
      .select('invoiceNumber total items createdAt earnedPoints paymentMethod');

    res.json({ success: true, data: transactions });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
