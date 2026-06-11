const mongoose = require('mongoose');

const serviceTransactionSchema = new mongoose.Schema({
  // ── Nomor invoice ──────────────────────────────────────────
  invoiceNumber: { type: String, unique: true },

  // ── Data pelanggan ─────────────────────────────────────────
  customerName:  { type: String, required: true, trim: true },
  customerPhone: { type: String, trim: true, default: '' },
  customerId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },

  // ── Data HP ────────────────────────────────────────────────
  deviceBrand:   { type: String, trim: true, default: '' }, // Merk: Samsung, iPhone, dll
  deviceModel:   { type: String, trim: true, default: '' }, // Tipe: Galaxy A54, iPhone 13
  deviceColor:   { type: String, trim: true, default: '' },
  imei:          { type: String, trim: true, default: '' },

  // ── Kerusakan & pekerjaan ──────────────────────────────────
  complaint:     { type: String, required: true, trim: true }, // Keluhan pelanggan
  diagnosis:     { type: String, trim: true, default: '' },    // Diagnosa teknisi
  workDone:      { type: String, trim: true, default: '' },    // Pekerjaan yang dilakukan

  // ── Biaya ──────────────────────────────────────────────────
  partsCost:     { type: Number, default: 0 },  // Biaya sparepart / bahan
  serviceFee:    { type: Number, default: 0 },  // Biaya jasa
  totalCost:     { type: Number, default: 0 },  // partsCost + serviceFee

  // ── Profit (biaya jasa adalah laba, parts adalah modal) ────
  profit:        { type: Number, default: 0 },  // serviceFee - overhead (= serviceFee saja by default)

  // ── Status servis ──────────────────────────────────────────
  status: {
    type: String,
    enum: ['antrian', 'proses', 'selesai', 'diambil', 'batal'],
    default: 'antrian'
  },

  // ── Pembayaran ─────────────────────────────────────────────
  isPaid:        { type: Boolean, default: false },
  paidAt:        { type: Date },
  paymentMethod: { type: String, default: 'cash' },

  // ── Tanggal masuk & estimasi selesai ──────────────────────
  receivedAt:    { type: Date, default: Date.now },
  estimatedDone: { type: Date },

  // ── Keuangan servis terpisah ───────────────────────────────
  // Pengeluaran khusus servis dicatat di ServiceFinance

  // ── Metadata ───────────────────────────────────────────────
  createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  notes:      { type: String, default: '' },
  isVoid:     { type: Boolean, default: false },
  isArchived: { type: Boolean, default: false },
  cabang: { type: mongoose.Schema.Types.ObjectId, ref: 'Cabang', index: true },
}, { timestamps: true });

// Auto-generate invoice number
serviceTransactionSchema.pre('save', async function (next) {
  if (this.invoiceNumber) return next();
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  const count = await this.constructor.countDocuments({
    invoiceNumber: new RegExp(`^SRV-${dateStr}-`)
  });
  this.invoiceNumber = `SRV-${dateStr}-${String(count + 1).padStart(4, '0')}`;
  next();
});

// Auto-hitung totalCost & profit sebelum save
serviceTransactionSchema.pre('save', function (next) {
  this.totalCost = this.serviceFee || 0;           // Total bayar pelanggan = Biaya Service HP
  this.profit    = (this.serviceFee || 0) - (this.partsCost || 0); // Laba = Service - Sparepart
  next();
});

module.exports = mongoose.model('ServiceTransaction', serviceTransactionSchema);
