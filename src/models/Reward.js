const mongoose = require('mongoose');

const rewardSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  pointsRequired: { type: Number, required: true, min: 1 }, // poin yang dibutuhkan
  stock:       { type: Number, default: 0, min: 0 },        // stok hadiah
  isActive:    { type: Boolean, default: true },
  image:       { type: String, default: '' },               // URL gambar (opsional)
  cabang:      { type: mongoose.Schema.Types.ObjectId, ref: 'Cabang', index: true },
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('Reward', rewardSchema);
