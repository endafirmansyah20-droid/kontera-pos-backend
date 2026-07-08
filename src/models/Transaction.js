const mongoose = require('mongoose');

const transactionItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  productCode: { type: String },
  productName: { type: String, required: true },
  category: { type: String },
  type: { type: String, enum: ['fisik', 'digital', 'jasa'] },
  quantity: { type: Number, default: 1 },
  sellPrice: { type: Number, required: true },
  purchasePrice: { type: Number, required: true },
  subtotal: { type: Number, required: true },
  profit: { type: Number },
  targetNumber: { type: String },
  notes: { type: String },

  // Field tambahan untuk produk digital
  sumberDana: { type: String },
  sumberDanaLabel: { type: String },
  sumberDanaIcon: { type: String },
  modalAmount: { type: Number },
  cashback: { type: Number, default: 0 },
  pointValue: { type: Number, default: 0 }, // poin custom per produk saat transaksi
  transferData: {
    dari: { type: String },
    ke: { type: String },
    nominal: { type: Number },
    biaya: { type: Number }
  }
});

const transactionSchema = new mongoose.Schema({
  invoiceNumber: { type: String, unique: true },
  transactionDate: { type: Date, default: Date.now },
  items: [transactionItemSchema],
  
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
  customerName: { type: String, default: 'Umum' },
  customerPhone: { type: String },
  
  subtotal: { type: Number, required: true },
  discount: { type: Number, default: 0 },
  total: { type: Number, required: true },
  totalProfit: { type: Number, default: 0 },
  
  paymentMethod: { type: String, enum: ['cash', 'qris', 'transfer', 'hutang'], default: 'cash' },
  paymentStatus: { type: String, enum: ['lunas', 'hutang', 'partial'], default: 'lunas' },
  amountPaid: { type: Number },
  change: { type: Number, default: 0 },
  
  type: { type: String, enum: ['penjualan', 'pembelian', 'tarik_tunai'], default: 'penjualan' },
  
  cashier: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  cashierName: { type: String },
  
  notes: { type: String },
  isVoid: { type: Boolean, default: false },
  isGrosir: { type: Boolean, default: false },
  cabang: { type: mongoose.Schema.Types.ObjectId, ref: 'Cabang', index: true },
  voidReason: { type: String },
  voidAt: { type: Date },
  voidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  voidByName: { type: String },

  // FIX: transferData di level transaksi — menyimpan akun tujuan pembayaran transfer/qris
  // Sebelumnya field ini tidak ada di schema sehingga Mongoose membuangnya saat save
  // dan void tidak bisa membaca akunId untuk mengembalikan saldo
  transferData: {
    akunId:    { type: String },   // akunId tujuan (mis: 'brimo', 'bca', 'dana1', dll)
    namaAkun:  { type: String },   // label akun (opsional, untuk keterangan mutasi)
    nominal:   { type: Number }    // nominal transfer (opsional)
  }
}, { timestamps: true });

// Auto generate invoice number
// Helper: singkat kode cabang jadi 3-4 huruf kapital
// Contoh: GALAXYCELL → GCL, GREENFLASH → GRF, BINTANGCELL → BNC
function singkatKode(kode = '') {
  const k = kode.toUpperCase().replace(/[^A-Z]/g, '');
  if (k.length <= 4) return k;
  // Kalau ada 2+ kata (ada angka atau pola tertentu), ambil huruf pertama tiap bagian
  // Untuk 1 kata panjang: ambil huruf pertama + konsonan ke-2 + konsonan terakhir
  const VOWELS = 'AEIOU';
  const consonants = k.split('').filter(c => !VOWELS.includes(c));
  if (consonants.length >= 3) {
    return consonants[0] + consonants[Math.floor(consonants.length / 2)] + consonants[consonants.length - 1];
  }
  return k.slice(0, 3);
}

transactionSchema.pre('save', async function(next) {
  if (!this.invoiceNumber) {
    // FIXED: Pakai timezone Asia/Jakarta agar tanggal di invoice sesuai WIB
    const now = new Date();
    const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000); // UTC+7
    const dateStr = wib.toISOString().slice(0, 10).replace(/-/g, '');

    // Ambil kode cabang untuk prefix invoice
    let kodePrefix = 'GBL';
    if (this.cabang) {
      const Cabang = mongoose.model('Cabang');
      const cab    = await Cabang.findById(this.cabang).select('kode').lean();
      if (cab?.kode) kodePrefix = singkatKode(cab.kode);
    }

    // FIXED: Hitung berdasarkan prefix invoice hari ini (bukan countDocuments by date)
    // Lebih aman: cari invoice terakhir dengan prefix yang sama lalu increment
    const prefix = `INV-${dateStr}-${kodePrefix}-`;
    const last = await mongoose.model('Transaction').findOne(
      { invoiceNumber: { $regex: `^${prefix}` } },
      { invoiceNumber: 1 },
      { sort: { invoiceNumber: -1 } }
    ).lean();

    let nextNum = 1;
    if (last?.invoiceNumber) {
      const lastNum = parseInt(last.invoiceNumber.split('-').pop()) || 0;
      nextNum = lastNum + 1;
    }

    this.invoiceNumber = `${prefix}${String(nextNum).padStart(4, '0')}`;
  }
  next();
});

module.exports = mongoose.model('Transaction', transactionSchema);
