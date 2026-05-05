const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e8,
  pingTimeout: 60000,
  pingInterval: 25000
});

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const BUYERS_FILE = path.join(DATA_DIR, 'buyers.json');

if (!fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR); } catch(e) {}
}

let products = [];
let orders = [];
let buyers = [
  { id: 'buyer1', pass: '1234', name: 'Demo Buyer', shop: 'Demo Shop' }
];

function load(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch(e) { console.log('Load error', e.message); }
  return fallback;
}
function save(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
  catch(e) { console.log('Save error', e.message); }
}

products = load(PRODUCTS_FILE, []);
orders = load(ORDERS_FILE, []);
buyers = load(BUYERS_FILE, buyers);
save(BUYERS_FILE, buyers);

console.log('Loaded ' + products.length + 'p, ' + orders.length + 'o, ' + buyers.length + 'b');

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log('+ ' + socket.id);
  socket.emit('init', { products, orders, buyers });
  
  socket.on('get-data', () => {
    socket.emit('init', { products, orders, buyers });
  });
  
  socket.on('admin-add-product', (product, ack) => {
    if (!product || !product.id) { if (ack) ack({ success: false, error: 'Invalid product' }); return; }
    if (products.find(p => p.code && product.code && p.code.toLowerCase() === product.code.toLowerCase())) {
      if (ack) ack({ success: false, error: 'Code already exists' }); return;
    }
    products.unshift(product);
    save(PRODUCTS_FILE, products);
    io.emit('products-update', products);
    if (ack) ack({ success: true });
  });
  
  socket.on('admin-update-product', (product, ack) => {
    if (!product || !product.id) { if (ack) ack({ success: false }); return; }
    const idx = products.findIndex(p => p.id === product.id);
    if (idx >= 0) {
      products[idx] = product;
      save(PRODUCTS_FILE, products);
      io.emit('products-update', products);
      if (ack) ack({ success: true });
    } else if (ack) ack({ success: false });
  });
  
  socket.on('admin-delete-product', (productId) => {
    products = products.filter(p => p.id !== productId);
    save(PRODUCTS_FILE, products);
    io.emit('products-update', products);
  });
  
  socket.on('admin-mark-sent', (orderId) => {
    const o = orders.find(x => x.id === orderId);
    if (o) {
      o.status = 'sent';
      o.sentAt = new Date().toISOString();
      save(ORDERS_FILE, orders);
      io.emit('orders-update', orders);
    }
  });
  
  socket.on('admin-delete-order', (orderId) => {
    orders = orders.filter(o => o.id !== orderId);
    save(ORDERS_FILE, orders);
    io.emit('orders-update', orders);
  });
  
  socket.on('admin-clear-orders', () => {
    orders = [];
    save(ORDERS_FILE, orders);
    io.emit('orders-update', orders);
  });
  
  socket.on('admin-add-buyer', (buyer, ack) => {
    if (!buyer || !buyer.id || !buyer.pass) { if (ack) ack({ success: false, error: 'Need ID and password' }); return; }
    if (buyers.find(b => b.id.toLowerCase() === buyer.id.toLowerCase())) {
      if (ack) ack({ success: false, error: 'ID already exists' }); return;
    }
    buyers.push(buyer);
    save(BUYERS_FILE, buyers);
    io.emit('buyers-update', buyers);
    if (ack) ack({ success: true });
  });
  
  socket.on('admin-delete-buyer', (buyerId) => {
    buyers = buyers.filter(b => b.id !== buyerId);
    save(BUYERS_FILE, buyers);
    io.emit('buyers-update', buyers);
  });
  
  socket.on('place-order', (order, ack) => {
    if (!order || !order.items || !order.buyerId) { if (ack) ack({ success: false, error: 'Invalid order' }); return; }
    order.id = 'O' + Date.now();
    order.status = 'new';
    order.createdAt = new Date().toISOString();
    orders.unshift(order);
    save(ORDERS_FILE, orders);
    io.emit('orders-update', orders);
    if (ack) ack({ success: true, orderId: order.id });
  });
  
  socket.on('disconnect', () => { console.log('- ' + socket.id); });
});

server.listen(PORT, () => {
  console.log('Shape Trade Portal LIVE on port ' + PORT);
});
