/**
 * DIAGNOSTIK PERFORMA — READ-ONLY
 * -------------------------------
 * Script ini TIDAK menulis apa-apa ke database. Aman dijalankan kapan saja.
 *
 * Menjalankan 3 query verifikasi untuk investigasi lambatnya input transaksi
 * di cabang GALAXY7158:
 *
 *   1) Ukuran mutasi array di semua Saldo GALAXY7158
 *      → mendeteksi doc Saldo dengan mutasi array yang membengkak
 *        (kandidat root cause utama slowness di createTransaction)
 *
 *   2) Perbandingan ukuran mutasi Kas Tunai (akunId ~ ^tunai) SEMUA cabang
 *      → apakah GALAXY7158 outlier dibanding cabang lain?
 *
 *   3) Jumlah dokumen transactions per cabang
 *      → gambaran umum umur/volume tiap cabang
 *
 * Cara pakai:
 *   node scripts/check_saldo_mutasi_size.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const KODE_TARGET = 'GALAXY7158';

function sep(title) {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(title);
  console.log('═══════════════════════════════════════════════════════════════');
}

function fmtBytes(n) {
  if (n == null) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function fmtRow(cols, widths) {
  return cols.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ');
}

(async () => {
  if (!process.env.MONGODB_URI) {
    console.error('ERROR: MONGODB_URI tidak ditemukan di .env');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  // ── Cari cabang target ────────────────────────────────────────
  const cabang = await db.collection('cabangs').findOne(
    { kode: KODE_TARGET },
    { projection: { _id: 1, nama: 1, kode: 1 } }
  );

  if (!cabang) {
    console.error(`ERROR: Cabang dengan kode "${KODE_TARGET}" tidak ditemukan`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`Target cabang: ${cabang.kode} (${cabang.nama || '-'}) — _id=${cabang._id}`);

  // ── 1) Ukuran mutasi array untuk SEMUA Saldo GALAXY7158 ───────
  sep(`1) Ukuran mutasi array di semua Saldo cabang ${KODE_TARGET}`);
  const saldosTarget = await db.collection('saldos').aggregate([
    { $match: { cabang: cabang._id } },
    {
      $project: {
        akunId: 1,
        namaAkun: 1,
        group: 1,
        saldo: 1,
        mutasiCount: { $size: { $ifNull: ['$mutasi', []] } },
        docSize: { $bsonSize: '$$ROOT' }
      }
    },
    { $sort: { mutasiCount: -1 } }
  ]).toArray();

  if (saldosTarget.length === 0) {
    console.log('(tidak ada Saldo untuk cabang ini)');
  } else {
    const widths = [22, 22, 12, 14, 14];
    console.log(fmtRow(['akunId', 'namaAkun', 'group', 'mutasiCount', 'docSize'], widths));
    console.log('─'.repeat(widths.reduce((a, b) => a + b + 2, 0)));
    for (const s of saldosTarget) {
      console.log(fmtRow([
        s.akunId,
        s.namaAkun,
        s.group,
        s.mutasiCount.toLocaleString('en-US'),
        fmtBytes(s.docSize)
      ], widths));
    }
  }

  // ── 2) Perbandingan Kas Tunai antar cabang ────────────────────
  sep('2) Perbandingan ukuran mutasi Kas Tunai (akunId ~ ^tunai) SEMUA cabang');
  const kasSemua = await db.collection('saldos').aggregate([
    { $match: { akunId: /^tunai/ } },
    {
      $lookup: {
        from: 'cabangs',
        localField: 'cabang',
        foreignField: '_id',
        as: 'cab'
      }
    },
    {
      $project: {
        kodeCabang: { $ifNull: [{ $arrayElemAt: ['$cab.kode', 0] }, '(tanpa cabang)'] },
        namaCabang: { $ifNull: [{ $arrayElemAt: ['$cab.nama', 0] }, '-'] },
        akunId: 1,
        mutasiCount: { $size: { $ifNull: ['$mutasi', []] } },
        docSize: { $bsonSize: '$$ROOT' }
      }
    },
    { $sort: { mutasiCount: -1 } }
  ]).toArray();

  if (kasSemua.length === 0) {
    console.log('(tidak ada Kas Tunai)');
  } else {
    const widths = [18, 22, 22, 14, 14];
    console.log(fmtRow(['kodeCabang', 'namaCabang', 'akunId', 'mutasiCount', 'docSize'], widths));
    console.log('─'.repeat(widths.reduce((a, b) => a + b + 2, 0)));
    for (const k of kasSemua) {
      const marker = k.kodeCabang === KODE_TARGET ? ' ← target' : '';
      console.log(fmtRow([
        k.kodeCabang,
        k.namaCabang,
        k.akunId,
        k.mutasiCount.toLocaleString('en-US'),
        fmtBytes(k.docSize)
      ], widths) + marker);
    }
  }

  // ── 3) Count transactions per cabang ──────────────────────────
  sep('3) Jumlah dokumen transactions per cabang');
  const txPerCabang = await db.collection('transactions').aggregate([
    { $group: { _id: '$cabang', count: { $sum: 1 } } },
    {
      $lookup: {
        from: 'cabangs',
        localField: '_id',
        foreignField: '_id',
        as: 'cab'
      }
    },
    {
      $project: {
        _id: 0,
        kodeCabang: { $ifNull: [{ $arrayElemAt: ['$cab.kode', 0] }, '(tanpa cabang)'] },
        namaCabang: { $ifNull: [{ $arrayElemAt: ['$cab.nama', 0] }, '-'] },
        count: 1
      }
    },
    { $sort: { count: -1 } }
  ]).toArray();

  if (txPerCabang.length === 0) {
    console.log('(tidak ada transaksi)');
  } else {
    const widths = [18, 30, 12];
    console.log(fmtRow(['kodeCabang', 'namaCabang', 'count'], widths));
    console.log('─'.repeat(widths.reduce((a, b) => a + b + 2, 0)));
    for (const t of txPerCabang) {
      const marker = t.kodeCabang === KODE_TARGET ? ' ← target' : '';
      console.log(fmtRow([
        t.kodeCabang,
        t.namaCabang,
        t.count.toLocaleString('en-US')
      ], widths) + marker);
    }
  }

  console.log('');
  console.log('Selesai. Script ini read-only — tidak ada perubahan data.');

  await mongoose.disconnect();
  process.exit(0);
})().catch(async (err) => {
  console.error('ERROR:', err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
