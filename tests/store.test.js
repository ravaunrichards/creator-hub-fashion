'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

let tempDir;
let server;
let baseUrl;
let db;
let customerCookie;
let customerEmail;
let product;
let submittedOrder;
let handle;

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'creator-hub-fashion-test-'));
  process.env.DATABASE_PATH = path.join(tempDir, 'test.sqlite');
  delete process.env.PAYPAL_CLIENT_ID;
  delete process.env.PAYPAL_CLIENT_SECRET;
  delete process.env.JMD_PER_USD;
  ({ router: handle, db } = require('../server'));
  server = http.createServer((req, res) => { void handle(req, res); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (db) db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function request(route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(customerCookie ? { Cookie: customerCookie } : {}), ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json();
  return { response, payload };
}

test('health and catalogue APIs return seeded store data', async () => {
  const health = await request('/api/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.payload.status, 'ok');
  assert.equal(health.payload.database, 'sqlite');
  const catalogue = await request('/api/products');
  assert.equal(catalogue.response.status, 200);
  assert.ok(catalogue.payload.products.length >= 15);
  assert.ok(catalogue.payload.categories.includes('Dresses'));
  product = catalogue.payload.products.find(item => item.sizes.includes('M') && item.colors.includes('Cream') && item.stock > 1);
  assert.ok(product, 'a seeded product with size and colour variants exists');
  const filtered = await request('/api/products?category=Tops');
  assert.ok(filtered.payload.products.length > 0);
  assert.ok(filtered.payload.products.every(item => item.category === 'Tops'));
  const searched = await request('/api/products?q=linen');
  assert.ok(searched.payload.products.some(item => item.name.toLowerCase().includes('linen')));
});

test('registration creates a session and wishlist is account-bound', async () => {
  customerEmail = `shopper-${Date.now()}@example.test`;
  const registration = await request('/api/auth/register', {
    method: 'POST', body: JSON.stringify({ name: 'Fashion Shopper', email: customerEmail, password: 'Test-Only-Password-127!' }),
  });
  assert.equal(registration.response.status, 201);
  assert.equal(registration.payload.customer.role, 'customer');
  const setCookie = registration.response.headers.get('set-cookie');
  assert.ok(setCookie && setCookie.includes('chf_session='));
  customerCookie = setCookie.split(';')[0];
  const me = await request('/api/auth/me');
  assert.equal(me.payload.customer.email, customerEmail);
  const saved = await request(`/api/wishlist/${encodeURIComponent(product.id)}`, { method: 'POST', body: '{}' });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.payload.saved, true);
  const wishlist = await request('/api/wishlist');
  assert.ok(wishlist.payload.products.some(item => item.id === product.id));
  const admin = await request('/api/admin/summary');
  assert.equal(admin.response.status, 403);
});

test('server validates checkout and persists a real order for tracking', async () => {
  const invalid = await request('/api/orders', {
    method: 'POST', body: JSON.stringify({ name: 'Shopper Test', email: customerEmail, phone: '8765551234', address: '12 Garden Road', parish: 'Saint Catherine', items: [], paymentMethod: 'cash_on_delivery' }),
  });
  assert.equal(invalid.response.status, 400);
  const badParish = await request('/api/orders', {
    method: 'POST', body: JSON.stringify({ name: 'Shopper Test', email: customerEmail, phone: '8765551234', address: '12 Garden Road', parish: 'Fake Parish', items: [{ productId: product.id, size: 'M', color: 'Cream', quantity: 1 }], paymentMethod: 'cash_on_delivery' }),
  });
  assert.equal(badParish.response.status, 400);
  const body = {
    name: 'Fashion Shopper', email: customerEmail, phone: '876-555-1212',
    address: '12 Garden Road, Spanish Town', parish: 'Saint Catherine', postalCode: '', notes: '',
    paymentMethod: 'cash_on_delivery', items: [{ productId: product.id, size: 'M', color: 'Cream', quantity: 1 }],
  };
  const result = await request('/api/orders', { method: 'POST', body: JSON.stringify(body) });
  assert.equal(result.response.status, 201);
  assert.match(result.payload.order.orderCode, /^CHF-[A-F0-9]{8}$/);
  assert.equal(result.payload.order.paymentStatus, 'unpaid');
  assert.equal(result.payload.order.orderStatus, 'placed');
  assert.equal(result.payload.order.subtotalJmd, product.priceJmd);
  assert.equal(result.payload.order.shippingJmd, product.priceJmd >= 10000 ? 0 : 500);
  submittedOrder = result.payload.order;
  const tracked = await request(`/api/track?code=${encodeURIComponent(submittedOrder.orderCode)}&email=${encodeURIComponent(customerEmail)}`);
  assert.equal(tracked.response.status, 200);
  assert.equal(tracked.payload.order.orderCode, submittedOrder.orderCode);
  const wrongEmail = await request(`/api/track?code=${encodeURIComponent(submittedOrder.orderCode)}&email=wrong@example.test`);
  assert.equal(wrongEmail.response.status, 404);
  const accountOrders = await request('/api/account/orders');
  assert.equal(accountOrders.response.status, 200);
  assert.ok(accountOrders.payload.orders.some(order => order.orderCode === submittedOrder.orderCode));
});

test('PayPal cannot report payment when not configured; static storefront is served', async () => {
  const pay = await request('/api/payments/paypal/create', { method:'POST', body:JSON.stringify({}) });
  assert.equal(pay.response.status, 503);
  const home = await fetch(`${baseUrl}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Creator Hub Fashion/);
  const js = await fetch(`${baseUrl}/app.js`);
  assert.equal(js.status, 200);
  assert.match(await js.text(), /function checkoutData/);
});

test('administrator can manage products and cancellation releases held inventory once', async () => {
  db.prepare("UPDATE customers SET role='admin' WHERE lower(email)=lower(?)").run(customerEmail);
  const summary = await request('/api/admin/summary');
  assert.equal(summary.response.status, 200);
  assert.ok(summary.payload.products.length >= 15);
  assert.ok(summary.payload.orders.some(order => order.orderCode === submittedOrder.orderCode));
  const before = db.prepare('SELECT stock FROM products WHERE id=?').get(product.id).stock;
  const cancelled = await request(`/api/admin/orders/${encodeURIComponent(submittedOrder.orderCode)}`, { method:'PATCH', body:JSON.stringify({ orderStatus:'cancelled' }) });
  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.payload.order.orderStatus, 'cancelled');
  assert.equal(db.prepare('SELECT inventory_released FROM orders WHERE order_code=?').get(submittedOrder.orderCode).inventory_released, 1);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id=?').get(product.id).stock, before + 1);
  const reopened = await request(`/api/admin/orders/${encodeURIComponent(submittedOrder.orderCode)}`, { method:'PATCH', body:JSON.stringify({ orderStatus:'processing' }) });
  assert.equal(reopened.response.status, 409);
  const patch = await request(`/api/admin/products/${encodeURIComponent(product.id)}`, { method:'PATCH', body:JSON.stringify({ priceJmd:product.priceJmd, stock:before+1, active:true }) });
  assert.equal(patch.response.status, 200);
  assert.equal(patch.payload.product.priceJmd, product.priceJmd);
});
