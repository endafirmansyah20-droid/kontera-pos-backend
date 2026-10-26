const mongoose = require('mongoose');

const sparePartStockSchema = new mongoose.Schema({
  nama:      { type: String, required: true, trim: true },
  kategori:  { type: String, trim: true, default: '' },
  hargaBeli: { type: Number, required: true, min: 0 },
  hargaJual: { type: Number, required: true, min: 0 },
  stok:      { type: Number, required: true, default: 0, min: 0 },
  satuan:    { type: String, default: 'unit' },
  cabang:    { type: mongoose.Schema.Types.ObjectId, ref: 'Cabang', required: true, index: true },
  isActive:  { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('SparePartStock', sparePartStockSchema);
