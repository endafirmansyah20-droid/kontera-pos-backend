const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: 'http://localhost:3000', methods: ['GET', 'POST'] }
});

// Middleware
app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
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
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ MongoDB Connected');
    server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  })
  .catch(err => console.error('MongoDB Error:', err));
