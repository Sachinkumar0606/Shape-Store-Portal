// ============================================================
// Shape Trade Portal - Server (v2.1.0 - Fixed Storage Stats)
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
  category: String,
  mrp: Number,
  sellingPrice: Number,
  description: String,
  image: String,
  createdAt: { type: Date, default: Date.now }
});

const orderSchema = new mongoose.Schema({
  id: String,
  products: Array,
  totalAmount: Number,
  buyerName: String,
  buyerPhone: String,
  buyerEmail: String,
  status: String,
  createdAt: { type: Date, default: Date.now }
});

const buyerSchema = new mongoose.Schema({
  id: String,
  name: String,
  phone: String,
  email: String,
  lastPurchase: Date,
  createdAt: { type: Date, default: Date.now }
});

const categorySchema = new mongoose.Schema({
  name: String,
  createdAt: { type: Date, default: Date.now }
});

const Product = mongoose.model('Product', productSchema);
const Order = mongoose.model('Order', orderSchema);
const Buyer = mongoose.model('Buyer', buyerSchema);
const Category = mongoose.model('Category', categorySchema);

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

function loadJSON(file) {
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return [];
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ============================================================
// STORAGE STATS CALCULATION (FIXED)
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
      // Get from MongoDB - calculate actual document sizes
      const products = await Product.find().select('+image').lean();
      const orders = await Order.find().lean();
      const buyers = await Buyer.find().lean();

      // Calculate sizes in bytes
      stats.productsSize = JSON.stringify(products).length / (1024 * 1024); // Convert to MB
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
  console.log('User connected:', socket.id);
  socket.emit('connection', { status: isConnected ? 'Connected to MongoDB' : 'Using JSON Fallback' });

  // ===== LOAD INITIAL DATA =====
  socket.on('load-products', async () => {
    try {
      let products;
      if (isConnected && !useFallback) {
        products = await Product.find();
      } else {
        products = loadJSON(productsFile);
      }
      socket.emit('products-loaded', products);
    } catch (error) {
      console.error('Error loading products:', error);
    }
  });

  socket.on('load-orders', async () => {
    try {
      let orders;
      if (isConnected && !useFallback) {
        orders = await Order.find();
      } else {
        orders = loadJSON(ordersFile);
      }
      socket.emit('orders-loaded', orders);
    } catch (error) {
      console.error('Error loading orders:', error);
    }
  });

  socket.on('load-buyers', async () => {
    try {
      let buyers;
      if (isConnected && !useFallback) {
        buyers = await Buyer.find();
      } else {
        buyers = loadJSON(buyersFile);
      }
      socket.emit('buyers-loaded', buyers);
    } catch (error) {
      console.error('Error loading buyers:', error);
    }
  });

  socket.on('load-categories', async () => {
    try {
      let categories;
      if (isConnected && !useFallback) {
        categories = await Category.find();
      } else {
        categories = loadJSON(categoriesFile);
      }
      socket.emit('categories-loaded', categories);
    } catch (error) {
      console.error('Error loading categories:', error);
    }
  });

  // ===== STORAGE STATS (NEW - FIXED) =====
  socket.on('get-storage-stats', async () => {
    const stats = await calculateStorageStats();
    socket.emit('storage-stats', stats);
  });

  // ===== ADD PRODUCT =====
  socket.on('add-product', async (product) => {
    try {
      if (isConnected && !useFallback) {
        await Product.create(product);
      } else {
        let products = loadJSON(productsFile);
        products.push(product);
        saveJSON(productsFile, products);
      }
      
      // Broadcast to all clients including sender
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
      
    } catch (error) {
      console.error('Error adding product:', error);
    }
  });

  // ===== DELETE PRODUCT =====
  socket.on('delete-product', async (productId) => {
    try {
      if (isConnected && !useFallback) {
        await Product.deleteOne({ id: productId });
      } else {
        let products = loadJSON(productsFile);
        products = products.filter(p => p.id !== productId);
        saveJSON(productsFile, products);
      }
      
      // Broadcast to all clients
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
      
    } catch (error) {
      console.error('Error deleting product:', error);
    }
  });

  // ===== UPDATE PRODUCT =====
  socket.on('update-product', async (product) => {
    try {
      if (isConnected && !useFallback) {
        await Product.updateOne({ id: product.id }, product);
      } else {
        let products = loadJSON(productsFile);
        products = products.map(p => p.id === product.id ? product : p);
        saveJSON(productsFile, products);
      }
      
      // Broadcast to all clients
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
      
    } catch (error) {
      console.error('Error updating product:', error);
    }
  });

  // ===== ADD ORDER =====
  socket.on('add-order', async (order) => {
    try {
      if (isConnected && !useFallback) {
        await Order.create(order);
      } else {
        let orders = loadJSON(ordersFile);
        orders.push(order);
        saveJSON(ordersFile, orders);
      }
      
      // Broadcast to all clients
      let allOrders;
      if (isConnected && !useFallback) {
        allOrders = await Order.find();
      } else {
        allOrders = loadJSON(ordersFile);
      }
      io.emit('orders-updated', allOrders);
      
      // Send updated storage stats
      const stats = await calculateStorageStats();
      io.emit('storage-stats', stats);
      
    } catch (error) {
      console.error('Error adding order:', error);
    }
  });

  // ===== DELETE ORDER =====
  socket.on('delete-order', async (orderId) => {
    try {
      if (isConnected && !useFallback) {
        await Order.deleteOne({ id: orderId });
      } else {
        let orders = loadJSON(ordersFile);
        orders = orders.filter(o => o.id !== orderId);
        saveJSON(ordersFile, orders);
      }
      
      // Broadcast to all clients
      let allOrders;
      if (isConnected && !useFallback) {
        allOrders = await Order.find();
      } else {
        allOrders = loadJSON(ordersFile);
      }
      io.emit('orders-updated', allOrders);
      
      // Send updated storage stats
      const stats = await calculateStorageStats();
      io.emit('storage-stats', stats);
      
    } catch (error) {
      console.error('Error deleting order:', error);
    }
  });

  // ===== ADD CATEGORY =====
  socket.on('add-category', async (category) => {
    try {
      if (isConnected && !useFallback) {
        await Category.create(category);
      } else {
        let categories = loadJSON(categoriesFile);
        categories.push(category);
        saveJSON(categoriesFile, categories);
      }
      
      // Broadcast to all clients
      let allCategories;
      if (isConnected && !useFallback) {
        allCategories = await Category.find();
      } else {
        allCategories = loadJSON(categoriesFile);
      }
      io.emit('categories-updated', allCategories);
      
    } catch (error) {
      console.error('Error adding category:', error);
    }
  });

  // ===== DELETE CATEGORY =====
  socket.on('admin-delete-category', async (categoryName) => {
    try {
      if (isConnected && !useFallback) {
        await Category.deleteOne({ name: categoryName });
      } else {
        let categories = loadJSON(categoriesFile);
        categories = categories.filter(c => c.name !== categoryName);
        saveJSON(categoriesFile, categories);
      }
      
      // Broadcast to all clients
      let allCategories;
      if (isConnected && !useFallback) {
        allCategories = await Category.find();
      } else {
        allCategories = loadJSON(categoriesFile);
      }
      io.emit('categories-updated', allCategories);
      
    } catch (error) {
      console.error('Error deleting category:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// ============================================================
// START SERVER
// ============================================================

server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`Storage: ${isConnected ? 'MongoDB Atlas' : 'JSON Fallback'}`);
});
