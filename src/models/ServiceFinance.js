const mongoose = require('mongoose');

const serviceFinanceSchema = new mongoose.Schema({
  type:        { type: String, enum: ['pengeluaran', 'pemasukan'], required: true },
  amount:      { type: Number, required: true },
  description: { type: String, required: true, trim: true },
  category:    { type: String, default: 'umum' }, // sparepart, peralatan, operasional, dll
  date:        { type: Date, default: Date.now },
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  isArchived:  { type: Boolean, default: false },
  notes:       { type: String, default: '' },
  cabang: { type: mongoose.Schema.Types.ObjectId, ref: 'Cabang', index: true },
}, { timestamps: true });

module.exports = mongoose.model('ServiceFinance', serviceFinanceSchema);
