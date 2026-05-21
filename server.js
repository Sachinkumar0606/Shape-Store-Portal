// ============================================================
// Shape Trade Portal - Server (v2.2.0 - Fixed + Sleep Mode)
// Developed by Satyam Yadav
// Storage: MongoDB Atlas (with JSON file fallback)
// ============================================================

const express   = require('express');
const mongoose  = require('mongoose');
const fs        = require('fs');
const path      = require('path');
const http      = require('http');
const socketIo  = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

// ============================================================
// CONFIGURATION & SETUP
// ============================================================

app.use(express.json({ limit: '50mb' }));

// ============================================================
// SLEEP MODE - 12:00 AM to 5:00 AM IST (Punjab Time)
// Saves Render free tier hours
// ============================================================

const SLEEP_START = 0;  // 12:00 AM IST
const SLEEP_END   = 5;  // 5:00 AM IST

function getISTHour() {
  const now = new Date();
  // IST = UTC + 5:30
  const istMs = now.getTime() + (5.5 * 60 * 60 * 1000);
  const ist = new Date(istMs);
  return ist.getUTCHours();
}

function isSleepTime() {
  const hour = getISTHour();
  return hour >= SLEEP_START && hour < SLEEP_END;
}

// Sleep middleware - returns a sleep page during off hours
app.use((req, res, next) => {
  if (isSleepTime() && req.path !== '/health') {
    // Allow socket.io connections through
    if (req.path.startsWith('/socket.io')) return next();
    
    return res.send(`
      <!DOCTYPE html>
      <html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Shape Trade - Sleeping</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{background:#0a0e27;color:#fff;font-family:'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:20px}
        .box{max-width:400px}
        .moon{font-size:80px;margin-bottom:20px}
        h1{font-size:24px;margin-bottom:10px;color:#ff6b35}
        p{color:rgba(255,255,255,0.6);font-size:14px;line-height:1.6;margin-bottom:8px}
        .time{background:rgba(255,255,255,0.1);padding:10px 20px;border-radius:10px;display:inline-block;margin-top:15px;font-size:13px;color:rgba(255,255,255,0.5)}
      </style>
      <script>setTimeout(()=>location.reload(),60000)</script>
      </head><body><div class="box">
        <div class="moon">🌙</div>
        <h1>Shape Trade is Sleeping</h1>
        <p>The portal is resting from <b>12:00 AM</b> to <b>5:00 AM</b> IST to save resources.</p>
        <p>It will wake up automatically at 5:00 AM.</p>
        <div class="time">⏰ This page auto-refreshes every minute</div>
      </div></body></html>
    `);
  }
  next();
});

app.use(express.static('public'));

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/shape-trade';
const PORT = process.env.PORT || 3000;

let isConnected = false;
let useFallback = false;

// ============================================================
// MONGODB CONNECTION & SCHEMAS
// ============================================================

const productSchema = new mongoose.Schema({
  id: String,
  name: String,
  code: String,
  cat: String,
  mrp: String,
  dp: String,
  desc: String,
  insta: String,
  imgs: [String],
  img: String,
  createdAt: { type: Date, default: Date.now }
});

const orderSchema = new mongoose.Schema({
  id: String,
  buyerId: String,
  buyerName: String,
  shop: String,
  notes: String,
  items: Array,
  status: { type: String, default: 'new' },
  createdAt: { type: Date, default: Date.now }
});

const buyerSchema = new mongoose.Schema({
  id: String,
  pass: String,
  name: String,
  shop: String,
  createdAt: { type: Date, default: Date.now }
});

const categorySchema = new mongoose.Schema({
  name: String,
  createdAt: { type: Date, default: Date.now }
});

const settingsSchema = new mongoose.Schema({
  whatsapp: String,
  email: String,
  phone: String,
  categories: [String],
  updatedAt: { type: Date, default: Date.now }
});

const Product = mongoose.model('Product', productSchema);
const Order = mongoose.model('Order', orderSchema);
const Buyer = mongoose.model('Buyer', buyerSchema);
const Category = mongoose.model('Category', categorySchema);
const Settings = mongoose.model('Settings', settingsSchema);

