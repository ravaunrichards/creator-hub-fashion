'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

loadEnvFile(path.join(__dirname, '.env'));
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DB_PATH = path.resolve(ROOT, process.env.DATABASE_PATH || './data/store.sqlite');
const STORE_NAME = process.env.STORE_NAME || 'Creator Hub Fashion';
const SHIPPING_FEE_JMD = positiveInteger(process.env.SHIPPING_FEE_JMD, 500);
const FREE_SHIPPING_THRESHOLD_JMD = positiveInteger(process.env.FREE_SHIPPING_THRESHOLD_JMD, 10000);
const MAX_BODY_BYTES = 1024 * 1024;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
const COOKIE_NAME = 'chf_session';
const VALID_PARISHES = new Set(['Clarendon','Hanover','Kingston','Manchester','Portland','Saint Andrew','Saint Ann','Saint Catherine','Saint Elizabeth','Saint James','Saint Mary','Saint Thomas','Trelawny','Westmoreland']);
const paypalEnabled = Boolean(
  process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET &&
  Number.isFinite(Number(process.env.JMD_PER_USD)) && Number(process.env.JMD_PER_USD) > 0
);
const PAYPAL_BASE_URL = (process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com').replace(/\/$/, '');
const PAYPAL_CURRENCY = 'USD'; // The current PayPal adapter settles in USD using the configured JMD_PER_USD rate.

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
db.exec(fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8'));
ensureColumn('orders', 'inventory_released', 'INTEGER NOT NULL DEFAULT 0 CHECK (inventory_released IN (0,1))');
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon',
};
const rateBuckets = new Map();

function runTransaction(callback) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = callback(); db.exec('COMMIT'); return result; }
  catch (error) { try { db.exec('ROLLBACK'); } catch { /* preserve original error */ } throw error; }
}
function ensureColumn(tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some(column => column.name === columnName)) db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith('#') || Object.hasOwn(process.env, match[1])) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}
function positiveInteger(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}
function id() { return crypto.randomUUID(); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function nowSeconds() { return Math.floor(Date.now() / 1000); }
function parseJsonArray(value) { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function productFromRow(row) {
  if (!row) return null;
  return {
    id: row.id, slug: row.slug, name: row.name, category: row.category,
    priceJmd: row.price_jmd, compareAtJmd: row.compare_at_jmd,
    description: row.description, imageUrl: row.image_url, imageAlt: row.image_alt,
    colors: parseJsonArray(row.colors_json), sizes: parseJsonArray(row.sizes_json),
    tags: parseJsonArray(row.tags_json), stock: row.stock, featured: Boolean(row.featured),
    active: Boolean(row.active), createdAt: row.created_at,
  };
}
function publicCustomer(row) {
  return row ? { id: row.id, name: row.name, email: row.email, role: row.role } : null;
}
function json(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}
function fail(res, status, message, extra = {}) { json(res, status, { error: message, ...extra }); }
function getCookies(req) {
  const output = {};
  for (const segment of (req.headers.cookie || '').split(';')) {
    const eq = segment.indexOf('=');
    if (eq < 0) continue;
    const key = segment.slice(0, eq).trim();
    try { output[key] = decodeURIComponent(segment.slice(eq + 1).trim()); } catch { /* Ignore malformed cookie. */ }
  }
  return output;
}
function sessionCookie(token, maxAge = SESSION_TTL_SECONDS) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
function getSession(req) {
  const token = getCookies(req)[COOKIE_NAME];
  if (!token || token.length > 200) return null;
  const row = db.prepare(`SELECT c.id, c.name, c.email, c.role FROM sessions s
    JOIN customers c ON c.id=s.customer_id WHERE s.token_hash=? AND s.expires_at>?`)
    .get(sha256(token), nowSeconds());
  return row ? publicCustomer(row) : null;
}
function requireCustomer(req, res, role = 'customer') {
  const customer = getSession(req);
  if (!customer) { fail(res, 401, 'Please sign in to continue.'); return null; }
  if (role === 'admin' && customer.role !== 'admin') { fail(res, 403, 'Administrator access is required.'); return null; }
  return customer;
}
function rateLimit(req, res, key, max = 12, windowMs = 10 * 60 * 1000) {
  const ip = req.socket.remoteAddress || 'unknown';
  const bucketKey = `${key}:${ip}`;
  const time = Date.now();
  const bucket = rateBuckets.get(bucketKey);
  if (!bucket || time - bucket.start > windowMs) {
    rateBuckets.set(bucketKey, { start: time, count: 1 });
    return true;
  }
  bucket.count += 1;
  if (bucket.count > max) { fail(res, 429, 'Too many attempts. Please try again later.'); return false; }
  return true;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (Buffer.byteLength(data) > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body is too large.'), { statusCode: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        const parsed = JSON.parse(data);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a JSON object.');
        resolve(parsed);
      } catch { reject(Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 })); }
    });
    req.on('error', reject);
  });
}
function cleanText(value, max = 300) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function isEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254; }
function intIn(value, min, max, fallback = min) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}
function orderCode() { return `CHF-${crypto.randomBytes(4).toString('hex').toUpperCase()}`; }
function newPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  } catch { return false; }
}

