const mongoose = require('mongoose');

const servicePriceSchema = new mongoose.Schema({
  tipeHP:         { type: String, required: true, trim: true },
  merek:          { type: String, required: true, trim: true },
  jenisKerusakan: { type: String, required: true, trim: true },
  harga:          { type: Number, required: true, min: 0 },
  keterangan:     { type: String, default: '' },
  cabang:         { type: mongoose.Schema.Types.ObjectId, ref: 'Cabang', required: true, index: true },
  isActive:       { type: Boolean, default: true },
}, { timestamps: true });

servicePriceSchema.index({ cabang: 1, merek: 1 });
servicePriceSchema.index({ cabang: 1, tipeHP: 1 });

module.exports = mongoose.model('ServicePrice', servicePriceSchema);
