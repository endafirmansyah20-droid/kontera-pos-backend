const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// CORS whitelist: domain publik PWA, dev web, Capacitor Android/iOS webview,
// dan device lain di LAN (192.168.x.x / 10.x.x.x / 172.16–31.x.x) untuk akses via WiFi
const staticAllowedOrigins = [
  'https://galaxystore.id',
  'https://www.galaxystore.id',
  'https://kontera.id',
  'https://www.kontera.id',
  'http://localhost:3000',
  'http://localhost',
  'https://localhost',
  'capacitor://localhost',
  'ionic://localhost',
];
const lanOriginRegex = /^https?:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/;

const isAllowedOrigin = (origin) => {
  // Native app / curl / Postman kirim origin kosong — allow
  if (!origin) return true;
  if (staticAllowedOrigins.includes(origin)) return true;
  if (lanOriginRegex.test(origin)) return true;
  return false;
};

const corsOptions = {
  origin: (origin, callback) => {
    // Graceful reject: jangan throw supaya tidak jadi 500 di error handler global.
    // Origin tak dikenal → browser dapat CORS error normal (ACAO tidak di-set).
    if (isAllowedOrigin(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
};

const io = new Server(server, {
  cors: { origin: corsOptions.origin, methods: ['GET', 'POST'], credentials: true }
});

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(morgan('dev'));
app.use('/uploads', express.static('uploads'));

// Socket.IO
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});
app.set('io', io);

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/products', require('./routes/products'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/finance', require('./routes/finance'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/saldo', require('./routes/saldo'));
app.use('/api/closing-kas', require('./routes/closingKas'));
app.use('/api/pembelian', require('./routes/pembelian'));
app.use('/api/service',  require('./routes/service'));
app.use('/api/points',   require('./routes/points'));
app.use('/api/cabang',   require('./routes/cabang'));
app.use('/api/owner',    require('./routes/owner'));
app.use('/api/backup',   require('./routes/backup'));
app.use('/api/rewards',  require('./routes/rewards'));
app.use('/api/member',   require('./routes/member'));
app.use('/api/investor', require('./routes/investor'));

// Error handling
app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ success: false, message: err.message || 'Server Error' });
});

// Connect DB & Start
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0'; // bind ke semua interface supaya bisa diakses dari LAN
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB Connected');
    server.listen(PORT, HOST, () => console.log(`🚀 Server running on ${HOST}:${PORT}`));
  })
  .catch(err => console.error('MongoDB Error:', err));
