const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  name:              { type: String, required: true, trim: true },
  phone:             { type: String, trim: true },
  address:           { type: String },
  notes:             { type: String },
  totalTransactions: { type: Number, default: 0 },
  totalSpent:        { type: Number, default: 0 },
  outstandingDebt:   { type: Number, default: 0 },
  // ── Member & Poin ──────────────────────────────
  isMember:    { type: Boolean, default: false },
  memberSince: { type: Date },
  points:      { type: Number, default: 0 },       // Poin saat ini
  totalPoints: { type: Number, default: 0 },
  cabang: { type: mongoose.Schema.Types.ObjectId, ref: 'Cabang', index: true },
}, { timestamps: true });

const financeSchema = new mongoose.Schema({
  type: { type: String, enum: ['pemasukan', 'pengeluaran', 'hutang', 'piutang'], required: true },
  category: { type: String, required: true },
  description: { type: String, required: true },
  amount: { type: Number, required: true },
  date: { type: Date, default: Date.now },
  relatedParty: { type: String },
  dueDate: { type: Date },
  isPaid: { type: Boolean, default: false },
  paidDate: { type: Date },
  reference: { type: String },
  sumberDana: { type: String, default: '' },     // akunId sumber dana (kosong = kas tunai)
  sumberDanaName: { type: String, default: '' }, // nama akun untuk tampilan
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  cabang: { type: mongoose.Schema.Types.ObjectId, ref: 'Cabang', index: true },
}, { timestamps: true });

const settingsSchema = new mongoose.Schema({
  storeName: { type: String, default: 'Konter Pulsa Saya' },
  storeAddress: { type: String, default: '' },
  storePhone: { type: String, default: '' },
  storeLogo: { type: String, default: '' },
  currency: { type: String, default: 'IDR' },
  taxRate: { type: Number, default: 0 },
  receiptFooter: { type: String, default: 'Terima kasih telah berbelanja!' },
  paymentMethods: {
    cash: { type: Boolean, default: true },
    qris: { type: Boolean, default: true },
    transfer: { type: Boolean, default: true }
  },
  lowStockThreshold: { type: Number, default: 5 },
  backupSchedule: { type: String, default: 'manual' },
  brankasAmount: { type: Number, default: 0 },
  cabang: { type: mongoose.Schema.Types.ObjectId, ref: 'Cabang', index: true },
  targetOmset: { type: Number, default: 0 }, // Target omset bulanan per cabang
  // ── Pengaturan Poin Member ─────────────────────
  pointSettings: {
    pointPerRupiah:   { type: Number, default: 50 },
    rupiahPerPoint:   { type: Number, default: 10 },
    minRedeemPoints:  { type: Number, default: 100 },
    enabled:          { type: Boolean, default: true },
  },
  // ── Pengaturan Marquee Motivasi ─────────────
  marqueeSettings: {
    enabled:  { type: Boolean, default: true },
    speed:    { type: Number, default: 28 }, // detik (semakin besar semakin lambat)
    messages: { type: [String], default: [
      '💪 Semangat bekerja! Kejujuran adalah aset terbaik kita',
      '🌟 Setiap transaksi yang jujur membangun kepercayaan pelanggan',
      '✅ Teliti sebelum input, cek kembali sebelum bayar',
      '🤝 Pelanggan yang puas adalah kebanggaan kita bersama',
      '💡 Input yang benar hari ini, laporan yang akurat esok hari',
      '🏆 Kerja keras dan jujur adalah kunci kesuksesan toko kita',
    ]},
  },
}, { timestamps: true });

const stockLogSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  productCode: String,
  productName: String,
  type: { type: String, enum: ['masuk', 'keluar', 'adjustment'], required: true },
  quantity: { type: Number, required: true },
  purchasePrice: { type: Number },
  notes: { type: String },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

const Customer = mongoose.model('Customer', customerSchema);
const Finance = mongoose.model('Finance', financeSchema);
const Settings = mongoose.model('Settings', settingsSchema);
const StockLog = mongoose.model('StockLog', stockLogSchema);

module.exports = { Customer, Finance, Settings, StockLog };