const mongoose = require('mongoose');

const closingKasSchema = new mongoose.Schema({
  tanggal: { type: Date, default: Date.now },
  shift: { type: String, enum: ['pagi', 'siang', 'malam', 'full'], default: 'full' },
  type: { type: String, enum: ['cash', 'produk'], default: 'cash' },

  // Data cash
  saldoSistem: { type: Number, default: 0 },
  totalPemasukanCash: { type: Number, default: 0 },
  totalPengeluaranCash: { type: Number, default: 0 },
  totalTransaksiCash: { type: Number, default: 0 },
  jumlahTransaksi: { type: Number, default: 0 },
  uangFisik: {
    lembar100rb: { type: Number, default: 0 },
    lembar50rb:  { type: Number, default: 0 },
    lembar20rb:  { type: Number, default: 0 },
    lembar10rb:  { type: Number, default: 0 },
    lembar5rb:   { type: Number, default: 0 },
    lembar2rb:   { type: Number, default: 0 },
    lembar1rb:   { type: Number, default: 0 },
    koin500:     { type: Number, default: 0 },
    koin200:     { type: Number, default: 0 },
    koin100:     { type: Number, default: 0 },
  },
  totalFisik: { type: Number, default: 0 },
  selisih: { type: Number, default: 0 },
  statusSelisih: { type: String, enum: ['sesuai', 'lebih', 'kurang'], default: 'sesuai' },
  saldoKasSebelum: { type: Number, default: 0 },
  saldoKasSetelah: { type: Number, default: 0 },

  // Cash Plus & Minus
cashPlus: { type: Number, default: 0 },
cashMinus: { type: Number, default: 0 },
netCash: { type: Number, default: 0 },
// Uang Plus yang disetorkan saat closing produk
uangPlusSetor: { type: Number, default: 0 },
uangPlusReset: { type: Boolean, default: false },
// Cash Plus yang dipakai menutup selisih minus produk di sesi closing ini
cashPlusUsed: { type: Number, default: 0 },
totalQris: { type: Number, default: 0 },
totalTransfer: { type: Number, default: 0 },

// Nilai selisih produk
nilaiSelisihProduk: { type: Number, default: 0 },

  // Data produk
  produkItems: [{
    productId: String,
    productCode: String,
    productName: String,
    stokSistem: Number,
    stokFisik: Number,
    selisih: Number,
    hargaJual: Number,
nilaiSelisih: Number,
  }],
  totalSelisihProduk: { type: Number, default: 0 },

  // Umum
  catatan: { type: String },
  catatanSelisih: { type: String },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  cabang: { type: mongoose.Schema.Types.ObjectId, ref: 'Cabang', index: true },
  createdByName: { type: String },
}, { timestamps: true });

module.exports = mongoose.model('ClosingKas', closingKasSchema);