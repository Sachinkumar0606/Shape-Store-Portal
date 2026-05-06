// ============================================================
// Shape Trade Portal - Server (v2.1.0)
// Developed by Satyam Yadav
// Storage: MongoDB Atlas (with JSON file fallback)
// ============================================================

const express   = require('express');
const http      = require('http');
const socketIo  = require('socket.io');
const path      = require('path');
const fs        = require('fs');
const mongoose  = require('mongoose');

const app    = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 1e8,    // 100MB - allows big base64 images
  pingTimeout: 60000,
  pingInterval: 25000
});

const PORT          = process.env.PORT || 3000;
const MONGODB_URI   = process.env.MONGODB_URI || '';
const USE_MONGO     = MONGODB_URI.length > 0;

// ============================================================
// JSON FILE FALLBACK (used only if no MONGODB_URI is set)
// ============================================================
const DATA_DIR       = path.join(__dirname, 'data');
const PRODUCTS_FILE  = path.join(DATA_DIR, 'products.json');
const ORDERS_FILE    = path.join(DATA_DIR, 'orders.json');
const BUYERS_FILE    = path.join(DATA_DIR, 'buyers.json');
const SETTINGS_FILE  = path.join(DATA_DIR, 'settings.json');

if (!fs.existsSync(DATA_DIR)) { try { fs.mkdirSync(DATA_DIR); } catch(e) {} }

function loadFile(file, fallback) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.log('Load err', file, e.message); }
  return fallback;
}
function saveFile(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
  catch (e) { console.log('Save err', file, e.message); }
}

// ============================================================
// In-memory cache (kept in sync with DB / files)
// ============================================================
let products = [];
let orders   = [];
let buyers   = [];
let settings = {
  whatsapp:   '917710729782',
  email:      'Satyamyadav19125@gmail.com',
  phone:      '+91 77107 29782',
  categories: ['Pens','Pencils','Notebooks','Markers','Erasers','Geometry','Files & Folders','Art Supplies','Other']
};

// ============================================================
// MONGOOSE MODELS
// ============================================================
let Product, Order, Buyer, SettingsModel;

if (USE_MONGO) {
  // strict:false -> we can store any extra fields without re-defining the schema
  Product = mongoose.model('Product', new mongoose.Schema({
    id: { type: String, index: true, unique: true }
  }, { strict: false, collection: 'products', timestamps: false }));

  Order = mongoose.model('Order', new mongoose.Schema({
    id: { type: String, index: true, unique: true }
  }, { strict: false, collection: 'orders', timestamps: false }));

  Buyer = mongoose.model('Buyer', new mongoose.Schema({
    id: { type: String, index: true, unique: true }
  }, { strict: false, collection: 'buyers', timestamps: false }));

  SettingsModel = mongoose.model('Settings', new mongoose.Schema({
    _id: { type: String, default: 'main' }
  }, { strict: false, collection: 'settings', timestamps: false }));
}

// ============================================================
// LOAD ALL DATA AT STARTUP
// ============================================================
async function loadAll() {
  if (USE_MONGO) {
    try {
      const [pp, oo, bb, ss] = await Promise.all([
        Product.find().lean(),
        Order.find().lean(),
        Buyer.find().lean(),
        SettingsModel.findOne({ _id: 'main' }).lean()
      ]);

      products = pp.map(stripMongo);
      orders   = oo.map(stripMongo);
      buyers   = bb.map(stripMongo);

      if (ss) {
        settings = {
          whatsapp:   ss.whatsapp   || settings.whatsapp,
          email:      ss.email      || settings.email,
          phone:      ss.phone      || settings.phone,
          categories: ss.categories || settings.categories
        };
      } else {
        await SettingsModel.create({ _id: 'main', ...settings });
      }

      // Seed a demo buyer if none exists yet
      if (buyers.length === 0) {
        const demo = { id: 'buyer1', pass: '1234', name: 'Demo Buyer', shop: 'Demo Shop' };
        await Buyer.create(demo);
        buyers.push(demo);
      }

      console.log(`✓ Loaded from MongoDB: ${products.length} products, ${orders.length} orders, ${buyers.length} buyers`);
    } catch (err) {
      console.error('✗ Mongo load error:', err.message);
    }
  } else {
    products = loadFile(PRODUCTS_FILE, []);
    orders   = loadFile(ORDERS_FILE,   []);
    buyers   = loadFile(BUYERS_FILE,   [{ id: 'buyer1', pass: '1234', name: 'Demo Buyer', shop: 'Demo Shop' }]);
    settings = Object.assign(settings, loadFile(SETTINGS_FILE, {}));
    saveFile(BUYERS_FILE, buyers);
    saveFile(SETTINGS_FILE, settings);
    console.log(`⚠ Loaded from JSON files (NOT PERSISTENT on Render): ${products.length}p, ${orders.length}o, ${buyers.length}b`);
  }
}

