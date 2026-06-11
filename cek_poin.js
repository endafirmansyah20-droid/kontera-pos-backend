const path = require('path');
require('dotenv').config({ path: '/home/galaxy/backend/.env' });
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGODB_URI).then(async () => {
  require('./src/models/index');
  const PointLog = require('./src/models/PointLog');
  const Transaction = require('./src/models/Transaction');
  const { Customer, Settings } = require('./src/models/index');

  const settings = await Settings.findOne();
  const pointPer = settings?.pointSettings?.pointPerRupiah || 50;

  const logs = await PointLog.find({ type: 'earn' }).select('points customer transaction');
  
  let suspicious = [];
  for (const l of logs) {
    if (!l.transaction) continue;
    const tx = await Transaction.findById(l.transaction).select('invoiceNumber totalProfit');
    if (!tx) continue;
    const seharusnya = Math.floor((tx.totalProfit || 0) / pointPer);
    const selisih = l.points - seharusnya;
    if (Math.abs(selisih) > 5) {
      const cust = await Customer.findById(l.customer).select('name points');
      suspicious.push({ member: cust?.name, invoice: tx.invoiceNumber, poinTercatat: l.points, seharusnya, selisih });
    }
  }
  
  console.log('Log poin yang kemungkinan salah:', suspicious.length);
  suspicious.forEach(s => console.log(JSON.stringify(s)));
  process.exit();
});
