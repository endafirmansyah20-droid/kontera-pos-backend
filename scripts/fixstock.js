require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('./src/models/Product');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const products = await Product.find({ type: 'fisik', stock: { $gt: 0 } });
  let fixed = 0;
  
  for (const p of products) {
    if (!p.stockBatches || p.stockBatches.length === 0) {
      p.stockBatches = [{
        quantity: p.stock,
        remainingQty: p.stock,
        purchasePrice: p.purchasePrice || 0,
        receivedDate: new Date()
      }];
      p.markModified('stockBatches');
      await p.save();
      fixed++;
      console.log('Fixed:', p.name, '- stok:', p.stock);
    }
  }
  
  console.log('\nTotal fixed:', fixed, 'produk');
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});