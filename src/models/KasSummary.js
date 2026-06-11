const mongoose = require('mongoose');

const kasSummarySchema = new mongoose.Schema({
  cabang: { type: mongoose.Schema.Types.ObjectId, ref: 'Cabang', default: null },
  totalCashPlus: { type: Number, default: 0 },
  totalCashMinus: { type: Number, default: 0 },
  lastResetCashPlus: { type: Date },
  lastResetCashMinus: { type: Date },
  lastResetBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('KasSummary', kasSummarySchema);