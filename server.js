// ============================================================
// Shape Trade Portal - Server (v2.1.0 - FIXED Data Persistence)
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
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000
    });
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
      productsSize: 0,
      ordersSize: 0,
      buyersSize: 0,
      totalSize: 0,
      productCount: 0,
      orderCount: 0,
      buyerCount: 0
    };

    if (isConnected && !useFallback) {
      // Get from MongoDB
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
      // Get from JSON fallback
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
    return {
      productsSize: 0,
      ordersSize: 0,
      buyersSize: 0,
      totalSize: 0,
      productCount: 0,
      orderCount: 0,
      buyerCount: 0
    };
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
        products: products || [],
        orders: orders || [],
        buyers: buyers || [],
        categories: categories || [],
        settings: settings || { whatsapp: '', email: '', phone: '', categories: [] }
      });

      // Also send storage stats immediately
      const stats = await calculateStorageStats();
      socket.emit('storage-stats', stats);

    } catch (error) {
      console.error('Error loading data:', error);
      socket.emit('init', {
        products: [],
        orders: [],
        buyers: [],
        categories: [],
        settings: { whatsapp: '', email: '', phone: '', categories: [] }
      });
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

      // Broadcast updated products to ALL clients
      let allProducts;
      if (isConnected && !useFallback) {
        allProducts = await Product.find();
      } else {
        allProducts = loadJSON(productsFile);
      }
      io.emit('products-updated', allProducts);

      // Send updated storage stats
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
        if (settings.length === 0) {
          settings.push(newSettings);
        } else {
          settings[0] = { ...settings[0], ...newSettings };
        }
        saveJSON(settingsFile, settings);
      }

      if (callback) callback({ success: true });
    } catch (error) {
      console.error('Error updating settings:', error);
      if (callback) callback({ success: false, error: error.message });
    }
  });

  // ===== ADD CATEGORY =====
  socket.on('add-category', async (category, callback) => {
    try {
      if (isConnected && !useFallback) {
        await Category.create(category);
      } else {
        let categories = loadJSON(categoriesFile);
        categories.push(category);
        saveJSON(categoriesFile, categories);
      }

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
      
      if (isConnected && !useFallback) {
        // Update category name in Categories collection
        await Category.updateOne({ name: oldName }, { name: newName });
        
        // Update all products that have this category
        await Product.updateMany({ cat: oldName }, { cat: newName });
      } else {
        // Update in JSON files
        let categories = loadJSON(categoriesFile);
        categories = categories.map(c => c.name === oldName ? { ...c, name: newName } : c);
        saveJSON(categoriesFile, categories);
        
        let products = loadJSON(productsFile);
        products = products.map(p => p.cat === oldName ? { ...p, cat: newName } : p);
        saveJSON(productsFile, products);
      }

      // Emit updates
      let allCategories;
      let allProducts;
      if (isConnected && !useFallback) {
        allCategories = await Category.find();
        allProducts = await Product.find();
      } else {
        allCategories = loadJSON(categoriesFile);
        allProducts = loadJSON(productsFile);
      }
      io.emit('categories-updated', allCategories);
      io.emit('products-updated', allProducts);

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
});
