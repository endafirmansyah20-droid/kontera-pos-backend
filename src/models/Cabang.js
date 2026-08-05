const mongoose = require('mongoose');

const cabangSchema = new mongoose.Schema({
  nama:     { type: String, required: true, trim: true },
  kode:     { type: String, required: true, unique: true, uppercase: true, trim: true },
  alamat:   { type: String, default: '' },
  telepon:  { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  owner:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdBy:{ type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // Koordinat cabang untuk validasi lokasi absensi.
  // Nullable: cabang lama yang belum di-set skip validasi (izinkan absen apa adanya).
  lokasi: {
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
  },
}, { timestamps: true });

module.exports = mongoose.model('Cabang', cabangSchema);
