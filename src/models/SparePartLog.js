const mongoose = require('mongoose');

const sparePartLogSchema = new mongoose.Schema({
  sparepart:          { type: mongoose.Schema.Types.ObjectId, ref: 'SparePartStock', required: true, index: true },
  cabang:             { type: mongoose.Schema.Types.ObjectId, ref: 'Cabang', required: true, index: true },
  jenis:              { type: String, enum: ['masuk', 'keluar'], required: true },
  jumlah:             { type: Number, required: true, min: 1 },
  hargaBeli:          { type: Number, default: 0 },
  stokSebelum:        { type: Number, required: true },
  stokSesudah:        { type: Number, required: true },
  keterangan:         { type: String, default: '' },
  serviceTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceTransaction', default: null },
  createdBy:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

module.exports = mongoose.model('SparePartLog', sparePartLogSchema);
