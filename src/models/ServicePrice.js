const mongoose = require('mongoose');

const hargaItemSchema = new mongoose.Schema({
  harga:      { type: Number, required: true, min: 0 },
  keterangan: { type: String, default: '' },
}, { _id: false });

const servicePriceSchema = new mongoose.Schema({
  tipeHP:         { type: String, default: '', trim: true },
  merek:          { type: String, required: true, trim: true },
  jenisKerusakan: { type: String, required: true, trim: true },
  hargaList:      { type: [hargaItemSchema], default: [] },
  // Legacy fields — dipertahankan agar data lama tetap bisa dibaca
  harga:          { type: Number, min: 0 },
  keterangan:     { type: String, default: '' },
  cabang:         { type: mongoose.Schema.Types.ObjectId, ref: 'Cabang', required: true, index: true },
  isActive:       { type: Boolean, default: true },
}, { timestamps: true });

servicePriceSchema.index({ cabang: 1, merek: 1 });
servicePriceSchema.index({ cabang: 1, tipeHP: 1 });

// Backward compat: kalau hargaList kosong tapi legacy harga ada,
// konversi otomatis ke hargaList saat serialisasi output.
function normalizeOutput(_doc, ret) {
  if ((!Array.isArray(ret.hargaList) || ret.hargaList.length === 0) && ret.harga != null) {
    ret.hargaList = [{ harga: ret.harga, keterangan: ret.keterangan || '' }];
  }
  return ret;
}
servicePriceSchema.set('toJSON',   { virtuals: false, transform: normalizeOutput });
servicePriceSchema.set('toObject', { virtuals: false, transform: normalizeOutput });

module.exports = mongoose.model('ServicePrice', servicePriceSchema);
