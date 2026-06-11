require('dotenv').config();
const mongoose = require('mongoose');
const Transaction = require('./src/models/Transaction');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const tx = await Transaction.find({
    transactionDate: { $gte: start, $lte: end },
    type: 'penjualan'
  });

  console.log('=== HASIL CEK ===');
  console.log('Transaksi hari ini:', tx.length);
  console.log('Total revenue:', tx.reduce((a, t) => a + t.total, 0));
  console.log('Total profit:', tx.reduce((a, t) => a + t.totalProfit, 0));
  tx.forEach(t => console.log('-', t.invoiceNumber, '| Rp', t.total, '| isVoid:', t.isVoid));
  process.exit(0);
}).catch(e => {
  console.log('Error:', e.message);
  process.exit(1);
});