// ============================================================
// MONGODB CONNECTION WITH RETRY
// ============================================================

async function connectToMongoDB() {
  try {
    await mongoose.connect(MONGODB_URI);
    isConnected = true;
    useFallback = false;
    console.log('✅ Connected to MongoDB Atlas');
  } catch (error) {
    console.log('⚠️  MongoDB connection failed, using JSON fallback');
    console.log('Error:', error.message);
    isConnected = false;
    useFallback = true;
  }
}

connectToMongoDB();

// ============================================================
// JSON FALLBACK FILES
// ============================================================

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const productsFile = path.join(dataDir, 'products.json');
const ordersFile = path.join(dataDir, 'orders.json');
const buyersFile = path.join(dataDir, 'buyers.json');
const categoriesFile = path.join(dataDir, 'categories.json');
const settingsFile = path.join(dataDir, 'settings.json');

function loadJSON(file) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading JSON file:', file, e);
  }
  return [];
}

function saveJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Error saving JSON file:', file, e);
  }
}

// ============================================================
// STORAGE STATS CALCULATION
// ============================================================

async function calculateStorageStats() {
  try {
    let stats = {
      productsSize: 0, ordersSize: 0, buyersSize: 0,
      totalSize: 0, productCount: 0, orderCount: 0, buyerCount: 0
    };

    if (isConnected && !useFallback) {
      const products = await Product.find().lean();
      const orders = await Order.find().lean();
      const buyers = await Buyer.find().lean();
      stats.productsSize = JSON.stringify(products).length / (1024 * 1024);
      stats.ordersSize = JSON.stringify(orders).length / (1024 * 1024);
      stats.buyersSize = JSON.stringify(buyers).length / (1024 * 1024);
      stats.productCount = products.length;
      stats.orderCount = orders.length;
      stats.buyerCount = buyers.length;
    } else {
      const products = loadJSON(productsFile);
      const orders = loadJSON(ordersFile);
      const buyers = loadJSON(buyersFile);
      stats.productsSize = JSON.stringify(products).length / (1024 * 1024);
      stats.ordersSize = JSON.stringify(orders).length / (1024 * 1024);
      stats.buyersSize = JSON.stringify(buyers).length / (1024 * 1024);
      stats.productCount = products.length;
      stats.orderCount = orders.length;
      stats.buyerCount = buyers.length;
    }

    stats.totalSize = stats.productsSize + stats.ordersSize + stats.buyersSize;
    return stats;
  } catch (error) {
    console.error('Error calculating storage stats:', error);
    return { productsSize:0, ordersSize:0, buyersSize:0, totalSize:0, productCount:0, orderCount:0, buyerCount:0 };
  }
}

// ============================================================
// SOCKET.IO EVENTS
// ============================================================

