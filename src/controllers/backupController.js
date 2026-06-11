const mongoose = require('mongoose');
const archiver = require('archiver');
const path = require('path');
const fs = require('fs');

const COLLECTIONS = [
  'transactions', 'products', 'saldos', 'customers', 'finances',
  'users', 'cabangs', 'settings', 'closingkas', 'pembelians',
  'servicetransactions', 'servicefinances', 'pointlogs', 'stocklogs'
];

exports.backupDatabase = async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;

    // Set header untuk download ZIP
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="backup-konterpos-${dateStr}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    // Export setiap collection ke JSON
    for (const col of COLLECTIONS) {
      try {
        const data = await db.collection(col).find({}).toArray();
        const json = JSON.stringify(data, null, 2);
        archive.append(json, { name: `${col}.json` });
      } catch (e) {
        // Skip collection yang tidak ada
      }
    }

    // Tambah metadata
    const meta = {
      backupDate: now.toISOString(),
      database: 'konter_pulsa',
      collections: COLLECTIONS,
      backedUpBy: req.user?.name || 'SuperAdmin',
      version: '1.0'
    };
    archive.append(JSON.stringify(meta, null, 2), { name: 'backup-info.json' });

    await archive.finalize();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
};

exports.getBackupInfo = async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const counts = {};
    for (const col of COLLECTIONS) {
      try {
        counts[col] = await db.collection(col).countDocuments();
      } catch { counts[col] = 0; }
    }
    const total = Object.values(counts).reduce((t, c) => t + c, 0);
    res.json({ success: true, data: { collections: counts, totalDocuments: total, collections_count: COLLECTIONS.length } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
