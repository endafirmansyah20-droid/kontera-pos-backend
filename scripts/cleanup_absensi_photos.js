/**
 * RETENSI FOTO ABSENSI (6 BULAN)
 * -------------------------------
 * Untuk semua record Absensi yang tanggal-nya > 6 bulan lalu:
 *   1) Hapus file foto check-in / check-out / lampiran dari disk
 *   2) Kosongkan field fotoUrl & lampiranUrl di dokumen
 *      (record absensi TETAP dipertahankan untuk laporan historis —
 *       hanya foto-nya yang dibuang)
 *
 * Cara pakai:
 *   1) BACKUP DATABASE dulu (mongodump / snapshot).
 *   2) Dry-run (default, tidak menghapus apa-apa):
 *        node scripts/cleanup_absensi_photos.js
 *   3) Eksekusi setelah dry-run OK:
 *        node scripts/cleanup_absensi_photos.js --commit
 *
 * Dijadwalkan manual via OS scheduler (Windows Task Scheduler /
 * cron di Linux) — misal 1x per minggu. Script ini BUKAN bagian
 * dari startup server.
 *
 * Retensi bisa di-override via ENV:
 *   ABSENSI_RETENTION_MONTHS=6 node scripts/cleanup_absensi_photos.js --commit
 */

const path     = require('path');
const fs       = require('fs');
const mongoose = require('mongoose');
require('dotenv').config();

const Absensi = require('../src/models/Absensi');

const COMMIT = process.argv.includes('--commit');
const RETENTION_MONTHS = parseInt(process.env.ABSENSI_RETENTION_MONTHS, 10) || 6;

const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');

function unlinkByUrl(url, stats) {
  if (!url || !url.startsWith('/uploads/')) return;
  const rel = url.replace(/^\/uploads\//, '');
  const abs = path.join(UPLOAD_ROOT, rel);
  try {
    fs.unlinkSync(abs);
    stats.filesDeleted += 1;
  } catch (err) {
    if (err.code === 'ENOENT') {
      stats.filesMissing += 1;
    } else {
      stats.fileErrors += 1;
      console.error(`  ! gagal hapus ${abs}: ${err.message}`);
    }
  }
}

(async () => {
  if (!process.env.MONGODB_URI) {
    console.error('ERROR: MONGODB_URI tidak ditemukan di .env');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  // Cutoff: awal hari X bulan lalu (tanggal semua < cutoff akan dibersihkan)
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);
  cutoff.setHours(0, 0, 0, 0);

  console.log('');
  console.log('=== Cleanup foto absensi ===');
  console.log('Mode          :', COMMIT ? 'COMMIT (menghapus)' : 'DRY-RUN');
  console.log('Retensi bulan :', RETENTION_MONTHS);
  console.log('Cutoff        :', cutoff.toISOString());

  const query = {
    tanggal: { $lt: cutoff },
    $or: [
      { 'checkIn.fotoUrl':  { $ne: '' } },
      { 'checkOut.fotoUrl': { $ne: '' } },
      { lampiranUrl:        { $ne: '' } },
    ],
  };

  const total = await Absensi.countDocuments(query);
  console.log('Record punya foto & sudah expired:', total);

  if (total === 0) {
    console.log('Tidak ada yang perlu dibersihkan. Selesai.');
    await mongoose.disconnect();
    process.exit(0);
  }

  const stats = { filesDeleted: 0, filesMissing: 0, fileErrors: 0, docsUpdated: 0 };

  // Stream untuk hemat memory kalau jumlah record banyak
  const cursor = Absensi.find(query)
    .select('_id checkIn.fotoUrl checkOut.fotoUrl lampiranUrl tanggal')
    .lean()
    .cursor();

  for await (const doc of cursor) {
    if (COMMIT) {
      unlinkByUrl(doc.checkIn?.fotoUrl,  stats);
      unlinkByUrl(doc.checkOut?.fotoUrl, stats);
      unlinkByUrl(doc.lampiranUrl,       stats);

      await Absensi.updateOne(
        { _id: doc._id },
        { $set: { 'checkIn.fotoUrl': '', 'checkOut.fotoUrl': '', lampiranUrl: '' } }
      );
      stats.docsUpdated += 1;
    } else {
      // Dry-run: hanya hitung yang bakal dihapus
      if (doc.checkIn?.fotoUrl)  stats.filesDeleted += 1;
      if (doc.checkOut?.fotoUrl) stats.filesDeleted += 1;
      if (doc.lampiranUrl)       stats.filesDeleted += 1;
      stats.docsUpdated += 1;
    }
  }

  console.log('');
  console.log('Hasil:');
  console.log('  files',   COMMIT ? 'dihapus  :' : 'akan dihapus:', stats.filesDeleted);
  if (COMMIT) {
    console.log('  files missing (skip) :', stats.filesMissing);
    console.log('  files gagal (error)  :', stats.fileErrors);
  }
  console.log('  dokumen ' + (COMMIT ? 'di-update:' : 'akan di-update:'), stats.docsUpdated);

  if (!COMMIT) {
    console.log('');
    console.log('Ini DRY-RUN. Jalankan ulang dengan flag --commit untuk eksekusi.');
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch(async (err) => {
  console.error('ERROR:', err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
