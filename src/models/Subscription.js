const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  owner:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  cabang:     { type: mongoose.Schema.Types.ObjectId, ref: 'Cabang', required: true },
  status:     { type: String, enum: ['aktif', 'nonaktif', 'gratis'], default: 'gratis' },
  expiredAt:  { type: Date, default: null },
  harga:      { type: Number, default: 30000 },
}, { timestamps: true });

module.exports = mongoose.model('Subscription', subscriptionSchema);
