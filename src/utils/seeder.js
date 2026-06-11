require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Product = require('../models/Product');
const { Customer, Finance, Settings } = require('../models/index');

const seed = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('🔌 Connected to MongoDB');

  // Clear collections
  await Promise.all([
    User.deleteMany({}), Product.deleteMany({}),
    Customer.deleteMany({}), Finance.deleteMany({})
  ]);
  console.log('🗑️  Cleared existing data');

  // ============ USERS ============
  await User.create([
    { name: 'Admin Utama', username: 'admin', password: 'admin123', role: 'admin' },
    { name: 'Budi Santoso', username: 'budi', password: 'karyawan123', role: 'karyawan' },
    { name: 'Sari Dewi', username: 'sari', password: 'karyawan123', role: 'karyawan' }
  ]);
  console.log('✅ Users seeded');

  // ============ SETTINGS ============
  await Settings.create({
    storeName: 'Konter Pulsa Maju Jaya',
    storeAddress: 'Jl. Raya Bekasi No. 88, Bekasi Timur',
    storePhone: '08123456789',
    receiptFooter: 'Terima kasih sudah berbelanja di Konter Maju Jaya!\nFollow IG: @kontermajujaya'
  });
  console.log('✅ Settings seeded');

  // ============ PRODUCTS FISIK ============
  const fisikProducts = [
    // Kartu Perdana
    { code: 'KP-TSEL-5', name: 'Kartu Perdana Telkomsel 5GB', category: 'kartu_perdana', type: 'fisik', sellPrice: 25000, minStock: 10, provider: 'Telkomsel', stock: 50, purchasePrice: 18000 },
    { code: 'KP-XL-10', name: 'Kartu Perdana XL 10GB', category: 'kartu_perdana', type: 'fisik', sellPrice: 30000, minStock: 10, provider: 'XL', stock: 35, purchasePrice: 22000 },
    { code: 'KP-IM3-8', name: 'Kartu Perdana IM3 8GB', category: 'kartu_perdana', type: 'fisik', sellPrice: 25000, minStock: 10, provider: 'Indosat', stock: 40, purchasePrice: 18000 },
    { code: 'KP-TRI-5', name: 'Kartu Perdana Tri 5GB', category: 'kartu_perdana', type: 'fisik', sellPrice: 15000, minStock: 5, provider: 'Tri', stock: 20, purchasePrice: 10000 },
    { code: 'KP-SF-6', name: 'Kartu Perdana Smartfren 6GB', category: 'kartu_perdana', type: 'fisik', sellPrice: 20000, minStock: 5, provider: 'Smartfren', stock: 15, purchasePrice: 14000 },
    // Aksesoris
    { code: 'AKS-CHR-1A', name: 'Charger Fast Charging 1A', category: 'aksesoris', type: 'fisik', sellPrice: 35000, minStock: 5, stock: 20, purchasePrice: 20000 },
    { code: 'AKS-CHR-2A', name: 'Charger Fast Charging 2A', category: 'aksesoris', type: 'fisik', sellPrice: 45000, minStock: 5, stock: 15, purchasePrice: 28000 },
    { code: 'AKS-HDT-01', name: 'Headset Earphone Universal', category: 'aksesoris', type: 'fisik', sellPrice: 25000, minStock: 5, stock: 18, purchasePrice: 12000 },
    { code: 'AKS-USB-C', name: 'Kabel USB Type-C 1m', category: 'aksesoris', type: 'fisik', sellPrice: 20000, minStock: 10, stock: 30, purchasePrice: 10000 },
    { code: 'AKS-USB-L', name: 'Kabel Lightning iPhone 1m', category: 'aksesoris', type: 'fisik', sellPrice: 30000, minStock: 5, stock: 12, purchasePrice: 18000 },
    { code: 'AKS-SC-01', name: 'Screen Guard Anti Gores Universal', category: 'aksesoris', type: 'fisik', sellPrice: 15000, minStock: 10, stock: 3, purchasePrice: 7000 }, // stok menipis
    { code: 'AKS-PWB-10', name: 'Power Bank 10.000mAh', category: 'aksesoris', type: 'fisik', sellPrice: 150000, minStock: 3, stock: 8, purchasePrice: 100000 },
    { code: 'AKS-CAR-01', name: 'Car Charger 2 Port', category: 'aksesoris', type: 'fisik', sellPrice: 40000, minStock: 3, stock: 2, purchasePrice: 22000 }, // stok menipis
  ];

  for (const p of fisikProducts) {
    const { stock, purchasePrice, ...rest } = p;
    await Product.create({
      ...rest,
      stock,
      stockBatches: stock > 0 ? [{ quantity: stock, remainingQty: stock, purchasePrice }] : []
    });
  }
  console.log('✅ Produk Fisik seeded');

  // ============ PRODUCTS DIGITAL ============
  const digitalProducts = [
    // Pulsa
    { code: 'PLS-TSEL-5', name: 'Pulsa Telkomsel 5.000', category: 'pulsa', type: 'digital', sellPrice: 6500, purchasePrice: 5500, provider: 'Telkomsel', denomination: 5000 },
    { code: 'PLS-TSEL-10', name: 'Pulsa Telkomsel 10.000', category: 'pulsa', type: 'digital', sellPrice: 11500, purchasePrice: 10500, provider: 'Telkomsel', denomination: 10000 },
    { code: 'PLS-TSEL-20', name: 'Pulsa Telkomsel 20.000', category: 'pulsa', type: 'digital', sellPrice: 21500, purchasePrice: 20000, provider: 'Telkomsel', denomination: 20000 },
    { code: 'PLS-TSEL-50', name: 'Pulsa Telkomsel 50.000', category: 'pulsa', type: 'digital', sellPrice: 52000, purchasePrice: 50000, provider: 'Telkomsel', denomination: 50000 },
    { code: 'PLS-TSEL-100', name: 'Pulsa Telkomsel 100.000', category: 'pulsa', type: 'digital', sellPrice: 103000, purchasePrice: 100000, provider: 'Telkomsel', denomination: 100000 },
    { code: 'PLS-XL-10', name: 'Pulsa XL 10.000', category: 'pulsa', type: 'digital', sellPrice: 11000, purchasePrice: 10000, provider: 'XL', denomination: 10000 },
    { code: 'PLS-XL-25', name: 'Pulsa XL 25.000', category: 'pulsa', type: 'digital', sellPrice: 26000, purchasePrice: 24500, provider: 'XL', denomination: 25000 },
    { code: 'PLS-IM3-10', name: 'Pulsa IM3 10.000', category: 'pulsa', type: 'digital', sellPrice: 11000, purchasePrice: 10000, provider: 'Indosat', denomination: 10000 },
    { code: 'PLS-IM3-25', name: 'Pulsa IM3 25.000', category: 'pulsa', type: 'digital', sellPrice: 26000, purchasePrice: 24500, provider: 'Indosat', denomination: 25000 },
    // Paket Data
    { code: 'DATA-TSEL-1GB', name: 'Paket Data Telkomsel 1GB', category: 'paket_data', type: 'digital', sellPrice: 15000, purchasePrice: 13000, provider: 'Telkomsel' },
    { code: 'DATA-TSEL-5GB', name: 'Paket Data Telkomsel 5GB', category: 'paket_data', type: 'digital', sellPrice: 50000, purchasePrice: 45000, provider: 'Telkomsel' },
    { code: 'DATA-XL-2GB', name: 'Paket Data XL 2GB', category: 'paket_data', type: 'digital', sellPrice: 20000, purchasePrice: 17000, provider: 'XL' },
    { code: 'DATA-IM3-3GB', name: 'Paket Data IM3 3GB', category: 'paket_data', type: 'digital', sellPrice: 25000, purchasePrice: 22000, provider: 'Indosat' },
    // E-Wallet
    { code: 'EW-GPN-10', name: 'Top Up GoPay 10.000', category: 'ewallet', type: 'digital', sellPrice: 10500, purchasePrice: 10000 },
    { code: 'EW-GPN-50', name: 'Top Up GoPay 50.000', category: 'ewallet', type: 'digital', sellPrice: 51000, purchasePrice: 50000 },
    { code: 'EW-OVO-10', name: 'Top Up OVO 10.000', category: 'ewallet', type: 'digital', sellPrice: 10500, purchasePrice: 10000 },
    { code: 'EW-OVO-50', name: 'Top Up OVO 50.000', category: 'ewallet', type: 'digital', sellPrice: 51000, purchasePrice: 50000 },
    { code: 'EW-DANA-20', name: 'Top Up DANA 20.000', category: 'ewallet', type: 'digital', sellPrice: 20500, purchasePrice: 20000 },
    { code: 'EW-DANA-100', name: 'Top Up DANA 100.000', category: 'ewallet', type: 'digital', sellPrice: 101000, purchasePrice: 100000 },
    { code: 'EW-SPY-50', name: 'Top Up ShopeePay 50.000', category: 'ewallet', type: 'digital', sellPrice: 51000, purchasePrice: 50000 },
    // Token Listrik
    { code: 'TKN-PLN-20', name: 'Token Listrik PLN 20.000', category: 'token_listrik', type: 'digital', sellPrice: 21500, purchasePrice: 20000 },
    { code: 'TKN-PLN-50', name: 'Token Listrik PLN 50.000', category: 'token_listrik', type: 'digital', sellPrice: 52000, purchasePrice: 50000 },
    { code: 'TKN-PLN-100', name: 'Token Listrik PLN 100.000', category: 'token_listrik', type: 'digital', sellPrice: 102000, purchasePrice: 100000 },
    { code: 'TKN-PLN-200', name: 'Token Listrik PLN 200.000', category: 'token_listrik', type: 'digital', sellPrice: 202500, purchasePrice: 200000 },
    // Game
    { code: 'GM-ML-86', name: 'Mobile Legends 86 Diamond', category: 'game', type: 'digital', sellPrice: 20000, purchasePrice: 17500 },
    { code: 'GM-ML-172', name: 'Mobile Legends 172 Diamond', category: 'game', type: 'digital', sellPrice: 40000, purchasePrice: 35000 },
    { code: 'GM-ML-429', name: 'Mobile Legends 429 Diamond', category: 'game', type: 'digital', sellPrice: 100000, purchasePrice: 88000 },
    { code: 'GM-FF-70', name: 'Free Fire 70 Diamond', category: 'game', type: 'digital', sellPrice: 15000, purchasePrice: 13000 },
    { code: 'GM-FF-355', name: 'Free Fire 355 Diamond', category: 'game', type: 'digital', sellPrice: 65000, purchasePrice: 58000 },
    { code: 'GM-PUBG-60', name: 'PUBG Mobile 60 UC', category: 'game', type: 'digital', sellPrice: 15000, purchasePrice: 13000 },
    // Tarik Tunai
    { code: 'TT-001', name: 'Tarik Tunai (Fee)', category: 'lainnya', type: 'digital', sellPrice: 5000, purchasePrice: 0, description: 'Biaya layanan tarik tunai' },
  ];

  await Product.insertMany(digitalProducts);
  console.log('✅ Produk Digital seeded');

  // ============ CUSTOMERS ============
  await Customer.create([
    { name: 'Andi Wijaya', phone: '081234567890', address: 'Jl. Melati No. 5, Bekasi', totalTransactions: 12, totalSpent: 480000 },
    { name: 'Budi Prasetyo', phone: '082345678901', address: 'Jl. Mawar No. 10, Bekasi', totalTransactions: 8, totalSpent: 320000 },
    { name: 'Citra Lestari', phone: '083456789012', address: 'Jl. Kenanga No. 3, Bekasi', totalTransactions: 5, totalSpent: 150000 },
    { name: 'Dedi Kurniawan', phone: '084567890123', totalTransactions: 3, totalSpent: 95000 },
    { name: 'Eka Putri', phone: '085678901234', address: 'Jl. Dahlia No. 7, Bekasi', totalTransactions: 20, totalSpent: 750000 },
  ]);
  console.log('✅ Customers seeded');

  // ============ FINANCE ============
  const today = new Date();
  await Finance.create([
    { type: 'pengeluaran', category: 'Sewa Tempat', description: 'Sewa ruko bulan ini', amount: 2000000, date: new Date(today.getFullYear(), today.getMonth(), 1) },
    { type: 'pengeluaran', category: 'Gaji', description: 'Gaji karyawan Budi', amount: 1500000, date: new Date(today.getFullYear(), today.getMonth(), 1) },
    { type: 'pengeluaran', category: 'Listrik & Air', description: 'Tagihan listrik & air', amount: 300000, date: new Date(today.getFullYear(), today.getMonth(), 5) },
    { type: 'pemasukan', category: 'Modal Tambahan', description: 'Modal tambahan dari pemilik', amount: 5000000, date: new Date(today.getFullYear(), today.getMonth(), 1) },
    { type: 'hutang', category: 'Hutang Supplier', description: 'Hutang ke supplier aksesoris', amount: 1200000, relatedParty: 'CV Maju Bersama', dueDate: new Date(today.getFullYear(), today.getMonth() + 1, 1), isPaid: false },
    { type: 'piutang', category: 'Hutang Pelanggan', description: 'Piutang dari Andi Wijaya', amount: 150000, relatedParty: 'Andi Wijaya', isPaid: false },
  ]);
  console.log('✅ Finance seeded');

  console.log('\n🎉 Seeding selesai!');
  console.log('📋 Login credentials:');
  console.log('   Admin  → username: admin    | password: admin123');
  console.log('   Staff  → username: budi     | password: karyawan123');
  console.log('   Staff  → username: sari     | password: karyawan123');
  process.exit(0);
};

seed().catch(err => { console.error('❌ Seed error:', err); process.exit(1); });
