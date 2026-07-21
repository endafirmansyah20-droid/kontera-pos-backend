/**
 * ONE-SHOT CLEANUP
 * ----------------
 * Menghapus field `fonnteSettings` dari SEMUA dokumen di collection
 * `settings`. Fitur Fonnte / notifikasi WA sudah dihapus dari kode
 * aplikasi (mainController + transactionController + models/index.js);
 * field ini sekarang orphan di database — masih menyimpan token +
 * device Fonnte tanpa fungsi apapun.
 *
 * Yang di-unset: HANYA field top-level `fonnteSettings`. Field lain
 * (storeName, pointSettings, marqueeSettings, cabang, dsb) TIDAK
 * disentuh.
 *
 * Cara pakai:
 *   1) BACKUP DATABASE DULU (mongodump / snapshot).
 *   2) Dry-run (default, tidak menulis apa-apa, hanya laporan):
 *        node scripts/cleanup_fonnte_settings.js
 *   3) Kalau hasil dry-run sudah benar, eksekusi:
 *        node scripts/cleanup_fonnte_settings.js --commit
 *
 * Reminder tambahan (di luar scope script ini):
 *   - Revoke token Fonnte di dashboard fonnte.com — token yang
 *     terlihat di preview di bawah pernah tersimpan di DB.
 *
 * Script BUKAN bagian dari startup server — harus dijalankan manual.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const COMMIT = process.argv.includes('--commit');

// Mask token supaya log dry-run tidak bocor kredensial penuh.
function maskToken(t) {
  if (!t || typeof t !== 'string') return '(kosong)';
  if (t.length <= 6) return '***';
  return `${t.slice(0, 3)}...${t.slice(-3)} (len=${t.length})`;
}

(async () => {
  if (!process.env.MONGODB_URI) {
    console.error('ERROR: MONGODB_URI tidak ditemukan di .env');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const col = mongoose.connection.db.collection('settings');

  // Hitung berapa doc yang punya field fonnteSettings.
  const total = await col.countDocuments({});
  const affected = await col.countDocuments({ fonnteSettings: { $exists: true } });

  // Preview isi field yang akan di-unset (token di-mask).
  const previews = await col
    .find({ fonnteSettings: { $exists: true } })
    .project({ _id: 1, storeName: 1, cabang: 1, fonnteSettings: 1 })
    .limit(20)
    .toArray();

  console.log('');
  console.log('=== Cleanup fonnteSettings (settings collection) ===');
  console.log('Mode                        :', COMMIT ? 'COMMIT (data ditulis)' : 'DRY-RUN (tidak menulis)');
  console.log('Total dokumen settings      :', total);
  console.log('Punya field fonnteSettings  :', affected);

  if (affected === 0) {
    console.log('');
    console.log('Tidak ada dokumen yang perlu di-cleanup. Selesai.');
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log('');
  console.log('Preview isi field yang akan di-unset (maks 20 doc, token di-mask):');
  for (const p of previews) {
    const fs = p.fonnteSettings || {};
    console.log(`  _id=${p._id}  cabang=${p.cabang || '(global)'}  storeName="${p.storeName || '-'}"`);
    console.log(`    enabled  : ${fs.enabled === true ? 'true' : 'false'}`);
    console.log(`    token    : ${maskToken(fs.token)}`);
    console.log(`    device   : ${fs.device || '(kosong)'}`);
    console.log(`    template : ${fs.template ? `"${String(fs.template).slice(0, 60)}..."` : '(default/kosong)'}`);
  }
  if (affected > previews.length) {
    console.log(`  ... dan ${affected - previews.length} dokumen lainnya`);
  }

  if (COMMIT) {
    const r = await col.updateMany(
      { fonnteSettings: { $exists: true } },
      { $unset: { fonnteSettings: '' } }
    );
    console.log('');
    console.log('Hasil updateMany:');
    console.log('  matchedCount  :', r.matchedCount);
    console.log('  modifiedCount :', r.modifiedCount);
  }

  console.log('');
  console.log(COMMIT
    ? 'Selesai. Field fonnteSettings sudah di-unset. Verifikasi via:'
    : 'Ini DRY-RUN. Jalankan ulang dengan flag --commit untuk menulis perubahan.');
  if (COMMIT) {
    console.log('  db.settings.countDocuments({ fonnteSettings: { $exists: true } })');
    console.log('Harus mengembalikan 0.');
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch(async (err) => {
  console.error('ERROR:', err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
