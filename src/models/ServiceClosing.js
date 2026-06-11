const mongoose = require('mongoose');

const serviceClosingSchema = new mongoose.Schema({
  bulan:        { type: Number, required: true }, // 1-12
  tahun:        { type: Number, required: true },
  label:        { type: String }, // "Mei 2026"
  // Ringkasan
  jumlahTx:     { type: Number, default: 0 },
  omsetMurni:   { type: Number, default: 0 },
  labaKotor:    { type: Number, default: 0 },
  totalExpense: { type: Number, default: 0 },
  labaBersih:   { type: Number, default: 0 },
  // Snapshot transaksi (id saja, data asli tetap di ServiceTransaction)
  transactionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ServiceTransaction' }],
  closedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  cabang:       { type: mongoose.Schema.Types.ObjectId, ref: 'Cabang', index: true },
}, { timestamps: true });

module.exports = mongoose.model('ServiceClosing', serviceClosingSchema);
