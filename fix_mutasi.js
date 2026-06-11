const mongoose = require('mongoose');
require('dotenv').config();
mongoose.connect(process.env.MONGODB_URI);

setTimeout(async () => {
  const db = mongoose.connection.db;

  const missingInvoices = [
    'INV-20260525-GXY-0201',
    'INV-20260525-GXY-0210',
    'INV-20260525-GXY-0220',
    'INV-20260526-GXY-0004',
    'INV-20260526-GXY-0007',
    'INV-20260526-GXY-0009',
    'INV-20260526-GXY-0011',
    'INV-20260526-GXY-0012',
    'INV-20260526-GXY-0013',
    'INV-20260526-GXY-0017',
    'INV-20260526-GXY-0018',
    'INV-20260526-GXY-0022',
    'INV-20260526-GXY-0023',
    'INV-20260526-GXY-0029',
  ];

  for (const inv of missingInvoices) {
    const tx = await db.collection('transactions').findOne({ invoiceNumber: inv });
    if (!tx) { console.log('TX not found:', inv); continue; }

    // Cari item yang pakai sumber dana (akunId)
    const items = tx.items || [];
    for (const item of items) {
      const akunId = item.sumberDana || item.akunId;
      if (!akunId) continue;

      const modal = item.modalAmount || item.purchasePrice || 0;
      if (!modal || modal <= 0) continue;

      const saldo = await db.collection('saldos').findOne({ akunId });
      if (!saldo) { console.log('Saldo not found:', akunId); continue; }

      const saldoBefore = saldo.saldo || 0;
      const saldoAfter  = saldoBefore - modal;

      await db.collection('saldos').updateOne(
        { akunId },
        {
          $set: { saldo: saldoAfter, updatedAt: new Date() },
          $push: {
            mutasi: {
              _id: new mongoose.Types.ObjectId(),
              type: 'keluar',
              amount: modal,
              keterangan: `${item.productName || 'Produk'} | ${inv}`,
              saldoBefore,
              saldoAfter,
              createdAt: tx.createdAt,
              updatedAt: new Date(),
            }
          }
        }
      );
      console.log(`FIXED: ${inv} | ${akunId} | -${modal} | ${saldoBefore} -> ${saldoAfter}`);
    }
  }

  console.log('Selesai!');
  process.exit();
}, 3000);
