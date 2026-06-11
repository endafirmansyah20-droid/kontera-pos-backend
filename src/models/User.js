const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name:     { type: String, required: true, trim: true },
  username: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true, minlength: 6 },
  role:     { type: String, enum: ['superadmin', 'owner', 'admin', 'karyawan'], default: 'karyawan' },
  cabang:   { type: mongoose.Schema.Types.ObjectId, ref: 'Cabang', default: null },
  avatar:   { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  lastLogin:{ type: Date }
}, { timestamps: true });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function(password) {
  return bcrypt.compare(password, this.password);
};

userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
