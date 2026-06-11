const mongoose = require('mongoose');

const pointLogSchema = new mongoose.Schema({
  customer:    { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  type:        { type: String, enum: ['earn', 'redeem', 'manual', 'expire'], required: true },
  points:      { type: Number, required: true }, // + untuk earn, - untuk redeem
  description: { type: String },
  transaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('PointLog', pointLogSchema);
