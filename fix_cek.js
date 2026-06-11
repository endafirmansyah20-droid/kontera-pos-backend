const mongoose = require('mongoose');
require('dotenv').config();
mongoose.connect(process.env.MONGODB_URI);
setTimeout(async () => {
  const db = mongoose.connection.db;
  const missing = [
    'INV-20260525-GXY-0201','INV-20260526-GXY-0007','INV-20260526-GXY-0017'
  ];
  for (const inv of missing) {
    const tx = await db.collection('transactions').findOne({ invoiceNumber: inv });
    const hasSumberDana = tx.items?.some(i => i.sumberDana);
    console.log(inv, '| paymentMethod:', tx.paymentMethod, '| hasSumberDana:', hasSumberDana, '| total:', tx.total);
  }
  process.exit();
}, 2000);
