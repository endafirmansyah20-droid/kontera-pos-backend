const mongoose = require('mongoose');
require('dotenv').config();
mongoose.connect(process.env.MONGODB_URI);
setTimeout(async () => {
  const db = mongoose.connection.db;

  const toFix = [
    { inv: 'INV-20260525-GXY-0220', akunId: 'dana2',          modal: 25000  },
    { inv: 'INV-20260526-GXY-0004', akunId: 'dana2',          modal: 10000  },
    { inv: 'INV-20260526-GXY-0007', akunId: 'brimo',          modal: 400000 },
    { inv: 'INV-20260526-GXY-0011', akunId: 'bri_merchant',   modal: 2000   },
    { inv: 'INV-20260526-GXY-0013', akunId: 'bri_merchant',   modal: 2000   },
    { inv: 'INV-20260526-GXY-0017', akunId: 'radar_pulsa',    modal: 99796  },
    { inv: 'INV-20260526-GXY-0018', akunId: 'radar_pulsa',    modal: 5025   },
    { inv: 'INV-20260526-GXY-0022', akunId: 'bri_merchant',   modal: 2000   },
    { inv: 'INV-20260526-GXY-0023', akunId: 'mitra_bukalapak',modal: 21800  },
    { inv: 'INV-20260526-GXY-0029', akunId: 'dana1',          modal: 3000   },
  ];

  for (const item of toFix) {
    const tx = await db.collection('transactions').findOne({ invoiceNumber: item.inv });
    if (!tx) { console.log('TX not found:', item.inv); continue; }

    const saldo = await db.collection('saldos').findOne({ akunId: item.akunId });
    if (!saldo) { console.log('Saldo not found:', item.akunId); continue; }

    const saldoBefore = saldo.saldo || 0;
    const saldoAfter  = saldoBefore - item.modal;

    await db.collection('saldos').updateOne(
      { akunId: item.akunId },
      {
        $set: { saldo: saldoAfter, updatedAt: new Date() },
        $push: {
          mutasi: {
            _id: new mongoose.Types.ObjectId(),
            type: 'keluar',
            amount: item.modal,
            keterangan: `Fix mutasi | ${item.inv}`,
            saldoBefore,
            saldoAfter,
            createdAt: tx.createdAt,
            updatedAt: new Date(),
          }
        }
      }
    );
    console.log(`FIXED: ${item.inv} | ${item.akunId} | -${item.modal} | ${saldoBefore} -> ${saldoAfter}`);
  }

  console.log('Selesai!');
  process.exit();
}, 2000);