function stripMongo(doc) {
  if (!doc) return doc;
  delete doc._id;
  delete doc.__v;
  return doc;
}

// ============================================================
// PERSISTENCE HELPERS
// ============================================================
async function saveProducts() {
  if (USE_MONGO) return; // we write per-product in handlers
  saveFile(PRODUCTS_FILE, products);
}
async function saveOrders() {
  if (USE_MONGO) return;
  saveFile(ORDERS_FILE, orders);
}
async function saveBuyers() {
  if (USE_MONGO) return;
  saveFile(BUYERS_FILE, buyers);
}
async function saveSettings() {
  if (USE_MONGO) {
    try {
      await SettingsModel.updateOne({ _id: 'main' }, { $set: settings }, { upsert: true });
    } catch (e) { console.error('Save settings err:', e.message); }
    return;
  }
  saveFile(SETTINGS_FILE, settings);
}

// ============================================================
// CONNECT TO MONGODB
// ============================================================
async function connectDB() {
  if (!USE_MONGO) {
    console.warn('');
    console.warn('================================================================');
    console.warn('⚠️  WARNING: MONGODB_URI environment variable is not set!');
    console.warn('   Data will be saved to JSON files only.');
    console.warn('   On Render free tier, this data will be LOST on every restart.');
    console.warn('   See DEPLOYMENT_GUIDE.md to set up free MongoDB Atlas.');
    console.warn('================================================================');
    console.warn('');
    return;
  }

  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000
    });
    console.log('✓ MongoDB Atlas connected');
  } catch (err) {
    console.error('✗ MongoDB connection failed:', err.message);
    console.error('  Check your MONGODB_URI environment variable.');
  }
}

// ============================================================
// EXPRESS / STATIC FILES
// ============================================================
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    storage: USE_MONGO ? 'mongodb' : 'json-files',
    mongoConnected: USE_MONGO && mongoose.connection.readyState === 1,
    products: products.length,
    orders: orders.length,
    buyers: buyers.length
  });
});

