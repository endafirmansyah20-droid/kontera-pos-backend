const mongoose = require('mongoose');

const lokasiSchema = new mongoose.Schema({
  lat:     { type: Number },
  lng:     { type: Number },
  akurasi: { type: Number }, // dalam meter, opsional dari client GPS
}, { _id: false });

// Sub-doc pengajuan lembur (multiple per hari boleh, tapi hanya 1 aktif —
// pending/disetujui — yang di-guard di controller; rejected disimpan untuk audit).
// _id default true supaya endpoint approve bisa lookup by lemburId.
const lemburSchema = new mongoose.Schema({
  jamMulai:       { type: Date, required: true },
  jamSelesai:     { type: Date, required: true },
  durasiMenit:    { type: Number, required: true }, // precomputed saat create
  alasan:         { type: String, required: true, trim: true, maxlength: 500 },
  approvalStatus: { type: String, enum: ['pending', 'disetujui', 'ditolak'], default: 'pending' },
  approvedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedAt:     { type: Date },
  alasanTolak:    { type: String, default: '' },
}, { timestamps: true });

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

  // Pengajuan lembur untuk hari ini (hanya valid kalau status='hadir').
  lembur: { type: [lemburSchema], default: [] },
}, { timestamps: true });

// Cegah 1 user 2x absen di hari yang sama
absensiSchema.index({ user: 1, tanggal: 1 }, { unique: true });
// Query owner cross-cabang by tanggal (list & summary)
absensiSchema.index({ cabang: 1, tanggal: -1 });
// Untuk badge notif owner: pengajuan lembur pending lintas cabang
absensiSchema.index({ cabang: 1, 'lembur.approvalStatus': 1 });

module.exports = mongoose.model('Absensi', absensiSchema);
