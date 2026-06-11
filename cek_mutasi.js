const mongoose = require('mongoose');
require('dotenv').config();
mongoose.connect(process.env.MONGODB_URI);
setTimeout(async () => {
  const db = mongoose.connection.db;

  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  threeDaysAgo.setHours(0,0,0,0);

  const txs = await db.collection('transactions').find({
    isVoid: false,
    customer: { $exists: true, $ne: null },
    createdAt: { $gte: threeDaysAgo }
  }).toArray();

  const saldos = await db.collection('saldos').find({}).toArray();
  const allMutasiKet = [];
  saldos.forEach(s => {
    (s.mutasi || []).forEach(m => allMutasiKet.push(m.keterangan || ''));
  });

  const missing = txs.filter(t => {
    return !allMutasiKet.some(k => k.includes(t.invoiceNumber));
  });

  console.log('Transaksi dengan member 3 hari:', txs.length);
  console.log('Total mutasi di semua akun:', allMutasiKet.length);
  console.log('Transaksi tidak ada di mutasi:', missing.length);
  missing.forEach(t => console.log(t.invoiceNumber, 'Rp', t.total, t.createdAt));
  process.exit();
}, 3000);
