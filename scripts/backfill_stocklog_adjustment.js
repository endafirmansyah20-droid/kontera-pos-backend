/**
 * ONE-SHOT BACKFILL
 * -----------------
 * Migrasi StockLog historis dengan type='adjustment' (dari bug Closing Produk
 * lama) ke type='masuk'/'keluar' berdasarkan arah perubahan yang ter-parse
 * dari field `notes`: "Closing Produk: <before> → <after>".
 *
 * Aturan:
 *   after > before  → type = 'masuk'
 *   after < before  → type = 'keluar'
 *   after === before → skip (tidak ada perubahan, aneh, jangan diubah)
 *   notes tidak match pola → skip (jangan asumsi, log untuk audit)
 *
 * Cara pakai:
 *   1) BACKUP DATABASE DULU (mongodump / snapshot).
 *   2) Dry-run (default, tidak menulis apa-apa, hanya laporan):
 *        node scripts/backfill_stocklog_adjustment.js
 *   3) Kalau hasil dry-run sudah benar, eksekusi:
 *        node scripts/backfill_stocklog_adjustment.js --commit
 *
 * Script BUKAN bagian dari startup server — harus dijalankan manual.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const COMMIT = process.argv.includes('--commit');
const NOTES_RE = /Closing Produk:\s*(\d+)\s*→\s*(\d+)/;

(async () => {
  if (!process.env.MONGODB_URI) {
    console.error('ERROR: MONGODB_URI tidak ditemukan di .env');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const col = mongoose.connection.db.collection('stocklogs');

  const docs = await col.find({ type: 'adjustment' }).toArray();

  const total = docs.length;
  let toMasuk = 0;
  let toKeluar = 0;
  let skippedNoMatch = 0;
  let skippedZero = 0;
  const skippedSamples = [];

  for (const doc of docs) {
    const notes = doc.notes || '';
    const m = notes.match(NOTES_RE);

    if (!m) {
      skippedNoMatch++;
      if (skippedSamples.length < 10) {
        skippedSamples.push({ _id: doc._id, notes });
      }
      continue;
    }

    const before = parseInt(m[1], 10);
    const after = parseInt(m[2], 10);

    if (after === before) {
      skippedZero++;
      continue;
    }

    const newType = after > before ? 'masuk' : 'keluar';

    if (COMMIT) {
      await col.updateOne({ _id: doc._id }, { $set: { type: newType } });
    }

    if (newType === 'masuk') toMasuk++;
    else toKeluar++;
  }

  console.log('');
  console.log('=== Backfill StockLog Adjustment ===');
  console.log('Mode                    :', COMMIT ? 'COMMIT (data ditulis)' : 'DRY-RUN (tidak menulis)');
  console.log('Total entry adjustment  :', total);
  console.log('Diubah ke "masuk"       :', toMasuk);
  console.log('Diubah ke "keluar"      :', toKeluar);
  console.log('Di-skip (notes N/A)     :', skippedNoMatch);
  console.log('Di-skip (before=after)  :', skippedZero);

  if (skippedSamples.length > 0) {
    console.log('');
    console.log('Contoh entry yang di-skip karena notes tidak match pola:');
    for (const s of skippedSamples) {
      console.log(`  _id=${s._id}  notes="${s.notes}"`);
    }
    if (skippedNoMatch > skippedSamples.length) {
      console.log(`  ... dan ${skippedNoMatch - skippedSamples.length} lainnya`);
    }
  }

  console.log('');
  console.log(COMMIT
    ? 'Selesai. Data sudah di-update. Verifikasi di UI Log Stok.'
    : 'Ini DRY-RUN. Jalankan ulang dengan flag --commit untuk menulis perubahan.');

  await mongoose.disconnect();
  process.exit(0);
})().catch(async (err) => {
  console.error('ERROR:', err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
