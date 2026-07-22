// Migrasi Settings dari global (1 doc lama tanpa cabang) → per-cabang.
//
// Usage:
//   node scripts/migrate_settings_to_per_cabang.js --dry   # preview only
//   node scripts/migrate_settings_to_per_cabang.js         # live (writes)
//
// Perilaku:
//   1. Ambil semua Cabang.
//   2. Ambil 1 doc Settings lama (cabang: {$exists:false}) sebagai template.
//   3. Untuk tiap cabang yang belum punya Settings sendiri, buat doc baru:
//      clone semua field dari template lama (kalau ada), else pakai default schema.
//   4. TIDAK menghapus doc lama — biarkan sebagai safety net.
//   5. Idempotent: run ulang aman, cabang yang sudah punya doc tidak diduplikasi.
require('dotenv').config();
const mongoose = require('mongoose');
const { Settings } = require('../src/models/index');
const Cabang = require('../src/models/Cabang');

const isDry = process.argv.includes('--dry');

const FIELDS_PREVIEW = ['storeName', 'targetOmset', 'lowStockThreshold', 'receiptFooter'];

function stripMeta(obj) {
  const clone = { ...obj };
  delete clone._id;
  delete clone.__v;
  delete clone.cabang;
  delete clone.createdAt;
  delete clone.updatedAt;
  return clone;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Mode: ${isDry ? 'DRY-RUN (no writes)' : 'LIVE'}`);
  console.log('MongoDB connected.\n');

  const cabangs = await Cabang.find({}).sort('nama').lean();
  console.log(`Total cabang         : ${cabangs.length}`);

  const oldGlobal = await Settings.findOne({ cabang: { $exists: false } }).lean();
  console.log(`Old global Settings  : ${oldGlobal ? 'FOUND (_id=' + oldGlobal._id + ')' : 'NOT FOUND — will use schema defaults'}`);

  const allSettings = await Settings.find({}, { cabang: 1 }).lean();
  const existingIds = new Set(allSettings.filter(s => s.cabang).map(s => String(s.cabang)));
  console.log(`Cabang with Settings : ${existingIds.size}`);
  console.log(`Total Settings docs  : ${allSettings.length}`);

  const toMigrate = cabangs.filter(c => !existingIds.has(String(c._id)));
  console.log(`\nCabang TO MIGRATE    : ${toMigrate.length}`);
  if (toMigrate.length === 0) {
    console.log('\nNothing to do — every cabang already has its own Settings.');
    await mongoose.disconnect();
    return;
  }

  const template = oldGlobal ? stripMeta(oldGlobal) : {};
  console.log('\nTemplate source      :', oldGlobal ? 'old global doc' : 'schema defaults');
  if (oldGlobal) {
    console.log('Template preview     :');
    for (const f of FIELDS_PREVIEW) {
      console.log(`   ${f.padEnd(20)}=`, JSON.stringify(oldGlobal[f]));
    }
    if (oldGlobal.pointSettings) {
      console.log(`   pointSettings       =`, JSON.stringify(oldGlobal.pointSettings));
    }
  }

  console.log('\n=== Per-cabang plan ===');
  for (const c of toMigrate) {
    const newDoc = { ...template, cabang: c._id };
    console.log(`  → ${c.nama.padEnd(30)} kode=${c.kode.padEnd(12)} _id=${c._id}`);
    if (!isDry) {
      const created = await Settings.create(newDoc);
      console.log(`     ✓ Settings created _id=${created._id}`);
    }
  }

  console.log(`\n${isDry ? '[dry-run] No writes performed.' : 'Live run complete.'}`);
  console.log(`Cabang migrated: ${toMigrate.length}`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
