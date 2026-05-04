const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'products.json');

let products = [];
let clients = {};

function loadProducts() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      products = JSON.parse(data);
      console.log('✓ Loaded', products.length, 'products from disk');
    } else {
      console.log('📝 No products file, starting fresh');
      products = [];
    }
  } catch (e) {
    console.error('Error loading products:', e.message);
    products = [];
  }
}

function saveProducts() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(products, null, 2));
    console.log('✓ Saved', products.length, 'products to disk');
  } catch (e) {
    console.error('Error saving products:', e.message);
  }
}

loadProducts();

// ===== EXPRESS =====
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb' }));

// ===== SOCKET.IO =====
io.on('connection', (socket) => {
  const clientId = socket.id;
  clients[clientId] = { socket, role: null };
  console.log(`✓ Client connected: ${clientId}`);
  
  // Send all products to new client immediately
  socket.emit('load-all-products', { products });
  
  // When a client identifies themselves
  socket.on('set-role', (role) => {
    clients[clientId].role = role;
    console.log(`  → Client ${clientId} is ${role}`);
    socket.emit('load-all-products', { products });
  });
  
  // When admin adds a product
  socket.on('add-product', (product) => {
    console.log(`\n➕ NEW PRODUCT: ${product.name}`);
    console.log(`   Code: ${product.code}`);
    console.log(`   Image: ${product.customImg ? product.customImg.substring(0, 50) + '...' : 'none'}`);
    
    products.unshift(product);
    saveProducts();
    
    console.log(`   📡 Broadcasting to ${Object.keys(clients).length} clients`);
    io.emit('products-changed', { products, action: 'added', product });
  });
  
  // Get all products
  socket.on('get-products', () => {
    socket.emit('load-all-products', { products });
  });
  
  // Delete product
  socket.on('delete-product', (productId) => {
    products = products.filter(p => p.id !== productId);
    saveProducts();
    io.emit('products-changed', { products, action: 'deleted', productId });
  });
  
  socket.on('disconnect', () => {
    delete clients[clientId];
    console.log(`✗ Client disconnected: ${clientId}`);
  });
});

// ===== START SERVER =====
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════╗
║  🚀 Shape Store Portal is LIVE        ║
║  📦 Products: ${products.length}                       ║
║  👥 Clients: ${Object.keys(clients).length}                        ║
╚═══════════════════════════════════════╝
  `);
});