const seedItems = [
  ['silk-touch-midi-dress','Silk-Touch Midi Dress','Dresses',4200,5600,'A softly draped midi dress with an elegant everyday silhouette.','https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=900&q=85','Woman wearing a dark evening dress',['Black','Wine','Sage'],['S','M','L','XL'],['new','occasion'],22,1],
  ['relaxed-linen-shirt','Relaxed Linen-Blend Shirt','Tops',2850,3500,'An airy, easy-fit shirt for warm days and effortless layering.','https://images.unsplash.com/photo-1598554747436-c9293d6a588f?auto=format&fit=crop&w=900&q=85','Neutral relaxed-fit shirt',['Cream','White','Blue'],['XS','S','M','L','XL'],['bestseller'],35,1],
  ['wide-leg-tailored-trousers','Wide-Leg Tailored Trousers','Bottoms',3900,0,'A clean tailored waist and fluid wide leg make these an everyday staple.','https://images.unsplash.com/photo-1506629905607-d9c297d7a7e5?auto=format&fit=crop&w=900&q=85','Tailored neutral trousers',['Black','Stone','Brown'],['S','M','L','XL'],['workwear'],18,1],
  ['everyday-platform-sneakers','Everyday Platform Sneakers','Shoes',5200,6500,'A cushioned platform profile designed for all-day city wear.','https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=85','Red low-top sneakers',['White','Black','Red'],['36','37','38','39','40','41'],['bestseller'],14,1],
  ['ribbed-knit-tank','Ribbed Knit Tank','Tops',1450,0,'A close-fit ribbed tank that works solo or as a versatile base layer.','https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?auto=format&fit=crop&w=900&q=85','Casual ribbed tank top',['White','Black','Oat'],['XS','S','M','L'],['basics'],40,0],
  ['soft-structure-blazer','Soft-Structure Blazer','Outerwear',6900,8200,'A lightly structured layer with a modern, relaxed shoulder.','https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=900&q=85','Neutral blazer on model',['Black','Sand','Taupe'],['S','M','L','XL'],['workwear','new'],9,1],
  ['pleated-mini-skirt','Pleated Mini Skirt','Skirts',2600,0,'Sharp pleats and a comfortable waistband add movement to any look.','https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?auto=format&fit=crop&w=900&q=85','Pleated skirt outfit',['Black','Grey','Plaid'],['XS','S','M','L'],['trending'],26,0],
  ['sculpted-crossbody-bag','Sculpted Crossbody Bag','Bags',3300,4100,'A compact everyday bag with a sculpted shape and adjustable strap.','https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=900&q=85','Structured black crossbody bag',['Black','Cream','Tan'],['One size'],['accessories','new'],17,1],
  ['gold-tone-hoop-set','Gold-Tone Hoop Set','Accessories',1250,0,'Three pairs of lightweight hoops for mix-and-match styling.','https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=900&q=85','Gold tone hoop earrings',['Gold','Silver'],['One size'],['accessories'],50,0],
  ['linen-blend-co-ord','Linen-Blend Co-Ord Set','Sets',5800,7200,'A matching top and short set with a relaxed warm-weather fit.','https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=85','Model in a coordinated summer outfit',['White','Olive','Black'],['S','M','L','XL'],['vacation','new'],12,1],
  ['straight-leg-denim','Straight-Leg Denim Jeans','Denim',4700,0,'A classic straight-leg shape with a mid-rise fit and subtle wash.','https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=900&q=85','Blue denim jeans',['Blue','Dark wash','Black'],['XS','S','M','L','XL'],['bestseller'],24,1],
  ['satin-evening-top','Satin Evening Top','Tops',3100,3900,'Soft sheen and a fluid drape make this an effortless evening piece.','https://images.unsplash.com/photo-1564257577-1a4b0d1b8d4f?auto=format&fit=crop&w=900&q=85','Elegant satin top',['Black','Champagne','Emerald'],['S','M','L'],['occasion'],15,0],
  ['everyday-slide-sandals','Everyday Slide Sandals','Shoes',2400,0,'A simple slide with a padded footbed for easy everyday comfort.','https://images.unsplash.com/photo-1603487742131-4160ec999306?auto=format&fit=crop&w=900&q=85','Minimal slide sandals',['Black','Tan','White'],['36','37','38','39','40'],['summer'],21,0],
  ['oversized-denim-jacket','Oversized Denim Jacket','Outerwear',6200,7500,'A versatile roomy denim layer with classic pocket detailing.','https://images.unsplash.com/photo-1543076447-215ad9ba6923?auto=format&fit=crop&w=900&q=85','Oversized denim jacket',['Light blue','Indigo','Black'],['S','M','L','XL'],['new'],8,0],
  ['everyday-tote','Everyday Canvas Tote','Bags',1800,2200,'A useful roomy tote for daily essentials, books and weekend errands.','https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=900&q=85','Canvas everyday tote bag',['Natural','Black','Olive'],['One size'],['essentials'],31,0],
  ['soft-knit-cardigan','Soft-Knit Cardigan','Knitwear',4300,0,'A soft touch layer with easy buttons and a gently relaxed fit.','https://images.unsplash.com/photo-1434389677669-e08b4cac3105?auto=format&fit=crop&w=900&q=85','Soft knit sweater',['Cream','Grey','Rose'],['S','M','L','XL'],['layering'],16,1],
  ['minimal-sport-set','Minimal Sport Set','Activewear',3600,0,'A flexible matching set for walks, travel and low-impact training.','https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=85','Athleisure outfit',['Black','Lilac','Blue'],['XS','S','M','L'],['active'],19,0],
  ['rectangular-sunglasses','Rectangular Sunglasses','Accessories',1550,0,'A modern angular frame for sunny afternoons and statement looks.','https://images.unsplash.com/photo-1511499767150-a48a237f0083?auto=format&fit=crop&w=900&q=85','Stylish sunglasses',['Black','Tortoise','Cream'],['One size'],['accessories','summer'],28,0],
];
function seedProducts() {
  const count = db.prepare('SELECT COUNT(*) AS count FROM products').get().count;
  if (count) return;
  const insert = db.prepare(`INSERT INTO products (id,slug,name,category,price_jmd,compare_at_jmd,description,image_url,image_alt,colors_json,sizes_json,tags_json,stock,featured)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  runTransaction(() => {
    for (const item of seedItems) {
      const [slug,name,category,price,compareAt,description,imageUrl,imageAlt,colors,sizes,tags,stock,featured] = item;
      insert.run(id(), slug, name, category, price, compareAt || null, description, imageUrl, imageAlt, JSON.stringify(colors), JSON.stringify(sizes), JSON.stringify(tags), stock, featured);
    }
  });
}
seedProducts();
function fetchProducts(url, includeInactive = false) {
  const query = cleanText(url.searchParams.get('q'), 100).toLowerCase();
  const category = cleanText(url.searchParams.get('category'), 60);
  const tag = cleanText(url.searchParams.get('tag'), 40).toLowerCase();
  const sort = cleanText(url.searchParams.get('sort'), 20);
  const min = Math.max(0, Number(url.searchParams.get('min') || 0));
  const max = Number(url.searchParams.get('max') || Number.MAX_SAFE_INTEGER);
  let sql = 'SELECT * FROM products WHERE 1=1';
  const args = [];
  if (!includeInactive) sql += ' AND active=1';
  if (category && category !== 'All') { sql += ' AND category=?'; args.push(category); }
  if (Number.isFinite(min)) { sql += ' AND price_jmd>=?'; args.push(min); }
  if (Number.isFinite(max)) { sql += ' AND price_jmd<=?'; args.push(max); }
  sql += ' ORDER BY featured DESC, created_at DESC, name ASC';
  let items = db.prepare(sql).all(...args).map(productFromRow);
  if (query) items = items.filter(p => `${p.name} ${p.category} ${p.description} ${p.tags.join(' ')}`.toLowerCase().includes(query));
  if (tag) items = items.filter(p => p.tags.some(t => t.toLowerCase() === tag));
  if (sort === 'price-low') items.sort((a,b) => a.priceJmd-b.priceJmd);
  else if (sort === 'price-high') items.sort((a,b) => b.priceJmd-a.priceJmd);
  else if (sort === 'newest') items.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  else if (sort === 'sale') items = items.filter(p => p.compareAtJmd && p.compareAtJmd > p.priceJmd);
  return items;
}
function findProduct(key) { return productFromRow(db.prepare('SELECT * FROM products WHERE id=? OR slug=?').get(key, key)); }
function customerOrder(orderId, email) {
  return db.prepare(`SELECT * FROM orders WHERE (order_code=? OR id=?) AND lower(customer_email)=lower(?)`).get(orderId, orderId, email);
}
function buildOrderDetails(order) {
  const items = db.prepare('SELECT product_id AS productId, product_name AS name, product_image_url AS imageUrl, unit_price_jmd AS unitPriceJmd, quantity, selected_size AS size, selected_color AS color FROM order_items WHERE order_id=?').all(order.id);
  return {
    orderCode: order.order_code, orderStatus: order.order_status, paymentStatus: order.payment_status,
    subtotalJmd: order.subtotal_jmd, shippingJmd: order.shipping_jmd, totalJmd: order.total_jmd,
    createdAt: order.created_at, items,
  };
}
function releaseOrderInventory(orderId, nextStatus, paymentStatus = null) {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  if (!order || order.inventory_released || order.order_status === 'delivered') return false;
  runTransaction(() => {
    const current = db.prepare('SELECT inventory_released FROM orders WHERE id=?').get(orderId);
    if (!current || current.inventory_released) return;
    const items = db.prepare('SELECT product_id, quantity FROM order_items WHERE order_id=?').all(orderId);
    const restore = db.prepare('UPDATE products SET stock=stock+? WHERE id=?');
    for (const item of items) restore.run(item.quantity, item.product_id);
    db.prepare(`UPDATE orders SET order_status=?,payment_status=COALESCE(?,payment_status),inventory_released=1,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(nextStatus, paymentStatus, orderId);
  });
  return true;
}
function expireUnpaidPaypalOrders() {
  const expired = db.prepare(`SELECT id FROM orders WHERE payment_method='paypal' AND payment_status='pending' AND order_status='awaiting_payment' AND inventory_released=0 AND datetime(created_at)<datetime('now','-30 minutes')`).all();
  for (const order of expired) releaseOrderInventory(order.id, 'payment_expired', 'unpaid');
}

