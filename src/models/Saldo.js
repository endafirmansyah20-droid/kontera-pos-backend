const mongoose = require('mongoose');

const mutasiSchema = new mongoose.Schema({
  type: { type: String, enum: ['masuk', 'keluar'], required: true },
  amount: { type: Number, required: true },
  keterangan: { type: String, required: true },
  refTransaksi: { type: String }, // invoice number jika dari transaksi
  saldoBefore: { type: Number },
  saldoAfter: { type: Number },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

const ALLOWED_MENU_VALUES = [
  'pulsa', 'kuota', 'topup_ewallet', 'topup_game',
  'token_listrik', 'transfer', 'tarik_tunai', 'tagihan'
];

const saldoSchema = new mongoose.Schema({
  akunId:   { type: String, required: true },  // unique per cabang, bukan global
  namaAkun: { type: String, required: true },
  group:    { type: String, enum: ['Server Pulsa', 'Bank', 'E-Wallet', 'Tunai'], required: true },
  icon:     { type: String, default: '💳' },
  saldo:    { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  cabang:   { type: mongoose.Schema.Types.ObjectId, ref: 'Cabang', index: true },
  // Menu transaksi digital yang diizinkan. [] = tampil semua menu.
  allowedMenus: { type: [String], enum: ALLOWED_MENU_VALUES, default: [] },
  // Urutan tampil menu transaksi digital. [] = urutan default.
  menuOrder:    { type: [String], enum: ALLOWED_MENU_VALUES, default: [] },
  mutasi:   [mutasiSchema]
}, { timestamps: true });

module.exports = mongoose.model('Saldo', saldoSchema);