// ============================================================
// SOCKET.IO
// ============================================================
io.on('connection', (socket) => {
  console.log('+ ' + socket.id);
  socket.emit('init', { products, orders, buyers, settings });

  socket.on('get-data', () => {
    socket.emit('init', { products, orders, buyers, settings });
  });

  // ----- ADD PRODUCT -----
  socket.on('admin-add-product', async (product, ack) => {
    if (!product || !product.id) { ack && ack({ success: false, error: 'Invalid product' }); return; }
    if (products.find(p => p.code && product.code && p.code.toLowerCase() === product.code.toLowerCase())) {
      ack && ack({ success: false, error: 'Product code already exists' });
      return;
    }

    try {
      if (USE_MONGO) await Product.create(product);
      products.unshift(product);

      // Auto-add new category if user typed one
      if (product.cat && settings.categories.indexOf(product.cat) === -1) {
        settings.categories.push(product.cat);
        await saveSettings();
        io.emit('settings-update', settings);
      }

      await saveProducts();
      io.emit('products-update', products);
      ack && ack({ success: true });
    } catch (e) {
      console.error('Add product err:', e.message);
      ack && ack({ success: false, error: 'Database error: ' + e.message });
    }
  });

  // ----- UPDATE PRODUCT -----
  socket.on('admin-update-product', async (product, ack) => {
    if (!product || !product.id) { ack && ack({ success: false }); return; }
    const idx = products.findIndex(p => p.id === product.id);
    if (idx < 0) { ack && ack({ success: false }); return; }

    try {
      if (USE_MONGO) await Product.updateOne({ id: product.id }, { $set: product });
      products[idx] = product;
      await saveProducts();
      io.emit('products-update', products);
      ack && ack({ success: true });
    } catch (e) {
      console.error('Update product err:', e.message);
      ack && ack({ success: false, error: e.message });
    }
  });

  // ----- DELETE PRODUCT -----
  socket.on('admin-delete-product', async (productId) => {
    try {
      if (USE_MONGO) await Product.deleteOne({ id: productId });
      products = products.filter(p => p.id !== productId);
      await saveProducts();
      io.emit('products-update', products);
    } catch (e) { console.error('Delete product err:', e.message); }
  });

  // ----- MARK ORDER SENT -----
  socket.on('admin-mark-sent', async (orderId) => {
    const o = orders.find(x => x.id === orderId);
    if (!o) return;
    o.status = 'sent';
    o.sentAt = new Date().toISOString();
    try {
      if (USE_MONGO) await Order.updateOne({ id: orderId }, { $set: { status: 'sent', sentAt: o.sentAt } });
      await saveOrders();
      io.emit('orders-update', orders);
    } catch (e) { console.error('Mark sent err:', e.message); }
  });

  // ----- DELETE ORDER -----
  socket.on('admin-delete-order', async (orderId) => {
    try {
      if (USE_MONGO) await Order.deleteOne({ id: orderId });
      orders = orders.filter(o => o.id !== orderId);
      await saveOrders();
      io.emit('orders-update', orders);
    } catch (e) { console.error('Delete order err:', e.message); }
  });

  // ----- CLEAR ORDERS -----
  socket.on('admin-clear-orders', async () => {
    try {
      if (USE_MONGO) await Order.deleteMany({});
      orders = [];
      await saveOrders();
      io.emit('orders-update', orders);
    } catch (e) { console.error('Clear orders err:', e.message); }
  });

  // ----- ADD BUYER -----
  socket.on('admin-add-buyer', async (buyer, ack) => {
    if (!buyer || !buyer.id || !buyer.pass) { ack && ack({ success: false, error: 'Need ID and password' }); return; }
    if (buyers.find(b => b.id.toLowerCase() === buyer.id.toLowerCase())) {
      ack && ack({ success: false, error: 'Username already exists' }); return;
    }
    try {
      if (USE_MONGO) await Buyer.create(buyer);
      buyers.push(buyer);
      await saveBuyers();
      io.emit('buyers-update', buyers);
      ack && ack({ success: true });
    } catch (e) {
      console.error('Add buyer err:', e.message);
      ack && ack({ success: false, error: e.message });
    }
  });

  // ----- DELETE BUYER -----
  socket.on('admin-delete-buyer', async (buyerId) => {
    try {
      if (USE_MONGO) await Buyer.deleteOne({ id: buyerId });
      buyers = buyers.filter(b => b.id !== buyerId);
      await saveBuyers();
      io.emit('buyers-update', buyers);
    } catch (e) { console.error('Delete buyer err:', e.message); }
  });

  // ----- UPDATE SETTINGS -----
  socket.on('admin-update-settings', async (newSettings, ack) => {
    if (!newSettings || typeof newSettings !== 'object') { ack && ack({ success: false }); return; }
    if (newSettings.whatsapp !== undefined) settings.whatsapp = String(newSettings.whatsapp).replace(/[^0-9]/g, '');
    if (newSettings.email    !== undefined) settings.email    = String(newSettings.email);
    if (newSettings.phone    !== undefined) settings.phone    = String(newSettings.phone);
    try {
      await saveSettings();
      io.emit('settings-update', settings);
      ack && ack({ success: true });
    } catch (e) {
      console.error('Save settings err:', e.message);
      ack && ack({ success: false });
    }
  });

  // ----- ADD CATEGORY -----
  socket.on('admin-add-category', async (catName, ack) => {
    if (!catName || typeof catName !== 'string') { ack && ack({ success: false }); return; }
    catName = catName.trim();
    if (!catName) { ack && ack({ success: false }); return; }
    if (settings.categories.indexOf(catName) === -1) {
      settings.categories.push(catName);
      await saveSettings();
      io.emit('settings-update', settings);
    }
    ack && ack({ success: true });
  });

  // ----- PLACE ORDER -----
  socket.on('place-order', async (order, ack) => {
    if (!order || !order.items || !order.buyerId) { ack && ack({ success: false, error: 'Invalid order' }); return; }
    order.id        = 'O' + Date.now();
    order.status    = 'new';
    order.createdAt = new Date().toISOString();

    try {
      if (USE_MONGO) await Order.create(order);
      orders.unshift(order);
      await saveOrders();
      io.emit('orders-update', orders);
      ack && ack({ success: true, orderId: order.id });
    } catch (e) {
      console.error('Place order err:', e.message);
      ack && ack({ success: false, error: e.message });
    }
  });

  socket.on('disconnect', () => { console.log('- ' + socket.id); });
});

// ============================================================
// START
// ============================================================
(async () => {
  await connectDB();
  await loadAll();
  server.listen(PORT, () => {
    console.log(`Shape Trade Portal v2.1.0 LIVE on port ${PORT}`);
    console.log(`Storage: ${USE_MONGO ? 'MongoDB Atlas' : 'JSON files (NOT PERSISTENT)'}`);
  });
})();
