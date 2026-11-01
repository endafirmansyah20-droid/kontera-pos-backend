/**
 * ONE-SHOT BACKFILL
 * -----------------
 * Isi field completedAt untuk ServiceTransaction historis yang statusnya
 * sudah 'diambil' atau 'batal' tapi completedAt masih kosong (dokumen lama
 * sebelum field ini ditambahkan).
 *
 * Aturan: completedAt = updatedAt (fallback terbaik yang tersedia; mewakili
 * waktu transisi status terakhir untuk doc historis).
 *
 * Cara pakai:
 *   1) BACKUP DATABASE DULU (mongodump / snapshot).
 *   2) Dry-run (default, tidak menulis apa-apa, hanya laporan):
 *        node scripts/backfill-completedAt.js
 *   3) Kalau hasil dry-run sudah benar, eksekusi:
 *        node scripts/backfill-completedAt.js --commit
 *
 * Script BUKAN bagian dari startup server — harus dijalankan manual.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const COMMIT = process.argv.includes('--commit');

(async () => {
  if (!process.env.MONGODB_URI) {
    console.error('ERROR: MONGODB_URI tidak ditemukan di .env');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const col = mongoose.connection.db.collection('servicetransactions');

  const query = {
    status: { $in: ['diambil', 'batal'] },
    $or: [
      { completedAt: null },
      { completedAt: { $exists: false } },
    ],
  };

  const docs = await col.find(query).toArray();
  const total = docs.length;

  let updated = 0;
  let skippedNoFallback = 0;
  const skippedSamples = [];

  for (const doc of docs) {
    const fallback = doc.updatedAt || doc.receivedAt;
    if (!fallback) {
      skippedNoFallback++;
      if (skippedSamples.length < 10) {
        skippedSamples.push({ _id: doc._id, invoiceNumber: doc.invoiceNumber });
      }
      continue;
    }

    if (COMMIT) {
      await col.updateOne({ _id: doc._id }, { $set: { completedAt: fallback } });
    }
    updated++;
  }

  console.log('');
  console.log('=== Backfill ServiceTransaction.completedAt ===');
  console.log('Mode                              :', COMMIT ? 'COMMIT (data ditulis)' : 'DRY-RUN (tidak menulis)');
  console.log('Total kandidat (diambil/batal)    :', total);
  console.log('Diisi completedAt = updatedAt     :', updated);
  console.log('Di-skip (tidak ada fallback)      :', skippedNoFallback);

  if (skippedSamples.length > 0) {
    console.log('');
    console.log('Contoh entry yang di-skip karena tidak ada updatedAt/receivedAt:');
    for (const s of skippedSamples) {
      console.log(`  _id=${s._id}  invoice=${s.invoiceNumber || '-'}`);
    }
    if (skippedNoFallback > skippedSamples.length) {
      console.log(`  ... dan ${skippedNoFallback - skippedSamples.length} lainnya`);
    }
  }

  console.log('');
  console.log(COMMIT
    ? 'Selesai. Data sudah di-update. Verifikasi di tab Arsip Servis.'
    : 'Ini DRY-RUN. Jalankan ulang dengan flag --commit untuk menulis perubahan.');

  await mongoose.disconnect();
  process.exit(0);
})().catch(async (err) => {
  console.error('ERROR:', err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