io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);
  socket.emit('connection', { status: isConnected ? 'Connected to MongoDB' : 'Using JSON Fallback' });

  // ===== INITIAL DATA LOAD =====
  socket.on('get-data', async () => {
    try {
      let products, orders, buyers, categories, settings;
      if (isConnected && !useFallback) {
        products = await Product.find();
        orders = await Order.find();
        buyers = await Buyer.find();
        categories = await Category.find();
        const settingsDoc = await Settings.findOne();
        settings = settingsDoc ? settingsDoc.toObject() : null;
      } else {
        products = loadJSON(productsFile);
        orders = loadJSON(ordersFile);
        buyers = loadJSON(buyersFile);
        categories = loadJSON(categoriesFile);
        settings = loadJSON(settingsFile)[0] || null;
      }
      socket.emit('init', {
        products: products || [], orders: orders || [],
        buyers: buyers || [], categories: categories || [],
        settings: settings || { whatsapp: '', email: '', phone: '', categories: [] }
      });
      const stats = await calculateStorageStats();
      socket.emit('storage-stats', stats);
    } catch (error) {
      console.error('Error loading data:', error);
      socket.emit('init', { products:[], orders:[], buyers:[], categories:[], settings:{ whatsapp:'', email:'', phone:'', categories:[] } });
    }
  });

  // ===== STORAGE STATS =====
  socket.on('get-storage-stats', async () => {
    const stats = await calculateStorageStats();
    socket.emit('storage-stats', stats);
  });

  // ===== ADD PRODUCT =====
  socket.on('admin-add-product', async (product, callback) => {
    try {
      if (isConnected && !useFallback) {
        await Product.create(product);
      } else {
        let products = loadJSON(productsFile);
        products.push(product);
        saveJSON(productsFile, products);
      }
      let allProducts;
      if (isConnected && !useFallback) {
        allProducts = await Product.find();
      } else {
        allProducts = loadJSON(productsFile);
      }
      io.emit('products-updated', allProducts);
      const stats = await calculateStorageStats();
      io.emit('storage-stats', stats);
      if (callback) callback({ success: true });
    } catch (error) {
      console.error('Error adding product:', error);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  // ===== UPDATE PRODUCT =====
  socket.on('admin-update-product', async (product, callback) => {
    try {
      if (isConnected && !useFallback) {
        await Product.updateOne({ id: product.id }, product);
      } else {
        let products = loadJSON(productsFile);
        products = products.map(p => p.id === product.id ? product : p);
        saveJSON(productsFile, products);
      }
      let allProducts;
      if (isConnected && !useFallback) {
        allProducts = await Product.find();
      } else {
        allProducts = loadJSON(productsFile);
      }
      io.emit('products-updated', allProducts);
      const stats = await calculateStorageStats();
      io.emit('storage-stats', stats);
      if (callback) callback({ success: true });
    } catch (error) {
      console.error('Error updating product:', error);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  // ===== DELETE PRODUCT =====
  socket.on('admin-delete-product', async (productId, callback) => {
    try {
      if (isConnected && !useFallback) {
        await Product.deleteOne({ id: productId });
      } else {
        let products = loadJSON(productsFile);
        products = products.filter(p => p.id !== productId);
        saveJSON(productsFile, products);
      }
      let allProducts;
      if (isConnected && !useFallback) {
        allProducts = await Product.find();
      } else {
        allProducts = loadJSON(productsFile);
      }
      io.emit('products-updated', allProducts);
      const stats = await calculateStorageStats();
      io.emit('storage-stats', stats);
      if (callback) callback({ success: true });
    } catch (error) {
      console.error('Error deleting product:', error);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  // ===== ADD ORDER =====
  socket.on('place-order', async (order, callback) => {
    try {
      const orderId = 'ORD-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
      order.id = orderId;
      order.createdAt = new Date();
      if (isConnected && !useFallback) {
        await Order.create(order);
      } else {
        let orders = loadJSON(ordersFile);
        orders.push(order);
        saveJSON(ordersFile, orders);
      }
      let allOrders;
      if (isConnected && !useFallback) {
        allOrders = await Order.find();
      } else {
        allOrders = loadJSON(ordersFile);
      }
      io.emit('orders-updated', allOrders);
      const stats = await calculateStorageStats();
      io.emit('storage-stats', stats);
      if (callback) callback({ success: true, orderId: orderId });
    } catch (error) {
      console.error('Error placing order:', error);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  // ===== MARK ORDER SENT =====
  socket.on('admin-mark-sent', async (orderId, callback) => {
    try {
      if (isConnected && !useFallback) {
        await Order.updateOne({ id: orderId }, { status: 'sent' });
      } else {
        let orders = loadJSON(ordersFile);
        orders = orders.map(o => o.id === orderId ? { ...o, status: 'sent' } : o);
        saveJSON(ordersFile, orders);
      }
      let allOrders;
      if (isConnected && !useFallback) {
        allOrders = await Order.find();
      } else {
        allOrders = loadJSON(ordersFile);
      }
      io.emit('orders-updated', allOrders);
      if (callback) callback({ success: true });
    } catch (error) {
      console.error('Error marking sent:', error);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  // ===== DELETE ORDER =====
  socket.on('admin-delete-order', async (orderId, callback) => {
    try {
      if (isConnected && !useFallback) {
        await Order.deleteOne({ id: orderId });
      } else {
        let orders = loadJSON(ordersFile);
        orders = orders.filter(o => o.id !== orderId);
        saveJSON(ordersFile, orders);
      }
      let allOrders;
      if (isConnected && !useFallback) {
        allOrders = await Order.find();
      } else {
        allOrders = loadJSON(ordersFile);
      }
      io.emit('orders-updated', allOrders);
      const stats = await calculateStorageStats();
      io.emit('storage-stats', stats);
      if (callback) callback({ success: true });
    } catch (error) {
      console.error('Error deleting order:', error);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  // ===== ADD BUYER =====
  socket.on('admin-add-buyer', async (buyer, callback) => {
    try {
      if (isConnected && !useFallback) {
        await Buyer.create(buyer);
      } else {
        let buyers = loadJSON(buyersFile);
        buyers.push(buyer);
        saveJSON(buyersFile, buyers);
      }
      let allBuyers;
      if (isConnected && !useFallback) {
        allBuyers = await Buyer.find();
      } else {
        allBuyers = loadJSON(buyersFile);
      }
      io.emit('buyers-updated', allBuyers);
      if (callback) callback({ success: true });
    } catch (error) {
      console.error('Error adding buyer:', error);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  // ===== UPDATE BUYER =====
  socket.on('admin-update-buyer', async (buyer, callback) => {
    try {
      if (isConnected && !useFallback) {
        await Buyer.updateOne({ id: buyer.id }, buyer);
      } else {
        let buyers = loadJSON(buyersFile);
        buyers = buyers.map(b => b.id === buyer.id ? buyer : b);
        saveJSON(buyersFile, buyers);
      }
      let allBuyers;
      if (isConnected && !useFallback) {
        allBuyers = await Buyer.find();
      } else {
        allBuyers = loadJSON(buyersFile);
      }
      io.emit('buyers-updated', allBuyers);
      if (callback) callback({ success: true });
    } catch (error) {
      console.error('Error updating buyer:', error);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  // ===== DELETE BUYER =====
  socket.on('admin-delete-buyer', async (buyerId, callback) => {
    try {
      if (isConnected && !useFallback) {
        await Buyer.deleteOne({ id: buyerId });
      } else {
        let buyers = loadJSON(buyersFile);
        buyers = buyers.filter(b => b.id !== buyerId);
        saveJSON(buyersFile, buyers);
      }
      let allBuyers;
      if (isConnected && !useFallback) {
        allBuyers = await Buyer.find();
      } else {
        allBuyers = loadJSON(buyersFile);
      }
      io.emit('buyers-updated', allBuyers);
      if (callback) callback({ success: true });
    } catch (error) {
      console.error('Error deleting buyer:', error);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  // ===== UPDATE SETTINGS =====
  socket.on('admin-update-settings', async (newSettings, callback) => {
    try {
      if (isConnected && !useFallback) {
        await Settings.updateOne({}, newSettings, { upsert: true });
      } else {
        let settings = loadJSON(settingsFile);
        if (!Array.isArray(settings)) settings = [];
        if (settings.length === 0) settings.push(newSettings);
        else settings[0] = { ...settings[0], ...newSettings };
        saveJSON(settingsFile, settings);
      }
      if (callback) callback({ success: true });
    } catch (error) {
      console.error('Error updating settings:', error);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  // ===== ADD CATEGORY (FIXED - broadcasts to all clients) =====
  socket.on('add-category', async (category, callback) => {
    try {
      // Check for duplicate
      if (isConnected && !useFallback) {
        const existing = await Category.findOne({ name: category.name });
        if (existing) {
          if (callback) callback({ success: true, message: 'Category already exists' });
          return;
        }
        await Category.create(category);
      } else {
        let categories = loadJSON(categoriesFile);
        const exists = categories.some(c => (c.name || c) === category.name);
        if (!exists) {
          categories.push(category);
          saveJSON(categoriesFile, categories);
        }
      }

      // Broadcast updated categories to ALL clients
      let allCategories;
      if (isConnected && !useFallback) {
        allCategories = await Category.find();
      } else {
        allCategories = loadJSON(categoriesFile);
      }
      io.emit('categories-updated', allCategories);

      if (callback) callback({ success: true });
    } catch (error) {
      console.error('Error adding category:', error);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  // ===== UPDATE CATEGORY =====
  socket.on('admin-update-category', async (data, callback) => {
    try {
      const { oldName, newName } = data;
      console.log('Renaming category:', oldName, '->', newName);
      
      if (isConnected && !useFallback) {
        await Category.updateMany({ name: oldName }, { name: newName });
        await Product.updateMany({ cat: oldName }, { cat: newName });
        const existingSettings = await Settings.findOne();
        if (existingSettings && existingSettings.categories) {
          const newCats = existingSettings.categories.map(c => c === oldName ? newName : c);
          await Settings.collection.updateOne(
            { _id: existingSettings._id },
            { $set: { categories: newCats } }
          );
        }
      } else {
        let categories = loadJSON(categoriesFile);
        categories = categories.map(c => {
          if (typeof c === 'string') return c === oldName ? newName : c;
          return c.name === oldName ? { ...c, name: newName } : c;
        });
        saveJSON(categoriesFile, categories);
        let products = loadJSON(productsFile);
        products = products.map(p => p.cat === oldName ? { ...p, cat: newName } : p);
        saveJSON(productsFile, products);
        let settingsArr = loadJSON(settingsFile);
        if (Array.isArray(settingsArr) && settingsArr[0] && settingsArr[0].categories) {
          settingsArr[0].categories = settingsArr[0].categories.map(c => c === oldName ? newName : c);
          saveJSON(settingsFile, settingsArr);
        }
      }

      // Broadcast fresh data to all clients
      let allProducts, allOrders, allBuyers, allCategories, allSettings;
      if (isConnected && !useFallback) {
        allProducts = await Product.find();
        allOrders = await Order.find();
        allBuyers = await Buyer.find();
        allCategories = await Category.find();
        const sd = await Settings.findOne();
        allSettings = sd ? sd.toObject() : null;
      } else {
        allProducts = loadJSON(productsFile);
        allOrders = loadJSON(ordersFile);
        allBuyers = loadJSON(buyersFile);
        allCategories = loadJSON(categoriesFile);
        allSettings = (loadJSON(settingsFile) || [{}])[0] || null;
      }
      
      io.emit('init', {
        products: allProducts || [], orders: allOrders || [],
        buyers: allBuyers || [], categories: allCategories || [],
        settings: allSettings || { whatsapp: '', email: '', phone: '', categories: [] }
      });
      
      console.log('Category renamed successfully:', oldName, '->', newName);
      if (callback) callback({ success: true });
    } catch (error) {
      console.error('Error updating category:', error);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  // ===== DELETE CATEGORY =====
  socket.on('admin-delete-category', async (categoryName, callback) => {
    try {
      if (isConnected && !useFallback) {
        await Category.deleteOne({ name: categoryName });
      } else {
        let categories = loadJSON(categoriesFile);
        categories = categories.filter(c => c.name !== categoryName);
        saveJSON(categoriesFile, categories);
      }
      let allCategories;
      if (isConnected && !useFallback) {
        allCategories = await Category.find();
      } else {
        allCategories = loadJSON(categoriesFile);
      }
      io.emit('categories-updated', allCategories);
      if (callback) callback({ success: true });
    } catch (error) {
      console.error('Error deleting category:', error);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);
  });
});

// ============================================================
// START SERVER
// ============================================================

server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📊 Storage: ${isConnected ? 'MongoDB Atlas' : 'JSON Fallback'}`);
  console.log(`🌙 Sleep mode: ${SLEEP_START}:00 AM - ${SLEEP_END}:00 AM IST`);
});
