const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e8,  // 100 MB - for product images
  pingTimeout: 60000
});

const PORT = process.env.PORT || 3000;
const PRODUCTS_FILE = path.join(__dirname, 'products.json');
const ORDERS_FILE = path.join(__dirname, 'orders.json');

// ===== STORAGE =====
let products = [];
let orders = [];

function loadData(){
  try {
    if (fs.existsSync(PRODUCTS_FILE)) {
      products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
      console.log('✅ Loaded ' + products.length + ' products');
    }
  } catch (e) {
    console.log('⚠️ Could not load products: ' + e.message);
    products = [];
  }
  try {
    if (fs.existsSync(ORDERS_FILE)) {
      orders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
      console.log('✅ Loaded ' + orders.length + ' orders');
    }
  } catch (e) {
    console.log('⚠️ Could not load orders: ' + e.message);
    orders = [];
  }
}

function saveProducts(){
  try {
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2));
  } catch (e) {
    console.log('⚠️ Save products failed: ' + e.message);
  }
}

function saveOrders(){
  try {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
  } catch (e) {
    console.log('⚠️ Save orders failed: ' + e.message);
  }
}

loadData();

// ===== EXPRESS =====
app.use(express.static(path.join(__dirname, 'public')));

// ===== SOCKET.IO =====
io.on('connection', (socket) => {
  console.log('🔌 Connected: ' + socket.id + ' (total: ' + io.engine.clientsCount + ')');
  
  // Send current data to new client
  socket.emit('products-list', products);
  socket.emit('orders-list', orders);
  
  // ===== PRODUCTS =====
  socket.on('get-products', () => {
    socket.emit('products-list', products);
  });
  
  // Sync the entire products array (when admin adds/changes)
  socket.on('sync-products', (newProducts) => {
    if (Array.isArray(newProducts)) {
      products = newProducts;
      saveProducts();
      console.log('💾 Products synced: ' + products.length + ' items, broadcasting to ' + io.engine.clientsCount + ' clients');
      io.emit('products-list', products);
      socket.emit('product-saved', { success: true });
    } else {
      socket.emit('product-saved', { success: false });
    }
  });
  
  // ===== ORDERS =====
  socket.on('get-orders', () => {
    socket.emit('orders-list', orders);
  });
  
  socket.on('save-order', (order) => {
    if (!order || !order.id) return;
    // Replace existing or add new
    const idx = orders.findIndex(o => o.id === order.id);
    if (idx >= 0) orders[idx] = order;
    else orders.unshift(order);
    saveOrders();
    console.log('📝 Order saved: ' + order.id);
    io.emit('orders-list', orders);
  });
  
  socket.on('update-order', (payload) => {
    if (!payload || !payload.id) return;
    const idx = orders.findIndex(o => o.id === payload.id);
    if (idx >= 0) {
      orders[idx] = Object.assign({}, orders[idx], payload.data || {});
      saveOrders();
      console.log('✏️ Order updated: ' + payload.id);
      io.emit('orders-list', orders);
    }
  });
  
  socket.on('delete-order', (id) => {
    orders = orders.filter(o => o.id !== id);
    saveOrders();
    console.log('🗑️ Order deleted: ' + id);
    io.emit('orders-list', orders);
  });
  
  socket.on('clear-orders', () => {
    orders = [];
    saveOrders();
    console.log('🗑️ All orders cleared');
    io.emit('orders-list', orders);
  });
  
  socket.on('disconnect', () => {
    console.log('🔌 Disconnected: ' + socket.id);
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════╗');
  console.log('║  🚀 Shape Portal LIVE on port ' + PORT);
  console.log('║  📦 Products: ' + products.length);
  console.log('║  📝 Orders: ' + orders.length);
  console.log('╚════════════════════════════════════════╝');
  console.log('');
});