function validateCheckout(body) {
  const name = cleanText(body.name, 100);
  const email = cleanText(body.email, 254).toLowerCase();
  const phone = cleanText(body.phone, 40);
  const address = cleanText(body.address, 200);
  const parish = cleanText(body.parish, 70);
  const postalCode = cleanText(body.postalCode, 30);
  const notes = cleanText(body.notes, 500);
  if (name.length < 2) throw Object.assign(new Error('Enter your full name.'), { statusCode: 400 });
  if (!isEmail(email)) throw Object.assign(new Error('Enter a valid email address.'), { statusCode: 400 });
  if (phone.length < 7) throw Object.assign(new Error('Enter a valid contact number.'), { statusCode: 400 });
  if (address.length < 5) throw Object.assign(new Error('Enter a complete delivery address.'), { statusCode: 400 });
  if (!VALID_PARISHES.has(parish)) throw Object.assign(new Error('Choose a valid Jamaican parish.'), { statusCode: 400 });
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50) throw Object.assign(new Error('Your cart is empty or contains too many line items.'), { statusCode: 400 });
  const items = [];
  const seen = new Set();
  for (const candidate of body.items) {
    const key = cleanText(candidate?.productId, 100);
    const product = findProduct(key);
    const quantity = intIn(candidate?.quantity, 1, 20, 0);
    if (!product || !product.active) throw Object.assign(new Error('A product in your cart is no longer available. Refresh your cart and try again.'), { statusCode: 400 });
    if (!quantity) throw Object.assign(new Error('Each item quantity must be between 1 and 20.'), { statusCode: 400 });
    if (product.stock < quantity) throw Object.assign(new Error(`${product.name} has only ${product.stock} left in stock.`), { statusCode: 409 });
    const size = cleanText(candidate?.size, 40);
    const color = cleanText(candidate?.color, 40);
    if (product.sizes.length && !product.sizes.includes(size)) throw Object.assign(new Error(`Choose a valid size for ${product.name}.`), { statusCode: 400 });
    if (product.colors.length && !product.colors.includes(color)) throw Object.assign(new Error(`Choose a valid colour for ${product.name}.`), { statusCode: 400 });
    const fingerprint = `${product.id}|${size}|${color}`;
    if (seen.has(fingerprint)) throw Object.assign(new Error('Combine duplicate product options into one cart line.'), { statusCode: 400 });
    seen.add(fingerprint);
    items.push({ product, quantity, size, color, lineJmd: product.priceJmd * quantity });
  }
  const subtotalJmd = items.reduce((sum, item) => sum + item.lineJmd, 0);
  const shippingJmd = subtotalJmd >= FREE_SHIPPING_THRESHOLD_JMD ? 0 : SHIPPING_FEE_JMD;
  return { name, email, phone, address, parish, postalCode, notes, items, subtotalJmd, shippingJmd, totalJmd: subtotalJmd + shippingJmd };
}
function createOrder(orderData, customer, paymentMethod, paymentStatus = 'unpaid', orderStatus = 'placed') {
  const orderId = id();
  let code = orderCode();
  while (db.prepare('SELECT 1 FROM orders WHERE order_code=?').get(code)) code = orderCode();
  const insertOrder = db.prepare(`INSERT INTO orders (id,order_code,customer_id,customer_name,customer_email,phone,address_line,parish,postal_code,delivery_notes,subtotal_jmd,shipping_jmd,total_jmd,payment_method,payment_status,order_status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertItem = db.prepare(`INSERT INTO order_items (id,order_id,product_id,product_name,product_image_url,unit_price_jmd,quantity,selected_size,selected_color) VALUES (?,?,?,?,?,?,?,?,?)`);
  const reduceStock = db.prepare('UPDATE products SET stock=stock-? WHERE id=? AND stock>=?');
  runTransaction(() => {
    insertOrder.run(orderId, code, customer?.id || null, orderData.name, orderData.email, orderData.phone, orderData.address, orderData.parish, orderData.postalCode, orderData.notes, orderData.subtotalJmd, orderData.shippingJmd, orderData.totalJmd, paymentMethod, paymentStatus, orderStatus);
    for (const item of orderData.items) {
      insertItem.run(id(), orderId, item.product.id, item.product.name, item.product.imageUrl, item.product.priceJmd, item.quantity, item.size, item.color);
      const changed = reduceStock.run(item.quantity, item.product.id, item.quantity).changes;
      if (!changed) throw Object.assign(new Error(`${item.product.name} just sold out. Please refresh your cart.`), { statusCode: 409 });
    }
  });
  return db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
}

async function paypalAccessToken() {
  const credentials = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const response = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: 'POST', headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials', signal: AbortSignal.timeout(12000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.access_token) throw new Error('PayPal could not authorize the payment. Check the configured PayPal credentials.');
  return result.access_token;
}
async function paypalRequest(route, method, token, data) {
  const response = await fetch(`${PAYPAL_BASE_URL}${route}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': crypto.randomUUID() },
    body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(cleanText(result.message || result.error_description || 'PayPal rejected the request.', 250));
  return result;
}

async function handleApi(req, res, url) {
  const method = req.method || 'GET';
  const pathname = url.pathname;
  expireUnpaidPaypalOrders();
  if (method === 'GET' && pathname === '/api/health') {
    return json(res, 200, { status: 'ok', service: 'creator-hub-fashion', database: 'sqlite', paypalEnabled, timestamp: new Date().toISOString() });
  }
  if (method === 'GET' && pathname === '/api/config') {
    return json(res, 200, { storeName: STORE_NAME, currency: 'JMD', shippingFeeJmd: SHIPPING_FEE_JMD, freeShippingThresholdJmd: FREE_SHIPPING_THRESHOLD_JMD, paypalEnabled, paypalClientId: paypalEnabled ? process.env.PAYPAL_CLIENT_ID : null });
  }
  if (method === 'GET' && pathname === '/api/products') {
    const products = fetchProducts(url);
    return json(res, 200, { products, total: products.length, categories: [...new Set(db.prepare('SELECT category FROM products WHERE active=1 ORDER BY category').all().map(r => r.category))] });
  }
  if (method === 'GET' && pathname.startsWith('/api/products/')) {
    const product = findProduct(decodeURIComponent(pathname.slice('/api/products/'.length)));
    return product && product.active ? json(res, 200, { product }) : fail(res, 404, 'Product not found.');
  }
  if (method === 'POST' && pathname === '/api/auth/register') {
    if (!rateLimit(req, res, 'register', 8)) return;
    const body = await readBody(req);
    const name = cleanText(body.name, 100);
    const email = cleanText(body.email, 254).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    if (name.length < 2) return fail(res, 400, 'Enter your name.');
    if (!isEmail(email)) return fail(res, 400, 'Enter a valid email address.');
    if (password.length < 12 || password.length > 200) return fail(res, 400, 'Use a password between 12 and 200 characters.');
    if (db.prepare('SELECT 1 FROM customers WHERE email=?').get(email)) return fail(res, 409, 'An account with this email already exists.');
    const { salt, hash } = newPassword(password);
    const customer = { id: id(), name, email, role: 'customer' };
    db.prepare('INSERT INTO customers (id,name,email,password_hash,password_salt) VALUES (?,?,?,?,?)').run(customer.id, name, email, hash, salt);
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions (token_hash,customer_id,expires_at) VALUES (?,?,?)').run(sha256(token), customer.id, nowSeconds() + SESSION_TTL_SECONDS);
    return json(res, 201, { customer: publicCustomer(customer) }, { 'Set-Cookie': sessionCookie(token) });
  }
  if (method === 'POST' && pathname === '/api/auth/login') {
    if (!rateLimit(req, res, 'login', 10)) return;
    const body = await readBody(req);
    const email = cleanText(body.email, 254).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const row = db.prepare('SELECT * FROM customers WHERE email=?').get(email);
    if (!row || !verifyPassword(password, row.password_salt, row.password_hash)) return fail(res, 401, 'Email or password is incorrect.');
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions (token_hash,customer_id,expires_at) VALUES (?,?,?)').run(sha256(token), row.id, nowSeconds() + SESSION_TTL_SECONDS);
    return json(res, 200, { customer: publicCustomer(row) }, { 'Set-Cookie': sessionCookie(token) });
  }
  if (method === 'GET' && pathname === '/api/auth/me') return json(res, 200, { customer: getSession(req) });
  if (method === 'POST' && pathname === '/api/auth/logout') {
    const token = getCookies(req)[COOKIE_NAME];
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(token));
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }
  if (method === 'GET' && pathname === '/api/wishlist') {
    const customer = requireCustomer(req, res); if (!customer) return;
    const products = db.prepare('SELECT p.* FROM wishlist_items w JOIN products p ON p.id=w.product_id WHERE w.customer_id=? AND p.active=1 ORDER BY w.created_at DESC').all(customer.id).map(productFromRow);
    return json(res, 200, { products });
  }
  if (method === 'POST' && pathname.startsWith('/api/wishlist/')) {
    const customer = requireCustomer(req, res); if (!customer) return;
    const product = findProduct(decodeURIComponent(pathname.slice('/api/wishlist/'.length)));
    if (!product || !product.active) return fail(res, 404, 'Product not found.');
    const existing = db.prepare('SELECT 1 FROM wishlist_items WHERE customer_id=? AND product_id=?').get(customer.id, product.id);
    if (existing) db.prepare('DELETE FROM wishlist_items WHERE customer_id=? AND product_id=?').run(customer.id, product.id);
    else db.prepare('INSERT INTO wishlist_items (customer_id,product_id) VALUES (?,?)').run(customer.id, product.id);
    return json(res, 200, { saved: !existing });
  }
  if (method === 'POST' && pathname === '/api/orders') {
    if (!rateLimit(req, res, 'checkout', 10, 10 * 60 * 1000)) return;
    const body = await readBody(req);
    const orderData = validateCheckout(body);
    const paymentMethod = cleanText(body.paymentMethod, 40);
    if (paymentMethod !== 'cash_on_delivery') return fail(res, 400, 'Choose an available payment method. PayPal checkout is handled by the PayPal button.');
    const customer = getSession(req);
    const order = createOrder(orderData, customer, 'cash_on_delivery', 'unpaid', 'placed');
    return json(res, 201, { order: buildOrderDetails(order), message: 'Your order request has been received. Payment is due on delivery; this is not a card or PayPal payment.' });
  }
  if (method === 'POST' && pathname === '/api/payments/paypal/create') {
    if (!rateLimit(req, res, 'paypal-create', 10, 10 * 60 * 1000)) return;
    if (!paypalEnabled) return fail(res, 503, 'PayPal is not configured yet. Set the PayPal credentials and a verified JMD_PER_USD conversion rate.');
    const body = await readBody(req);
    const orderData = validateCheckout(body);
    const customer = getSession(req);
    const order = createOrder(orderData, customer, 'paypal', 'pending', 'awaiting_payment');
    try {
      const accessToken = await paypalAccessToken();
      const usdAmount = (order.total_jmd / Number(process.env.JMD_PER_USD)).toFixed(2);
      const paypalOrder = await paypalRequest('/v2/checkout/orders', 'POST', accessToken, {
        intent: 'CAPTURE', purchase_units: [{ reference_id: order.id, custom_id: order.order_code, description: `${STORE_NAME} order ${order.order_code}`,
          amount: { currency_code: PAYPAL_CURRENCY, value: usdAmount } }],
        application_context: { brand_name: STORE_NAME, shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' },
      });
      db.prepare('UPDATE orders SET paypal_order_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(paypalOrder.id, order.id);
      return json(res, 201, { paypalOrderId: paypalOrder.id, orderCode: order.order_code, amount: usdAmount, currency: PAYPAL_CURRENCY });
    } catch (error) {
      releaseOrderInventory(order.id, 'payment_setup_failed', 'unpaid');
      return fail(res, 502, `Could not start PayPal checkout: ${cleanText(error.message, 240)}`, { orderCode: order.order_code });
    }
  }
  if (method === 'POST' && pathname === '/api/payments/paypal/capture') {
    if (!paypalEnabled) return fail(res, 503, 'PayPal is not configured yet.');
    const body = await readBody(req);
    const paypalOrderId = cleanText(body.paypalOrderId, 100);
    const code = cleanText(body.orderCode, 30);
    const order = db.prepare('SELECT * FROM orders WHERE order_code=? AND paypal_order_id=?').get(code, paypalOrderId);
    if (!order) return fail(res, 404, 'PayPal order was not found.');
    if (order.payment_status === 'paid') return json(res, 200, { order: buildOrderDetails(order), message: 'This order is already marked as paid.' });
    if (order.inventory_released || order.order_status !== 'awaiting_payment') return fail(res, 409, 'This PayPal order is no longer active. Start a new checkout.');
    try {
      const accessToken = await paypalAccessToken();
      const captured = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, 'POST', accessToken, {});
      const purchase = captured.purchase_units?.[0];
      const capture = purchase?.payments?.captures?.[0];
      const expectedAmount = (order.total_jmd / Number(process.env.JMD_PER_USD)).toFixed(2);
      if (captured.status !== 'COMPLETED' || capture?.status !== 'COMPLETED' || purchase?.custom_id !== order.order_code || capture?.amount?.currency_code !== PAYPAL_CURRENCY || Number(capture?.amount?.value) !== Number(expectedAmount)) {
        return fail(res, 409, 'PayPal did not return a completed payment matching this order. Contact support before retrying.');
      }
      db.prepare("UPDATE orders SET payment_status='paid',order_status='processing',paypal_capture_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(capture.id || null, order.id);
      const updated = db.prepare('SELECT * FROM orders WHERE id=?').get(order.id);
      return json(res, 200, { order: buildOrderDetails(updated), message: 'PayPal confirmed the payment.' });
    } catch (error) {
      return fail(res, 502, `PayPal could not confirm the payment: ${cleanText(error.message, 220)}`);
    }
  }
  if (method === 'GET' && pathname === '/api/track') {
    if (!rateLimit(req, res, 'track-order', 20, 10 * 60 * 1000)) return;
    const code = cleanText(url.searchParams.get('code'), 40).toUpperCase();
    const email = cleanText(url.searchParams.get('email'), 254).toLowerCase();
    if (!code || !isEmail(email)) return fail(res, 400, 'Enter your order code and the email used at checkout.');
    const order = customerOrder(code, email);
    if (!order) return fail(res, 404, 'No order matched that code and email.');
    return json(res, 200, { order: buildOrderDetails(order) });
  }
  if (method === 'GET' && pathname === '/api/account/orders') {
    const customer = requireCustomer(req, res); if (!customer) return;
    const orders = db.prepare('SELECT * FROM orders WHERE customer_id=? ORDER BY created_at DESC LIMIT 100').all(customer.id).map(order => ({ ...buildOrderDetails(order), customerName: order.customer_name }));
    return json(res, 200, { orders });
  }
  if (method === 'GET' && pathname === '/api/admin/summary') {
    const customer = requireCustomer(req, res, 'admin'); if (!customer) return;
    const summary = db.prepare(`SELECT COUNT(*) AS orders, COALESCE(SUM(CASE WHEN payment_status='paid' THEN total_jmd ELSE 0 END),0) AS paidRevenueJmd,
      SUM(CASE WHEN order_status IN ('placed','awaiting_payment','processing') THEN 1 ELSE 0 END) AS openOrders FROM orders`).get();
    const products = db.prepare('SELECT * FROM products ORDER BY created_at DESC').all().map(productFromRow);
    const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 100').all().map(row => ({ ...buildOrderDetails(row), customerName: row.customer_name, customerEmail: row.customer_email, phone: row.phone, address: row.address_line, parish: row.parish, paymentMethod: row.payment_method }));
    return json(res, 200, { summary, products, orders });
  }
  if (method === 'POST' && pathname === '/api/admin/products') {
    const customer = requireCustomer(req, res, 'admin'); if (!customer) return;
    const body = await readBody(req);
    const p = validateAdminProduct(body);
    const productId = id();
    const slug = `${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)}-${crypto.randomBytes(2).toString('hex')}`;
    db.prepare(`INSERT INTO products (id,slug,name,category,price_jmd,compare_at_jmd,description,image_url,image_alt,colors_json,sizes_json,tags_json,stock,featured,active)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(productId, slug, p.name, p.category, p.priceJmd, p.compareAtJmd || null, p.description, p.imageUrl, p.imageAlt || p.name, JSON.stringify(p.colors), JSON.stringify(p.sizes), JSON.stringify(p.tags), p.stock, p.featured ? 1 : 0, p.active ? 1 : 0);
    return json(res, 201, { product: findProduct(productId) });
  }
  const productAdminMatch = pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
  if (method === 'PATCH' && productAdminMatch) {
    const customer = requireCustomer(req, res, 'admin'); if (!customer) return;
    const target = findProduct(decodeURIComponent(productAdminMatch[1]));
    if (!target) return fail(res, 404, 'Product not found.');
    const body = await readBody(req);
    const currentRow = db.prepare('SELECT * FROM products WHERE id=?').get(target.id);
    const merged = {
      name: body.name ?? currentRow.name, category: body.category ?? currentRow.category,
      priceJmd: body.priceJmd ?? currentRow.price_jmd, compareAtJmd: body.compareAtJmd ?? currentRow.compare_at_jmd,
      description: body.description ?? currentRow.description, imageUrl: body.imageUrl ?? currentRow.image_url,
      imageAlt: body.imageAlt ?? currentRow.image_alt, colors: body.colors ?? parseJsonArray(currentRow.colors_json),
      sizes: body.sizes ?? parseJsonArray(currentRow.sizes_json), tags: body.tags ?? parseJsonArray(currentRow.tags_json),
      stock: body.stock ?? currentRow.stock, featured: body.featured ?? Boolean(currentRow.featured), active: body.active ?? Boolean(currentRow.active),
    };
    const p = validateAdminProduct(merged);
    db.prepare(`UPDATE products SET name=?,category=?,price_jmd=?,compare_at_jmd=?,description=?,image_url=?,image_alt=?,colors_json=?,sizes_json=?,tags_json=?,stock=?,featured=?,active=? WHERE id=?`)
      .run(p.name,p.category,p.priceJmd,p.compareAtJmd || null,p.description,p.imageUrl,p.imageAlt,JSON.stringify(p.colors),JSON.stringify(p.sizes),JSON.stringify(p.tags),p.stock,p.featured ? 1 : 0,p.active ? 1 : 0,target.id);
    return json(res, 200, { product: findProduct(target.id) });
  }
  const orderAdminMatch = pathname.match(/^\/api\/admin\/orders\/([^/]+)$/);
  if (method === 'PATCH' && orderAdminMatch) {
    const customer = requireCustomer(req, res, 'admin'); if (!customer) return;
    const order = db.prepare('SELECT * FROM orders WHERE order_code=? OR id=?').get(decodeURIComponent(orderAdminMatch[1]), decodeURIComponent(orderAdminMatch[1]));
    if (!order) return fail(res, 404, 'Order not found.');
    const body = await readBody(req);
    const allowed = ['placed','processing','shipped','delivered','cancelled','payment_expired','payment_setup_failed'];
    const next = cleanText(body.orderStatus, 30);
    if (!allowed.includes(next)) return fail(res, 400, 'Unsupported order status.');
    if (['cancelled','payment_expired','payment_setup_failed','delivered'].includes(order.order_status) && next !== order.order_status) return fail(res, 409, 'This order is in a final state and cannot be reopened here.');
    if (order.payment_status === 'paid' && next === 'cancelled') return fail(res, 409, 'Paid orders must be refunded through the payment provider before cancellation.');
    if (next === 'cancelled' && order.order_status !== 'cancelled' && !order.inventory_released) {
      releaseOrderInventory(order.id, 'cancelled');
    } else {
      db.prepare('UPDATE orders SET order_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(next, order.id);
    }
    return json(res, 200, { order: buildOrderDetails(db.prepare('SELECT * FROM orders WHERE id=?').get(order.id)) });
  }
  return fail(res, 404, 'API route not found.');
}
function validateAdminProduct(body) {
  const name = cleanText(body.name, 120);
  const category = cleanText(body.category, 60);
  const description = cleanText(body.description, 1000);
  const imageUrl = cleanText(body.imageUrl, 500);
  const imageAlt = cleanText(body.imageAlt || name, 150);
  const priceJmd = Number(body.priceJmd);
  const compareAtJmd = body.compareAtJmd == null || body.compareAtJmd === '' ? null : Number(body.compareAtJmd);
  const stock = Number(body.stock);
  const colors = Array.isArray(body.colors) ? body.colors.map(x => cleanText(x, 40)).filter(Boolean).slice(0, 20) : [];
  const sizes = Array.isArray(body.sizes) ? body.sizes.map(x => cleanText(x, 40)).filter(Boolean).slice(0, 20) : [];
  const tags = Array.isArray(body.tags) ? body.tags.map(x => cleanText(x, 40)).filter(Boolean).slice(0, 20) : [];
  if (name.length < 2 || !category || description.length < 5) throw Object.assign(new Error('Enter a product name, category and description.'), { statusCode: 400 });
  if (!Number.isSafeInteger(priceJmd) || priceJmd < 0 || (compareAtJmd !== null && (!Number.isSafeInteger(compareAtJmd) || compareAtJmd < priceJmd)) || !Number.isSafeInteger(stock) || stock < 0 || stock > 100000) throw Object.assign(new Error('Enter valid JMD prices and stock quantity.'), { statusCode: 400 });
  if (!/^https:\/\//i.test(imageUrl)) throw Object.assign(new Error('Product image must use a secure HTTPS URL.'), { statusCode: 400 });
  return { name, category, priceJmd, compareAtJmd, description, imageUrl, imageAlt, colors, sizes, tags, stock, featured: Boolean(body.featured), active: body.active === undefined ? true : Boolean(body.active) };
}

async function router(req, res) {
  const securityHeaders = {
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' https://www.paypal.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://images.unsplash.com https://*.paypal.com; connect-src 'self' https://api-m.sandbox.paypal.com https://api-m.paypal.com https://www.paypal.com https://www.sandbox.paypal.com; frame-src https://www.paypal.com https://www.sandbox.paypal.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self' https://www.paypal.com https://www.sandbox.paypal.com",
  };
  for (const [key, value] of Object.entries(securityHeaders)) res.setHeader(key, value);
  if (req.method === 'OPTIONS') { res.writeHead(204, { Allow: 'GET, POST, PATCH, HEAD, OPTIONS' }); return res.end(); }
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
  catch { return fail(res, 400, 'Invalid URL.'); }
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (!['GET','HEAD'].includes(req.method || 'GET')) return fail(res, 405, 'Method not allowed.');
    let requestPath = decodeURIComponent(url.pathname);
    if (requestPath === '/') requestPath = '/index.html';
    const filePath = path.resolve(PUBLIC_DIR, `.${requestPath}`);
    if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`) && filePath !== path.join(PUBLIC_DIR, 'index.html')) return fail(res, 403, 'Forbidden.');
    let finalPath = filePath;
    if (!fs.existsSync(finalPath) || !fs.statSync(finalPath).isFile()) return fail(res, 404, 'Page not found.');
    const stat = fs.statSync(finalPath);
    res.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(finalPath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': finalPath.endsWith('.html') ? 'no-cache' : 'public, max-age=3600',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(finalPath).pipe(res);
  } catch (error) {
    if (!res.headersSent) fail(res, error.statusCode || 500, error.statusCode ? error.message : 'The server could not complete that request.');
    else res.end();
    if ((error.statusCode || 500) >= 500) console.error(`[${new Date().toISOString()}]`, error);
  }
}

if (require.main === module && process.argv[2] !== 'make-admin') {
  const server = http.createServer((req, res) => { void router(req, res); });
  server.listen(PORT, '0.0.0.0', () => console.log(`${STORE_NAME} running at http://localhost:${PORT} (database: ${DB_PATH})`));
  const shutdown = () => { server.close(() => { try { db.close(); } finally { process.exit(0); } }); setTimeout(() => process.exit(1), 5000).unref(); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}

if (process.argv[2] === 'make-admin') {
  const email = cleanText(process.argv[3], 254).toLowerCase();
  if (!isEmail(email)) { console.error('Usage: npm run make-admin -- customer@example.com'); process.exitCode = 1; }
  else {
    const result = db.prepare("UPDATE customers SET role='admin' WHERE lower(email)=lower(?)").run(email);
    if (!result.changes) { console.error('No customer with that email exists yet. Register in the storefront first.'); process.exitCode = 1; }
    else console.log(`Administrator role granted to ${email}.`);
  }
  db.close();
}

module.exports = { router, db, validateCheckout, validateAdminProduct, fetchProducts, createOrder };
