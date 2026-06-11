const mongoose = require('mongoose');
require('dotenv').config();
mongoose.connect(process.env.MONGODB_URI);
setTimeout(async () => {
  const db = mongoose.connection.db;
  const missing = [
    'INV-20260525-GXY-0201','INV-20260525-GXY-0210','INV-20260525-GXY-0220',
    'INV-20260526-GXY-0004','INV-20260526-GXY-0007','INV-20260526-GXY-0009',
    'INV-20260526-GXY-0011','INV-20260526-GXY-0012','INV-20260526-GXY-0013',
    'INV-20260526-GXY-0017','INV-20260526-GXY-0018','INV-20260526-GXY-0022',
    'INV-20260526-GXY-0023','INV-20260526-GXY-0029'
  ];
  for (const inv of missing) {
    const tx = await db.collection('transactions').findOne({ invoiceNumber: inv });
    const itemsWithSumber = tx.items?.filter(i => i.sumberDana) || [];
    if (itemsWithSumber.length > 0) {
      itemsWithSumber.forEach(i => {
        console.log(inv, '|', i.sumberDana, '|', i.sumberDanaLabel, '| modal:', i.purchasePrice, '| qty:', i.quantity);
      });
    }
  }
  console.log('Selesai scan');
  process.exit();
}, 2000);
