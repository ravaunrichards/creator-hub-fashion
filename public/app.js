'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = {
  products: [], categories: [], user: null, wishlist: new Set(), cart: [], config: null,
  search: '', category: 'All', tag: '', min: '', max: '', sort: 'featured',
  currentProduct: null, currentAuthMode: 'login', activeAdminTab: 'orders', lastOrder: null, paypalScriptLoading: false,
};
const PARISHES = ['Clarendon','Hanover','Kingston','Manchester','Portland','Saint Andrew','Saint Ann','Saint Catherine','Saint Elizabeth','Saint James','Saint Mary','Saint Thomas','Trelawny','Westmoreland'];
const money = value => `JMD $${Math.max(0, Number(value) || 0).toLocaleString('en-JM', { maximumFractionDigits: 0 })}`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const slugColor = color => ({black:'#211f20',white:'#fffdfa',cream:'#f2e9dc',oat:'#cdbda9',sage:'#8e9b7a',wine:'#793a4b',blue:'#7d9ebc',red:'#b84643',tan:'#b98f68',gold:'#c6a45e',silver:'#c3c7cb',olive:'#747c4b',grey:'#858585',gray:'#858585',rose:'#dba5ad',lilac:'#b6a5d1',emerald:'#1e6652',indigo:'#394d78',plaid:'#8b7969','light blue':'#a6c4db','dark wash':'#39455a','tortoise':'#806348','stone':'#bfb5a5','sand':'#dac8b2','taupe':'#9d8a7d','brown':'#6c4b39','natural':'#d1bf9f'})[String(color).toLowerCase()] || '#d6c9c0';
let currentModal = null;
let overlayCloseCallback = null;

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
    ...options,
  });
  let payload = {};
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status}).`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}
function toast(message, type = 'info') {
  const root = $('#toastRegion');
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = message;
  root.append(item);
  window.setTimeout(() => { item.style.opacity = '0'; item.style.transform = 'translateY(8px)'; window.setTimeout(() => item.remove(), 230); }, 3500);
}
function setButtonBusy(button, busy, text) {
  if (!button) return;
  if (busy) { button.dataset.originalText = button.textContent; button.disabled = true; button.textContent = text || 'Please wait…'; }
  else { button.disabled = false; if (button.dataset.originalText) button.textContent = button.dataset.originalText; delete button.dataset.originalText; }
}
function overlayShow(onClick) {
  const overlay = $('#overlay');
  overlay.classList.remove('hidden');
  requestAnimationFrame(() => overlay.classList.add('visible'));
  document.body.classList.add('no-scroll');
  overlayCloseCallback = onClick || closePanels;
}
function overlayHide() {
  const overlay = $('#overlay');
  overlay.classList.remove('visible');
  window.setTimeout(() => overlay.classList.add('hidden'), 210);
  document.body.classList.remove('no-scroll');
  overlayCloseCallback = null;
}
function openModal(modal) {
  closeDrawer(false);
  closeMobileMenu(false);
  closeModal(false);
  currentModal = modal;
  modal.classList.remove('hidden');
  overlayShow(() => closeModal());
  requestAnimationFrame(() => modal.classList.add('is-open'));
  const first = modal.querySelector('input:not([type=hidden]),button:not([data-close-modal]),select');
  window.setTimeout(() => first?.focus({ preventScroll: true }), 90);
}
function closeModal(hideOverlay = true) {
  if (currentModal) {
    const modal = currentModal;
    modal.classList.remove('is-open');
    window.setTimeout(() => modal.classList.add('hidden'), 180);
    currentModal = null;
  }
  if (hideOverlay) overlayHide();
}
function openDrawer() {
  closeModal(false);
  closeMobileMenu(false);
  $('#cartDrawer').classList.remove('hidden');
  overlayShow(() => closeDrawer());
  requestAnimationFrame(() => $('#cartDrawer').classList.add('is-open'));
  $('#cartDrawer').setAttribute('aria-hidden', 'false');
  renderCart();
}
function closeDrawer(hideOverlay = true) {
  const drawer = $('#cartDrawer');
  drawer.classList.remove('is-open');
  drawer.setAttribute('aria-hidden', 'true');
  window.setTimeout(() => drawer.classList.add('hidden'), 240);
  if (hideOverlay) overlayHide();
}
function openMobileMenu() {
  closeDrawer(false); closeModal(false);
  let panel = $('#mobileCategoryPanel');
  if (!panel) {
    panel = document.createElement('aside');
    panel.id = 'mobileCategoryPanel';
    panel.className = 'mobile-category-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.innerHTML = `<button class="icon-button close-panel" data-close-mobile aria-label="Close categories" style="float:right">×</button><p class="eyebrow">FIND YOUR FEELING</p><h2>Shop the edit.</h2><div class="mobile-categories">${['All','Dresses','Tops','Bottoms','Sets','Denim','Shoes','Bags','Accessories','Outerwear','Knitwear','Activewear'].map(x => `<button data-category="${esc(x)}">${esc(x === 'All' ? 'All new in' : x)} <span>↗</span></button>`).join('')}<button data-tag="bestseller">Best sellers <span>↗</span></button><button data-sale="true">Sale <span>↗</span></button></div>`;
    document.body.append(panel);
  }
  panel.classList.remove('hidden');
  overlayShow(() => closeMobileMenu());
  requestAnimationFrame(() => panel.classList.add('is-open'));
}
function closeMobileMenu(hideOverlay = true) {
  const panel = $('#mobileCategoryPanel');
  if (panel) { panel.classList.remove('is-open'); window.setTimeout(() => panel.classList.add('hidden'), 210); }
  if (hideOverlay) overlayHide();
}
function closePanels() { closeModal(false); closeDrawer(false); closeMobileMenu(false); overlayHide(); }
function focusProducts() { $('#products').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
function updateActiveNav() {
  $$('.category-nav .nav-link').forEach(link => {
    const cat = link.dataset.category || '';
    const tag = link.dataset.tag || '';
    link.classList.toggle('active', (cat && cat === state.category && !state.tag) || (tag && tag === state.tag) || (link.dataset.sale && state.sort === 'sale'));
  });
}
function setCategory(category) {
  state.category = category || 'All'; state.tag = ''; state.sort = state.sort === 'sale' ? 'featured' : state.sort;
  $('#categoryFilter').value = state.category;
  $('#sortSelect').value = state.sort;
  updateActiveNav(); updateFilterDot(); void loadProducts(); focusProducts();
}
function setTag(tag) {
  state.tag = tag || ''; state.category = 'All';
  $('#categoryFilter').value = 'All'; updateActiveNav(); void loadProducts(); focusProducts();
}
function makeQuery() {
  const params = new URLSearchParams();
  if (state.search) params.set('q', state.search);
  if (state.category && state.category !== 'All') params.set('category', state.category);
  if (state.tag) params.set('tag', state.tag);
  if (state.min !== '') params.set('min', state.min);
  if (state.max !== '') params.set('max', state.max);
  if (state.sort && state.sort !== 'featured') params.set('sort', state.sort);
  return params.toString() ? `?${params}` : '';
}
async function loadProducts() {
  $('#resultsCount').textContent = 'Updating the collection…';
  try {
    const result = await api(`/api/products${makeQuery()}`);
    state.products = result.products || [];
    state.categories = result.categories || [];
    syncCartWithProducts();
    renderProducts(); populateCategories(); updateActiveNav(); updateFilterDot();
  } catch (error) {
    $('#productGrid').innerHTML = `<div class="loading-state"><p>${esc(error.message)} Try reloading the page.</p></div>`;
    $('#resultsCount').textContent = 'Collection unavailable';
  }
}
function populateCategories() {
  const select = $('#categoryFilter');
  const previous = state.category || 'All';
  select.innerHTML = `<option value="All">All categories</option>${state.categories.map(cat => `<option value="${esc(cat)}">${esc(cat)}</option>`).join('')}`;
  select.value = state.categories.includes(previous) ? previous : 'All';
}
function updateFilterDot() {
  const active = state.category !== 'All' || Boolean(state.min) || Boolean(state.max) || state.sort === 'sale';
  $('#filterActiveDot').classList.toggle('hidden', !active);
}
function renderProducts() {
  const grid = $('#productGrid');
  $('#resultsCount').textContent = `${state.products.length} ${state.products.length === 1 ? 'piece' : 'pieces'} to explore`;
  $('#productsTitle').innerHTML = state.tag === 'bestseller' ? 'The <em>most-loved.</em>' : state.sort === 'sale' ? 'Good finds, <em>better prices.</em>' : state.search ? `Results for <em>“${esc(state.search)}”.</em>` : state.category !== 'All' ? `${esc(state.category)} for <em>your edit.</em>` : 'The <em>latest loves.</em>';
  $('#productSubtitle').textContent = state.tag === 'bestseller' ? 'The pieces you keep coming back to.' : state.search ? 'A little closer to what you had in mind.' : 'Easy pieces. Better outfits. Very you.';
  if (!state.products.length) {
    grid.innerHTML = '';
    $('#emptyState').classList.remove('hidden');
    $('#loadMoreButton').classList.add('hidden');
    return;
  }
  $('#emptyState').classList.add('hidden');
  $('#loadMoreButton').classList.remove('hidden');
  $('#loadMoreButton').textContent = 'You’ve seen the collection ✦';
  grid.innerHTML = state.products.map(product => {
    const sale = product.compareAtJmd && product.compareAtJmd > product.priceJmd;
    const saved = state.wishlist.has(product.id);
    const badge = sale ? `<span class="product-badge sale-badge">${Math.round((1 - product.priceJmd/product.compareAtJmd)*100)}% OFF</span>` : product.tags.includes('new') ? '<span class="product-badge">JUST LANDED</span>' : product.tags.includes('bestseller') ? '<span class="product-badge">BEST SELLER</span>' : '';
    return `<article class="product-card" data-product-card="${esc(product.id)}"><div class="product-image-wrap"><img class="product-image" src="${esc(product.imageUrl)}" alt="${esc(product.imageAlt)}" loading="lazy" decoding="async"><span class="visually-hidden">${esc(product.name)}</span>${badge}<button class="wish-button ${saved?'saved':''}" data-wishlist="${esc(product.id)}" aria-label="${saved?'Remove':'Save'} ${esc(product.name)} ${saved?'from':'to'} wishlist" aria-pressed="${saved}">${saved?'♥':'♡'}</button><button class="quick-add" data-view-product="${esc(product.id)}">Quick add <span>+</span></button></div><div class="product-info"><span class="product-category">${esc(product.category)}</span><button class="product-name text-product-name" data-view-product="${esc(product.id)}">${esc(product.name)}</button><div class="product-description">${esc(product.description)}</div><div class="price-line"><span class="price-current">${money(product.priceJmd)}</span>${sale?`<span class="price-old">${money(product.compareAtJmd)}</span><span class="price-discount">-${Math.round((1-product.priceJmd/product.compareAtJmd)*100)}%</span>`:''}</div><div class="product-colors" aria-label="Available colours">${product.colors.slice(0,5).map(color=>`<span class="color-dot" title="${esc(color)}" style="background:${slugColor(color)}"></span>`).join('')}${product.colors.length>5?`<small>+${product.colors.length-5}</small>`:''}</div>${product.stock <= 4 && product.stock > 0 ? `<div class="stock-note">Only ${product.stock} left</div>` : product.stock === 0 ? '<div class="stock-note">Currently out of stock</div>' : ''}</div></article>`;
  }).join('');
}
function productById(productId) { return state.products.find(product => product.id === productId) || state.cart.map(line => line.product).find(product => product?.id === productId) || null; }
function openProduct(productId) {
  const product = productById(productId);
  if (!product) return toast('This piece is no longer available. Refresh the collection.', 'error');
  state.currentProduct = product;
  const sale = product.compareAtJmd && product.compareAtJmd > product.priceJmd;
  const inWishlist = state.wishlist.has(product.id);
  $('#productModalContent').innerHTML = `<div class="product-detail"><div class="product-detail-image"><img src="${esc(product.imageUrl)}" alt="${esc(product.imageAlt)}"></div><div class="product-detail-copy"><span class="product-category">${esc(product.category)}</span><h2 id="productModalTitle">${esc(product.name)}</h2><div class="price-line"><span class="price-current">${money(product.priceJmd)}</span>${sale?`<span class="price-old">${money(product.compareAtJmd)}</span>`:''}</div><p class="detail-description">${esc(product.description)}</p>${product.stock===0?'<p class="out-of-stock">Currently out of stock.</p>':`<div class="variant-field"><label for="detailColor">Colour <span class="selected-colour" id="selectedColourLabel">${esc(product.colors[0]||'Standard')}</span></label><select id="detailColor">${product.colors.map(color=>`<option value="${esc(color)}">${esc(color)}</option>`).join('')}</select></div><div class="variant-field"><label for="detailSize">Size</label><select id="detailSize">${product.sizes.map(size=>`<option value="${esc(size)}">${esc(size)}</option>`).join('')}</select></div><div class="detail-availability"><span>●</span> ${product.stock} in stock · Price in JMD</div><div class="detail-actions"><label class="visually-hidden" for="detailQty">Quantity</label><select id="detailQty" class="detail-qty">${Array.from({length:Math.min(5,product.stock)},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('')}</select><button id="addToCartButton" class="button button-dark" data-add-current="${esc(product.id)}">Add to bag <span>→</span></button></div><button class="text-link detail-wish" data-wishlist="${esc(product.id)}">${inWishlist?'♥ Saved to wishlist':'♡ Save to wishlist'}</button>`}<div class="product-detail-note">Size and colour options are confirmed before the order is submitted.</div></div></div>`;
  $('#detailColor')?.addEventListener('change', event => { $('#selectedColourLabel').textContent = event.target.value; });
  openModal($('#productModal'));
}
function safeCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem('chf_cart') || '[]');
    return Array.isArray(parsed) ? parsed.filter(item => item && typeof item.productId === 'string' && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 20).slice(0, 50) : [];
  } catch { return []; }
}
function saveCart() { localStorage.setItem('chf_cart', JSON.stringify(state.cart.map(({ productId, size, color, quantity }) => ({ productId, size, color, quantity })))); }
function syncCartWithProducts() {
  state.cart = state.cart.map(line => ({ ...line, product: productByIdFromCollection(line.productId) })).filter(line => line.product);
  saveCart(); updateCounts();
}
function productByIdFromCollection(productId) { return state.products.find(product => product.id === productId) || null; }
function cartUnits() { return state.cart.reduce((sum, item) => sum + item.quantity, 0); }
function cartSubtotal() { return state.cart.reduce((sum, item) => sum + (item.product?.priceJmd || 0) * item.quantity, 0); }
function updateCounts() {
  $('#cartCount').textContent = cartUnits(); $('#cartCount').classList.toggle('hidden', cartUnits() === 0);
  $('#drawerCartCount').textContent = `(${cartUnits()})`;
  $('#wishlistCount').textContent = state.wishlist.size; $('#wishlistCount').classList.toggle('hidden', state.wishlist.size === 0);
}
function addToCart(productId, size, color, quantity = 1) {
  const product = productById(productId);
  if (!product || product.stock <= 0) return toast('This item is currently out of stock.', 'error');
  if (product.sizes.length && !product.sizes.includes(size)) return toast('Choose a size first.', 'error');
  if (product.colors.length && !product.colors.includes(color)) return toast('Choose a colour first.', 'error');
  const existing = state.cart.find(item => item.productId === productId && item.size === size && item.color === color);
  const proposed = (existing?.quantity || 0) + quantity;
  if (proposed > Math.min(20, product.stock)) return toast(`Only ${product.stock} item(s) are available in stock.`, 'error');
  if (existing) existing.quantity = proposed;
  else state.cart.push({ productId, size, color, quantity, product });
  saveCart(); updateCounts(); renderCart();
  toast(`${product.name} added to your bag.`, 'success');
}
function updateCartQuantity(index, nextQuantity) {
  const line = state.cart[index]; if (!line) return;
  const max = Math.min(20, line.product?.stock || 20);
  if (nextQuantity <= 0) state.cart.splice(index, 1);
  else if (nextQuantity > max) toast(`Only ${max} available in stock.`, 'error');
  else line.quantity = nextQuantity;
  saveCart(); renderCart(); updateCounts();
}
function renderCart() {
  const root = $('#cartItems');
  const nonEmpty = state.cart.length > 0;
  $('#cartFooter').classList.toggle('hidden', !nonEmpty);
  if (!nonEmpty) {
    root.innerHTML = `<div class="cart-empty"><span>♡</span><h3>Your bag is waiting.</h3><p>Find something that feels like you.</p><button class="button button-dark" data-close-panel>Keep exploring</button></div>`;
  } else {
    root.innerHTML = state.cart.map((item,index) => `<div class="cart-line"><img src="${esc(item.product.imageUrl)}" alt="${esc(item.product.imageAlt)}"><div class="cart-line-info"><div class="cart-line-title">${esc(item.product.name)}</div><div class="cart-line-meta">${item.size?`Size: ${esc(item.size)} · `:''}${item.color?`Colour: ${esc(item.color)}`:''}</div><div class="cart-line-price">${money(item.product.priceJmd * item.quantity)}</div><div class="cart-line-controls"><div class="qty-control"><button data-cart-qty="${index}" data-delta="-1" aria-label="Decrease quantity">−</button><span>${item.quantity}</span><button data-cart-qty="${index}" data-delta="1" aria-label="Increase quantity">+</button></div><button class="remove-link" data-remove-cart="${index}">Remove</button></div></div></div>`).join('');
    const subtotal = cartSubtotal();
    $('#cartSubtotal').textContent = money(subtotal);
    const threshold = state.config?.freeShippingThresholdJmd || 10000;
    const remaining = Math.max(0, threshold - subtotal);
    $('#shippingProgressText').textContent = remaining ? `${money(remaining)} away from free shipping.` : 'You unlocked free shipping on this order.';
    $('#shippingProgressBar').style.width = `${Math.min(100, subtotal / Math.max(1,threshold) * 100)}%`;
  }
  $('#drawerCartCount').textContent = `(${cartUnits()})`;
  updateCounts();
}
async function toggleWishlist(productId) {
  if (!state.user) { toast('Sign in to save favourites to your account.'); state.currentWishlistTarget = productId; setAuthMode('login'); openModal($('#authModal')); return; }
  try {
    const result = await api(`/api/wishlist/${encodeURIComponent(productId)}`, { method: 'POST' });
    if (result.saved) state.wishlist.add(productId); else state.wishlist.delete(productId);
    renderProducts();
    if (!$('#wishlistModal').classList.contains('hidden')) renderWishlist();
    toast(result.saved ? 'Saved to your wishlist.' : 'Removed from your wishlist.', 'success');
  } catch (error) { toast(error.message, 'error'); }
}
async function loadWishlist() {
  if (!state.user) { state.wishlist = new Set(); updateCounts(); return; }
  try { const data = await api('/api/wishlist'); state.wishlist = new Set(data.products.map(p=>p.id)); updateCounts(); }
  catch (error) { if (error.status !== 401) toast(error.message, 'error'); }
}
function renderWishlist() {
  const root = $('#wishlistProducts');
  if (!state.user) { $('#wishlistIntro').textContent = 'Sign in to save styles and keep your favourites with your account.'; root.innerHTML = ''; return; }
  const products = state.products.filter(p=>state.wishlist.has(p.id));
  $('#wishlistIntro').textContent = products.length ? `${products.length} favourite ${products.length===1?'piece':'pieces'}, kept close.` : 'Your saved styles will show up here. Tap a heart on anything you love.';
  root.innerHTML = products.map(p=>`<div class="mini-product"><img src="${esc(p.imageUrl)}" alt="${esc(p.imageAlt)}"><strong>${esc(p.name)}</strong><span>${money(p.priceJmd)}</span><button data-view-product="${esc(p.id)}">View piece ↗</button></div>`).join('');
}
function setAuthMode(mode) {
  state.currentAuthMode = mode === 'register' ? 'register' : 'login';
  $$('.auth-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.authMode === state.currentAuthMode));
  const register = state.currentAuthMode === 'register';
  $$('.register-only').forEach(el => el.classList.toggle('hidden', !register));
  const password = $('#authForm [name=password]');
  password.autocomplete = register ? 'new-password' : 'current-password';
  password.minLength = register ? 12 : 1;
  $('#authSubmit').innerHTML = register ? 'Create account <span>→</span>' : 'Sign in <span>→</span>';
  $('#authTitle').innerHTML = register ? 'Make room for <em>more you.</em>' : 'Good to have <em>you here.</em>';
  $('#authMessage').textContent = '';
  $('#authForm').classList.toggle('hidden', Boolean(state.user));
  $('#signOutButton').classList.toggle('hidden', !state.user);
  renderAccountPanel();
}
function renderAccountPanel() {
  let panel = $('#accountStatePanel');
  if (!panel) { panel = document.createElement('div'); panel.id='accountStatePanel'; panel.className='account-state-panel'; $('#authForm').after(panel); }
  if (!state.user) { panel.innerHTML=''; panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  panel.innerHTML = `<div class="account-welcome"><span class="account-initial">${esc(state.user.name.slice(0,1).toUpperCase())}</span><div><b>Welcome back, ${esc(state.user.name.split(' ')[0])}.</b><small>${esc(state.user.email)}</small></div></div><div class="account-actions-grid"><button class="button button-light" id="accountOrdersButton">My orders</button><button class="button button-light" id="accountWishlistButton">My wishlist</button>${state.user.role==='admin'?'<button class="button button-dark" id="accountAdminButton">Store admin</button>':''}</div><div id="accountOrdersContent"></div>`;  $('#accountOrdersButton')?.addEventListener('click', () => { void loadAccountOrders(); });
  $('#accountWishlistButton')?.addEventListener('click', () => { renderWishlist(); openModal($('#wishlistModal')); });
  $('#accountAdminButton')?.addEventListener('click', () => { void openAdmin(); });
}
async function loadAccountOrders() {
  const target = $('#accountOrdersContent'); if (!target) return;
  target.innerHTML = '<p class="form-message">Loading your orders…</p>';
  try {
    const {orders} = await api('/api/account/orders');
    target.innerHTML = orders.length ? `<div class="account-orders"><h3>Your orders</h3>${orders.map(order=>`<div class="account-order"><div><b>${esc(order.orderCode)}</b><small>${new Date(order.createdAt).toLocaleDateString()}</small></div><span class="track-status">${esc(order.orderStatus.replaceAll('_',' '))}</span><strong>${money(order.totalJmd)}</strong></div>`).join('')}</div>` : '<p class="form-message">No orders linked to this account yet. Guest checkouts can be tracked using your order code and email.</p>';
  } catch (error) { target.textContent = error.message; }
}
async function authSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const body = Object.fromEntries(formData.entries());
  const submittedMode = state.currentAuthMode;
  const button = $('#authSubmit'); setButtonBusy(button, true, state.currentAuthMode === 'register' ? 'Creating…' : 'Signing in…');
  $('#authMessage').textContent='';
  try {
    const route = state.currentAuthMode === 'register' ? '/api/auth/register' : '/api/auth/login';
    const result = await api(route, { method:'POST', body:JSON.stringify(body) });
    state.user = result.customer;
    await loadWishlist();
    $('#accountButtonLabel').textContent = state.user.name.split(' ')[0];
    $('#adminFooter').classList.toggle('hidden', state.user.role !== 'admin');
    setAuthMode('login');
    if (state.currentWishlistTarget) { const target = state.currentWishlistTarget; state.currentWishlistTarget = null; await toggleWishlist(target); }
    else toast(submittedMode === 'register' ? 'Your account is ready.' : 'Welcome back.', 'success');
    if (state.user.role === 'admin') $('#adminLoginButton').textContent = 'Store admin ↗';
  } catch (error) { $('#authMessage').textContent = error.message; }
  finally { setButtonBusy(button, false); }
}
async function signOut() {
  try { await api('/api/auth/logout', { method:'POST', body:'{}' }); } catch { /* Locally clear the customer state regardless. */ }
  state.user = null; state.wishlist.clear(); $('#authForm').reset(); $('#accountButtonLabel').textContent='Sign in'; $('#adminFooter').classList.add('hidden');
  setAuthMode('login'); renderProducts(); updateCounts(); toast('You have signed out.');
}
function checkoutData(paymentMethod) {
  const form = $('#checkoutForm');
  const formData = new FormData(form);
  const body = Object.fromEntries(formData.entries());
  body.paymentMethod = paymentMethod;
  body.items = state.cart.map(item=>({ productId:item.productId, size:item.size, color:item.color, quantity:item.quantity }));
  return body;
}
function fillCheckout() {
  if (state.user) {
    $('#checkoutName').value = state.user.name || '';
    $('#checkoutEmail').value = state.user.email || '';
  }
  const subtotal = cartSubtotal();
  const shipping = subtotal >= (state.config?.freeShippingThresholdJmd || 10000) ? 0 : (state.config?.shippingFeeJmd ?? 500);
  $('#checkoutItemCount').textContent = `${cartUnits()} ${cartUnits() === 1 ? 'item':'items'}`;
  $('#checkoutSubtotal').textContent = money(subtotal);
  $('#checkoutShipping').textContent = shipping ? money(shipping) : 'Free';
  $('#checkoutTotal').textContent = money(subtotal + shipping);
  $('#checkoutSummaryItems').innerHTML = state.cart.map(item=>`<div class="summary-product"><img src="${esc(item.product.imageUrl)}" alt=""><div><strong>${esc(item.product.name)}</strong><small>${item.quantity} × ${money(item.product.priceJmd)}${item.size?` · ${esc(item.size)}`:''}${item.color?` · ${esc(item.color)}`:''}</small><b>${money(item.quantity*item.product.priceJmd)}</b></div></div>`).join('');
  $('#checkoutMessage').textContent='';
  $('#placeOrderButton').classList.remove('hidden');
  $('#placeOrderButton').disabled = false;
  $('#placeOrderButton').innerHTML = 'Place order request <span>→</span>';
  $('#paypal-option').classList.toggle('hidden', !state.config?.paypalEnabled);
  $('#paypal-button-container').innerHTML = '';
  const paypalRadio = $('#checkoutForm input[value="paypal"]');
  if (paypalRadio) paypalRadio.checked = false;
  const codRadio = $('#checkoutForm input[value="cash_on_delivery"]'); if (codRadio) codRadio.checked = true;
  if (state.config?.paypalEnabled) setupPaypalButtons();
}
function openCheckout() {
  if (!state.cart.length) return toast('Your shopping bag is empty.');
  closeDrawer(false);
  fillCheckout();
  openModal($('#checkoutModal'));
}
async function placeCashOrder(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const payment = new FormData(form).get('paymentMethod');
  if (payment === 'paypal') return toast('Use the PayPal button to complete that payment.');
  const button = $('#placeOrderButton');
  setButtonBusy(button, true, 'Submitting order…');
  $('#checkoutMessage').textContent='';
  try {
    const result = await api('/api/orders', { method:'POST', body:JSON.stringify(checkoutData('cash_on_delivery')) });
    state.lastOrder = result.order;
    state.cart = []; saveCart(); updateCounts(); renderCart();
    closeModal(false);
    await loadProducts();
    showOrderSuccess(result.order, result.message);
  } catch (error) { $('#checkoutMessage').textContent = error.message; }
  finally { setButtonBusy(button, false); }
}
function setupPaypalButtons() {
  const config = state.config;
  if (!config?.paypalEnabled || !config.paypalClientId) return;
  if (window.paypal?.Buttons) { renderPaypalButtons(); return; }
  if (state.paypalScriptLoading) return;
  state.paypalScriptLoading = true;
  const script = document.createElement('script');
  script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.paypalClientId)}&currency=USD&intent=capture`;
  script.async = true;
  script.onload = () => { state.paypalScriptLoading = false; if (window.paypal?.Buttons) renderPaypalButtons(); else $('#checkoutMessage').textContent = 'PayPal could not initialize. Check network and merchant settings.'; };
  script.onerror = () => { state.paypalScriptLoading = false; $('#checkoutMessage').textContent = 'PayPal script did not load. Check the merchant configuration and network.'; };
  document.head.append(script);
}
function renderPaypalButtons() {
  const container = $('#paypal-button-container');
  container.innerHTML = '';
  window.paypal.Buttons({
    style: { layout:'vertical', color:'gold', shape:'rect', label:'paypal', height:42 },
    createOrder: async () => {
      if (!$('#checkoutForm').reportValidity()) throw new Error('Complete your delivery details first.');
      const result = await api('/api/payments/paypal/create', { method:'POST', body:JSON.stringify(checkoutData('paypal')) });
      $('#checkoutMessage').textContent = `PayPal checkout started for ${result.orderCode}.`;
      container.dataset.orderCode = result.orderCode;
      return result.paypalOrderId;
    },
    onApprove: async data => {
      const orderCode = container.dataset.orderCode;
      try {
        const result = await api('/api/payments/paypal/capture', { method:'POST', body:JSON.stringify({ paypalOrderId:data.orderID, orderCode }) });
        state.lastOrder = result.order;
        state.cart = []; saveCart(); updateCounts(); closeModal(false); await loadProducts(); showOrderSuccess(result.order, result.message);
      } catch(error) { $('#checkoutMessage').textContent = `${error.message} Keep your PayPal transaction ID and contact the store operator before retrying.`; }
    },
    onError: error => { $('#checkoutMessage').textContent = error?.message || 'PayPal checkout was interrupted. Check your payment status before retrying.'; },
    onCancel: () => { $('#checkoutMessage').textContent = 'PayPal checkout was cancelled. Your order is not marked as paid.'; },
  }).render(container).catch(error => { $('#checkoutMessage').textContent = error.message || 'PayPal could not load.'; });
}
function showOrderSuccess(order, message) {
  $('#orderSuccessCode').textContent = order.orderCode;
  $('#orderSuccessMessage').textContent = message || 'Your order was received.';
  $('#orderSuccessDetail').innerHTML = `<div class="track-result-card"><p>Order status</p><span class="track-status">${esc(order.orderStatus.replaceAll('_',' '))}</span><p>Payment status: <b>${esc(order.paymentStatus)}</b></p><p>Items: ${order.items.reduce((sum,item)=>sum+item.quantity,0)}</p><p>Total: <b>${money(order.totalJmd)}</b></p></div>`;
  openModal($('#orderSuccessModal'));
}
async function trackOrder(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  const button = event.currentTarget.querySelector('button[type=submit]'); setButtonBusy(button,true,'Checking…');
  $('#trackingMessage').textContent=''; $('#trackingResult').innerHTML='';
  try {
    const result = await api(`/api/track?code=${encodeURIComponent(data.code.trim())}&email=${encodeURIComponent(data.email.trim())}`);
    const order = result.order;
    $('#trackingResult').innerHTML = `<div class="track-result-card"><h3>${esc(order.orderCode)}</h3><span class="track-status">${esc(order.orderStatus.replaceAll('_',' '))}</span><p>Payment: <b>${esc(order.paymentStatus)}</b></p><p>Placed: ${esc(new Date(order.createdAt).toLocaleString())}</p><p>${order.items.reduce((sum,item)=>sum+item.quantity,0)} item(s) · Total <b>${money(order.totalJmd)}</b></p>${order.items.map(item=>`<p>• ${esc(item.name)} × ${item.quantity}${item.size?` (${esc(item.size)})`:''}</p>`).join('')}</div>`;
  } catch (error) { $('#trackingMessage').textContent = error.message; }
  finally { setButtonBusy(button,false); }
}
async function openAdmin() {
  openModal($('#adminModal'));
  if (!state.user) {
    $('#adminContent').innerHTML = `<p class="form-message">Sign in with an administrator account to manage the catalogue and orders.</p><button class="button button-dark" id="adminSignIn">Sign in as administrator <span>→</span></button>`;
    return;
  }
  if (state.user.role !== 'admin') {
    $('#adminContent').innerHTML = `<p class="form-message">This account does not have the administrator role. Grant access locally using <code>npm run make-admin -- your-email@example.com</code> after creating the account.</p>`;
    return;
  }
  await loadAdminDashboard();
}
async function loadAdminDashboard() {
  $('#adminContent').innerHTML = '<div class="loading-state"><span class="loading-spinner"></span>Loading store dashboard…</div>';
  try {
    const data = await api('/api/admin/summary');
    state.adminData = data;
    renderAdminDashboard(data);
  } catch (error) {
    $('#adminContent').innerHTML = `<p class="form-message">${esc(error.message)}</p>`;
  }
}
function renderAdminDashboard(data) {
  $('#adminContent').innerHTML = `<div class="admin-dashboard"><div class="admin-kpis"><div class="admin-kpi"><span>Orders on record</span><strong>${Number(data.summary.orders||0).toLocaleString()}</strong></div><div class="admin-kpi"><span>Paid revenue</span><strong>${money(data.summary.paidRevenueJmd)}</strong></div><div class="admin-kpi"><span>Open orders</span><strong>${Number(data.summary.openOrders||0).toLocaleString()}</strong></div></div><div class="admin-tabs"><button data-admin-tab="orders" class="${state.activeAdminTab==='orders'?'active':''}">Orders (${data.orders.length})</button><button data-admin-tab="products" class="${state.activeAdminTab==='products'?'active':''}">Products (${data.products.length})</button><button data-admin-tab="add-product" class="${state.activeAdminTab==='add-product'?'active':''}">Add product +</button></div><div id="adminTabContent"></div></div>`;
  renderAdminTab();
}
function renderAdminTab() {
  const data = state.adminData; const root = $('#adminTabContent'); if (!root || !data) return;
  if (state.activeAdminTab === 'products') {
    root.innerHTML = `<div class="admin-toolbar"><h3>Product catalogue</h3><button class="button button-light" id="adminReload">Refresh</button></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Product</th><th>Price JMD</th><th>Stock</th><th>Visibility</th><th>Save</th></tr></thead><tbody>${data.products.map(p=>`<tr><td><b>${esc(p.name)}</b><br><small>${esc(p.category)}</small><input type="hidden" value="${esc(p.id)}"></td><td><input type="number" min="0" step="1" value="${p.priceJmd}" data-edit-price="${esc(p.id)}" aria-label="Price for ${esc(p.name)}"></td><td><input type="number" min="0" step="1" value="${p.stock}" data-edit-stock="${esc(p.id)}" aria-label="Stock for ${esc(p.name)}"></td><td><select data-edit-active="${esc(p.id)}" aria-label="Visibility for ${esc(p.name)}"><option value="true" ${p.active?'selected':''}>Visible</option><option value="false" ${!p.active?'selected':''}>Hidden</option></select></td><td><button class="button button-light" data-admin-save-product="${esc(p.id)}">Save</button></td></tr>`).join('')}</tbody></table></div>`;
  } else if (state.activeAdminTab === 'add-product') {
    root.innerHTML = `<div class="admin-toolbar"><h3>Add a new piece</h3></div><form id="adminAddProductForm" class="admin-create-form"><label>Product name<input name="name" required minlength="2" maxlength="120"></label><label>Category<input name="category" required maxlength="60" placeholder="Dresses, Tops, Shoes…"></label><label>Price (JMD)<input name="priceJmd" type="number" min="0" step="1" required></label><label>Compare-at price (JMD)<input name="compareAtJmd" type="number" min="0" step="1"></label><label>Stock quantity<input name="stock" type="number" min="0" step="1" required value="0"></label><label>Image URL (HTTPS)<input name="imageUrl" type="url" required placeholder="https://…"></label><label class="full-span">Description<textarea name="description" rows="2" minlength="5" required maxlength="1000"></textarea></label><label>Colours (comma separated)<input name="colors" placeholder="Black, Cream, Sage"></label><label>Sizes (comma separated)<input name="sizes" placeholder="S, M, L, XL or One size"></label><label>Tags (comma separated)<input name="tags" placeholder="new, bestseller"></label><label>Image description<input name="imageAlt" maxlength="150"></label><label class="full-span"><span><input type="checkbox" name="featured" style="width:auto;min-height:0"> Mark as featured</span></label><div class="full-span"><button class="button button-dark" type="submit">Add product <span>→</span></button><p class="form-message" id="adminAddProductMessage"></p></div></form>`;
  } else {
    root.innerHTML = `<div class="admin-toolbar"><h3>Latest orders</h3><button class="button button-light" id="adminReload">Refresh</button></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Payment</th><th>Status</th><th>Update</th></tr></thead><tbody>${data.orders.map(order=>`<tr><td><b>${esc(order.orderCode)}</b><br><small>${esc(new Date(order.createdAt).toLocaleDateString())}</small></td><td>${esc(order.customerName)}<br><small>${esc(order.customerEmail)}</small><br><small>${esc(order.parish||'')}</small></td><td>${money(order.totalJmd)}</td><td>${esc(order.paymentStatus)}<br><small>${esc(order.paymentMethod)}</small></td><td><select data-order-status="${esc(order.orderCode)}" aria-label="Status for ${esc(order.orderCode)}" ${['cancelled','payment_expired','payment_setup_failed','delivered'].includes(order.orderStatus)?'disabled':''}>${[...new Set(['placed','awaiting_payment','processing','shipped','delivered','cancelled','payment_expired','payment_setup_failed',order.orderStatus])].map(s=>`<option value="${s}" ${s===order.orderStatus?'selected':''}>${s.replaceAll('_',' ')}</option>`).join('')}</select></td><td><button class="button button-light" data-admin-save-order="${esc(order.orderCode)}">Save</button></td></tr>`).join('') || '<tr><td colspan="6">No orders have been placed.</td></tr>'}</tbody></table></div>`;
  }
}
async function saveAdminProduct(productId) {
  const body = {
    priceJmd:Number($(`[data-edit-price="${CSS.escape(productId)}"]`).value),
    stock:Number($(`[data-edit-stock="${CSS.escape(productId)}"]`).value),
    active:$(`[data-edit-active="${CSS.escape(productId)}"]`).value === 'true',
  };
  try { await api(`/api/admin/products/${encodeURIComponent(productId)}`,{method:'PATCH',body:JSON.stringify(body)}); toast('Product details saved.','success'); await loadAdminDashboard(); await loadProducts(); }
  catch(error){toast(error.message,'error');}
}
async function saveAdminOrder(orderCode) {
  const orderStatus = $(`[data-order-status="${CSS.escape(orderCode)}"]`).value;
  try { await api(`/api/admin/orders/${encodeURIComponent(orderCode)}`,{method:'PATCH',body:JSON.stringify({orderStatus})}); toast('Order status updated.','success'); await loadAdminDashboard(); }
  catch(error){toast(error.message,'error');}
}
async function addAdminProduct(event) {
  event.preventDefault();
  const form=event.currentTarget; const data=Object.fromEntries(new FormData(form).entries());
  const payload={...data,priceJmd:Number(data.priceJmd),compareAtJmd:data.compareAtJmd===''?null:Number(data.compareAtJmd),stock:Number(data.stock),colors:data.colors.split(',').map(x=>x.trim()).filter(Boolean),sizes:data.sizes.split(',').map(x=>x.trim()).filter(Boolean),tags:data.tags.split(',').map(x=>x.trim()).filter(Boolean),featured:form.elements.featured.checked,active:true};
  const button=form.querySelector('button[type=submit]');setButtonBusy(button,true,'Saving…');
  try { await api('/api/admin/products',{method:'POST',body:JSON.stringify(payload)}); toast('New product added.','success');state.activeAdminTab='products';await loadAdminDashboard();await loadProducts(); }
  catch(error){$('#adminAddProductMessage').textContent=error.message;}
  finally{setButtonBusy(button,false);}
}
function bindEvents() {
  $('#searchForm').addEventListener('submit', event => { event.preventDefault(); state.search=$('#searchInput').value.trim(); void loadProducts(); focusProducts(); });
  $('#searchInput').addEventListener('keydown', event => { if(event.key==='Escape'){event.currentTarget.value='';state.search='';void loadProducts();} });
  $('#sortSelect').addEventListener('change', event => { state.sort=event.target.value; void loadProducts(); updateActiveNav(); updateFilterDot(); });
  $('#filterButton').addEventListener('click',()=>$('#filterPanel').classList.toggle('hidden'));
  $('#categoryFilter').addEventListener('change', event=>setCategory(event.target.value));
  $('#priceFilter').addEventListener('change', event=>{ const [min,max]=event.target.value==='all'?['','']:event.target.value.split('-');state.min=min;state.max=max;updateFilterDot();void loadProducts(); });
  $('#clearFilters').addEventListener('click',clearFilters); $('#emptyReset').addEventListener('click',clearFilters);
  $('#loadMoreButton').addEventListener('click',()=>toast('That’s the full current collection. More styles can be added from store administration.'));
  $('#heroExplore').addEventListener('click',focusProducts); $('#editorialShop').addEventListener('click',()=>setTag('bestseller'));
  $('#cartButton').addEventListener('click',openDrawer); $('#checkoutButton').addEventListener('click',openCheckout);
  $('#accountButton').addEventListener('click',()=>{setAuthMode('login');openModal($('#authModal'));});
  $('#wishlistButton').addEventListener('click',()=>{renderWishlist();openModal($('#wishlistModal'));});
  $('#mobileMenuButton').addEventListener('click',openMobileMenu);
  $('#authForm').addEventListener('submit',authSubmit); $$('.auth-tab').forEach(tab=>tab.addEventListener('click',()=>setAuthMode(tab.dataset.authMode)));
  $('#signOutButton').addEventListener('click',signOut);
  $('#checkoutForm').addEventListener('submit',placeCashOrder); $('#trackingForm').addEventListener('submit',trackOrder);
  $('#trackOrderFooter').addEventListener('click',()=>openModal($('#trackingModal')));
  $('#accountFooter').addEventListener('click',()=>{setAuthMode('login');openModal($('#authModal'));});
  $('#wishlistFooter').addEventListener('click',()=>{renderWishlist();openModal($('#wishlistModal'));});
  $('#adminFooter').addEventListener('click',openAdmin); $('#adminLoginButton').addEventListener('click',openAdmin); $('#adminRefresh').addEventListener('click',loadAdminDashboard);
  $('#adminContent').addEventListener('click',event=>{const t=event.target.closest('button');if(!t)return;if(t.id==='adminSignIn'){setAuthMode('login');openModal($('#authModal'));}else if(t.id==='adminReload'){void loadAdminDashboard();}else if(t.dataset.adminTab){state.activeAdminTab=t.dataset.adminTab;renderAdminDashboard(state.adminData);}else if(t.dataset.adminSaveProduct){void saveAdminProduct(t.dataset.adminSaveProduct);}else if(t.dataset.adminSaveOrder){void saveAdminOrder(t.dataset.adminSaveOrder);}else if(t.id==='accountAdminButton'){void openAdmin();}else if(t.id==='accountOrdersButton'){void loadAccountOrders();}else if(t.id==='accountWishlistButton'){renderWishlist();openModal($('#wishlistModal'));}});
  $('#adminContent').addEventListener('submit',event=>{if(event.target.id==='adminAddProductForm')void addAdminProduct(event);});
  $('#wishlistExplore').addEventListener('click',()=>{closeModal();focusProducts();}); $('#successContinue').addEventListener('click',()=>{closeModal();focusProducts();});
  $('#copyOrderCode').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('#orderSuccessCode').textContent);toast('Order code copied.','success');}catch{toast(`Your order code is ${$('#orderSuccessCode').textContent}`);}});
  $('#newsletterForm').addEventListener('submit',event=>{event.preventDefault();toast('Newsletter sign-up is not connected yet. No address has been stored.');event.currentTarget.reset();});
  $('#overlay').addEventListener('click',()=>overlayCloseCallback?.());
  document.addEventListener('click',event=>{
    const closeModalButton=event.target.closest('[data-close-modal]');if(closeModalButton){closeModal();return;}
    const closePanelButton=event.target.closest('[data-close-panel]');if(closePanelButton){closeDrawer();return;}
    const closeMobileButton=event.target.closest('[data-close-mobile]');if(closeMobileButton){closeMobileMenu();return;}
    const categoryButton=event.target.closest('[data-category]');if(categoryButton && (categoryButton.closest('#categoryNav')||categoryButton.closest('.category-cards')||categoryButton.closest('.mobile-category-panel')||categoryButton.closest('.footer-column'))){event.preventDefault();setCategory(categoryButton.dataset.category);closePanels();return;}
    const tagButton=event.target.closest('[data-tag]');if(tagButton){event.preventDefault();setTag(tagButton.dataset.tag);closePanels();return;}
    const saleButton=event.target.closest('[data-sale]');if(saleButton){event.preventDefault();state.category='All';state.tag='';state.sort='sale';$('#sortSelect').value='sale';void loadProducts();updateActiveNav();closePanels();focusProducts();return;}
    const productButton=event.target.closest('[data-view-product]');if(productButton){openProduct(productButton.dataset.viewProduct);return;}
    const wishlistButton=event.target.closest('[data-wishlist]');if(wishlistButton){event.preventDefault();event.stopPropagation();void toggleWishlist(wishlistButton.dataset.wishlist);return;}
    const addButton=event.target.closest('[data-add-current]');if(addButton){const product=productById(addButton.dataset.addCurrent);if(!product)return;const size=$('#detailSize')?.value || product.sizes[0] || '';const color=$('#detailColor')?.value || product.colors[0] || '';const qty=Number($('#detailQty')?.value||1);addToCart(product.id,size,color,qty);closeModal(false);openDrawer();return;}
    const qtyButton=event.target.closest('[data-cart-qty]');if(qtyButton){updateCartQuantity(Number(qtyButton.dataset.cartQty),state.cart[Number(qtyButton.dataset.cartQty)].quantity+Number(qtyButton.dataset.delta));return;}
    const removeButton=event.target.closest('[data-remove-cart]');if(removeButton){updateCartQuantity(Number(removeButton.dataset.removeCart),0);return;}
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(currentModal)closeModal();else if(!$('#cartDrawer').classList.contains('hidden'))closeDrawer();else if(!$('#mobileCategoryPanel')?.classList.contains('hidden'))closeMobileMenu();}});
}
function clearFilters() {
  state.search='';state.category='All';state.tag='';state.min='';state.max='';state.sort='featured';
  $('#searchInput').value='';$('#categoryFilter').value='All';$('#priceFilter').value='all';$('#sortSelect').value='featured';updateActiveNav();updateFilterDot();void loadProducts();
}
async function boot() {
  $('#yearNow').textContent = new Date().getFullYear();
  state.cart = safeCart();
  bindEvents();
  const [configResult, userResult] = await Promise.allSettled([api('/api/config'), api('/api/auth/me')]);
  if(configResult.status==='fulfilled')state.config=configResult.value;
  if(userResult.status==='fulfilled')state.user=userResult.value.customer;
  $('#adminFooter').classList.toggle('hidden',state.user?.role!=='admin');
  $('#accountButtonLabel').textContent=state.user?state.user.name.split(' ')[0]:'Sign in';
  if(!state.config){toast('Store settings could not be loaded. Some checkout details may be unavailable.','error');}
  await loadProducts(); await loadWishlist(); renderCart(); setAuthMode('login');
  if(state.config?.paypalEnabled) $('#paypal-option').classList.remove('hidden');
}

boot();
