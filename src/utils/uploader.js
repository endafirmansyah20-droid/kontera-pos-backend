const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const multer  = require('multer');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads');

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png':  '.png',
  'image/webp': '.webp',
};

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Factory: bikin multer instance untuk subfolder tertentu (mis. 'absensi').
// Semua file disimpan di uploads/<subdir>/ dengan nama unik.
function imageUploader(subdir, { maxSizeBytes = 2 * 1024 * 1024 } = {}) {
  const dir = path.join(UPLOAD_ROOT, subdir);
  ensureDir(dir);

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const ext  = EXT_BY_MIME[file.mimetype] || path.extname(file.originalname) || '.bin';
      const uid  = req.user?._id ? String(req.user._id) : 'anon';
      const rand = crypto.randomBytes(4).toString('hex');
      cb(null, `${Date.now()}-${uid}-${rand}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: maxSizeBytes, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (!IMAGE_MIMES.has(file.mimetype)) {
        return cb(new Error('Format foto tidak didukung (harus JPG/PNG/WebP)'));
      }
      cb(null, true);
    },
  });
}

// URL publik yang di-serve oleh app.use('/uploads', express.static('uploads')) di server.js
function publicUrl(subdir, filename) {
  if (!filename) return '';
  return `/uploads/${subdir}/${filename}`;
}

// Hapus file dari disk berdasarkan publicUrl (mengabaikan bila file sudah tidak ada).
function removeByPublicUrl(url) {
  if (!url || !url.startsWith('/uploads/')) return false;
  const rel = url.replace(/^\/uploads\//, '');
  const abs = path.join(UPLOAD_ROOT, rel);
  try {
    fs.unlinkSync(abs);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

module.exports = { imageUploader, publicUrl, removeByPublicUrl, UPLOAD_ROOT };
