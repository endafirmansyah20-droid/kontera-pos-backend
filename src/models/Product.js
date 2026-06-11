const mongoose = require('mongoose');

// Batch stok untuk FIFO (First In First Out) - harga modal bisa beda tiap batch
const stockBatchSchema = new mongoose.Schema({
  quantity:      { type: Number, required: true },
  remainingQty:  { type: Number, required: true },
  purchasePrice: { type: Number, required: true },
  receivedDate:  { type: Date, default: Date.now },
  expiryDate:    { type: Date, default: null },   // opsional — tanggal kadaluwarsa
  notes:         { type: String }
});

const productSchema = new mongoose.Schema({
  code: { type: String, required: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  category: {
    type: String,
    enum: ['pulsa', 'kartu_perdana', 'voucher_data', 'aksesoris', 'paket_data', 'token_listrik', 'ewallet', 'game', 'parfum', 'sparepart', 'lainnya'],
    required: true
  },
  type: { type: String, enum: ['fisik', 'digital', 'jasa'], default: 'fisik' },
  description: { type: String },
  
  // Untuk produk FISIK
  stock: { type: Number, default: 0 },
  minStock: { type: Number, default: 5, min: 0 }, // Notifikasi stok menipis
  stockBatches: [stockBatchSchema], // FIFO batches
  
  // Harga jual (sama untuk semua batch)
  sellPrice: { type: Number, required: true },
  
  // Untuk produk DIGITAL - harga modal tetap
  purchasePrice: { type: Number },
  
  unit: { type: String, default: 'pcs' },
  image: { type: String },
  isActive:   { type: Boolean, default: true },
  earnPoints:  { type: Boolean, default: false }, // Produk ini dapat poin member
  pointValue:  { type: Number, default: 0 },      // Jumlah poin per transaksi produk ini (0 = pakai sistem global untuk digital, tidak dapat untuk fisik)
  cabang:     { type: mongoose.Schema.Types.ObjectId, ref: 'Cabang', index: true },
  
  // Operator/provider (untuk pulsa, paket data)
  provider: { type: String },
  denomination: { type: Number } // Nominal (e.g., 10000 untuk pulsa 10rb)
}, { timestamps: true });

// Virtual: harga modal rata-rata FIFO (harga modal batch terlama yang masih ada stok)
productSchema.virtual('currentPurchasePrice').get(function() {
  try {
    if (this.type === 'digital') return this.purchasePrice || 0;
    if (!this.stockBatches || !Array.isArray(this.stockBatches)) return 0;
    const activeBatch = this.stockBatches.find(b => b.remainingQty > 0);
    return activeBatch ? activeBatch.purchasePrice : 0;
  } catch(e) {
    return 0;
  }
});

productSchema.set('toJSON', { virtuals: true });
productSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Product', productSchema);
