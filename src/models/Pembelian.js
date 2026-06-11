const mongoose = require('mongoose');

const pembelianItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  productCode: String,
  productName: String,
  jumlah: { type: Number, required: true },
  hargaModalBaru: { type: Number, required: true },
  hargaModalLama: { type: Number, default: 0 },
  hargaJualSekarang: { type: Number, default: 0 },
  selisihModal: { type: Number, default: 0 },
  perluUpdateHarga: { type: Boolean, default: false },
  subtotal: { type: Number, default: 0 },
});

const pembelianSchema = new mongoose.Schema({
  nomorPO: { type: String },
  supplier: { type: String },
  tanggal: { type: Date, default: Date.now },
  items: [pembelianItemSchema],
  totalItem: { type: Number, default: 0 },
  totalHarga: { type: Number, default: 0 },
  catatan: { type: String },
  isBatal: { type: Boolean, default: false },
alasanBatal: { type: String },
batalBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
batalAt: { type: Date },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdByName: { type: String },
  cabang: { type: mongoose.Schema.Types.ObjectId, ref: 'Cabang', index: true },
}, { timestamps: true });

// Auto generate nomorPO
pembelianSchema.pre('save', async function(next) {
  if (!this.nomorPO) {
    const count = await mongoose.model('Pembelian').countDocuments();
    const date = new Date();
    this.nomorPO = `PO-${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}-${String(count+1).padStart(4,'0')}`;
  }
  next();
});

module.exports = mongoose.model('Pembelian', pembelianSchema);