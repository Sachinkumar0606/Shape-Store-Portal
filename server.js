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

function loadProducts() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      products = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      console.log('✓ Loaded', products.length, 'products');
    }
  } catch (e) {
    console.warn('Could not load products:', e.message);
    products = [];
  }
}

function saveProducts() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(products, null, 2));
    console.log('✓ Saved', products.length, 'products');
  } catch (e) {
    console.warn('Could not save products:', e.message);
  }
}

loadProducts();

// ===== EXPRESS =====
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/api/products', (req, res) => {
  res.json({ products });
});

app.post('/api/products', (req, res) => {
  const product = req.body;
  products.unshift(product);
  saveProducts();
  io.emit('products-updated', { products });
  res.json({ success: true, product });
});

// ===== SOCKET.IO =====
io.on('connection', (socket) => {
  console.log('✓ Client connected:', socket.id);
  
  // Send current products to new client
  socket.emit('products-updated', { products });
  
  // Handle product sync from admin
  socket.on('sync-products', (prods) => {
    products = prods || [];
    saveProducts();
    console.log('✓ Products synced:', products.length);
    io.emit('products-updated', { products });
  });
  
  // Handle getting products
  socket.on('get-products', () => {
    socket.emit('products-updated', { products });
  });
  
  // Handle adding product from admin
  socket.on('add-product', (product) => {
    console.log('➕ New product:', product.name);
    products.unshift(product);
    saveProducts();
    io.emit('products-updated', { products });
  });
  
  socket.on('disconnect', () => {
    console.log('✗ Client disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════╗
║   Shape Store Portal Running      ║
║   Port: ${PORT}                           ║
║   Products: ${products.length}                         ║
╚════════════════════════════════════╝
  `);
});
