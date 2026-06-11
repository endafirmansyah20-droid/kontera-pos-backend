require('dotenv').config();
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const T = require('./src/models/Transaction');
  
  // Cari semua transaksi tarik tunai dengan profit negatif
  const txList = await T.find({ 
    'items.category': 'tarik_tunai', 
    totalProfit: { $lt: 0 },
    isVoid: false 
  });
  
  console.log(`Found ${txList.length} transaksi untuk difix`);
  
  for (const tx of txList) {
    for (const item of tx.items) {
      if (item.category === 'tarik_tunai') {
        // Profit = fee (sellPrice) + cashback saja
        item.profit = item.sellPrice + (item.cashback || 0);
      }
    }
    tx.totalProfit = tx.items.reduce((s, i) => s + (i.profit || 0), 0);
    await tx.save({ validateBeforeSave: false });
    console.log(`Fixed: ${tx.invoiceNumber} -> totalProfit: ${tx.totalProfit}`);
  }
  
  console.log('Done!');
  process.exit();
});
