const mongoose = require('mongoose');

const lokasiSchema = new mongoose.Schema({
  lat:     { type: Number },
  lng:     { type: Number },
  akurasi: { type: Number }, // dalam meter, opsional dari client GPS
}, { _id: false });

const absensiSchema = new mongoose.Schema({
  user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User',   required: true, index: true },
  cabang:  { type: mongoose.Schema.Types.ObjectId, ref: 'Cabang', required: true, index: true },
  // tanggal di-normalize ke 00:00:00 WIB (UTC+7). Dipakai untuk group harian
  // & untuk unique index (cegah double check-in di hari yang sama).
  tanggal: { type: Date, required: true, index: true },

  status:  { type: String, enum: ['hadir', 'izin', 'sakit', 'cuti'], required: true, index: true },

  checkIn: {
    waktu:   { type: Date },
    lokasi:  { type: lokasiSchema },
    fotoUrl: { type: String, default: '' },
  },
  checkOut: {
    waktu:   { type: Date },
    lokasi:  { type: lokasiSchema },
    fotoUrl: { type: String, default: '' },
  },

  // Hanya relevan untuk status !== 'hadir'
  keterangan:     { type: String, default: '' },
  lampiranUrl:    { type: String, default: '' }, // opsional: surat sakit dll
  approvalStatus: { type: String, enum: ['pending', 'disetujui', 'ditolak'] },
  approvedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedAt:     { type: Date },
  alasanTolak:    { type: String, default: '' },
}, { timestamps: true });

// Cegah 1 user 2x absen di hari yang sama
absensiSchema.index({ user: 1, tanggal: 1 }, { unique: true });
// Query owner cross-cabang by tanggal (list & summary)
absensiSchema.index({ cabang: 1, tanggal: -1 });

module.exports = mongoose.model('Absensi', absensiSchema);
