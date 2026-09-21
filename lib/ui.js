'use strict';
/**
 * ui.js — tiny, dependency-free view layer: HTML escaping, icon set,
 * shared snippets (price, stars, product card, breadcrumbs, pagination).
 */
const store = require('./store');
const commerce = require('./commerce');

function esc(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function attr(value) { return esc(value); }

function money(cents, currency) {
  return commerce.money(cents, currency || (store.getDb().settings.currency || 'USD'));
}

function raw(cents) { return (Math.round(cents || 0) / 100).toFixed(2); }

/**
 * Live brand + policy accessors. Templates use these instead of literal brand
 * names and dollar figures, so `npm run brand` can never leave copy claiming a
 * threshold or a name the settings no longer say.
 */
function brand(settingsArg) {
  const settings = settingsArg || store.getDb().settings || {};
  return settings.brandName || 'Vennix';
}

/**
 * The word mark. A two-word brand renders as two registers (the second in
 * italic serif); a single-word brand like "Vennix" renders as one — no empty
 * <em>, no leftover second line. Everything that shows the mark goes through
 * here so a rebrand can never leave a stale copy behind.
 */
function wordMark(settingsArg) {
  const settings = settingsArg || store.getDb().settings || {};
  const parts = String(settings.brandName || 'Vennix').trim().split(/\s+/);
  const first = parts.shift() || '';
  const rest = parts.join(' ');
  return `${esc(first.toUpperCase())}${rest ? `<em>${esc(rest.toUpperCase())}</em>` : ''}`;
}

function freeShipText(settingsArg) {
  const settings = settingsArg || store.getDb().settings || {};
  return money(settings.freeShippingThreshold || 0);
}

function moneyShort(cents) {
  const n = Math.round(cents || 0) / 100;
  return `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`;
}

const ICONS = {
  cart: '<path d="M6 7h12l-1.2 12.2A2 2 0 0 1 14.8 21H9.2a2 2 0 0 1-2-1.8L6 7Z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20.5c1.2-3.7 4-5.6 7.5-5.6s6.3 1.9 7.5 5.6"/>',
  heart: '<path d="M12 20.3s-7.6-4.6-7.6-9.6A4.4 4.4 0 0 1 12 8.1a4.4 4.4 0 0 1 7.6 2.6c0 5-7.6 9.6-7.6 9.6Z"/>',
  menu: '<path d="M3.5 7h17M3.5 12h17M3.5 17h17"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  chevronDown: '<path d="m5 9 7 7 7-7"/>',
  chevronLeft: '<path d="m15 5-7 7 7 7"/>',
  check: '<path d="m5 13 4.5 4.5L19 7"/>',
  truck: '<path d="M2.5 7.5h11v9h-11z"/><path d="M13.5 11h4l3 3v2.5h-7z"/><circle cx="6.5" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4h-4"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  leaf: '<path d="M5 19c0-8 5-13 14-13 0 9-5 13-14 13Z"/><path d="M5 19c3.5-4.5 7-7.5 11-9.5"/>',
  star: '<path d="m12 3.6 2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6L3.4 10l6-.8Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4.5 7h15M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7"/><path d="M6.5 7l1 12a2 2 0 0 0 2 1.8h5a2 2 0 0 0 2-1.8l1-12"/>',
  filter: '<path d="M4 6.5h16M7 12h10M10 17.5h4"/>',
  grid: '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>',
  pin: '<path d="M12 21s6.5-5.6 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 15.4 12 21 12 21Z"/><circle cx="12" cy="10.5" r="2.4"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4.5 7 7.5 5.5L19.5 7"/>',
  phone: '<path d="M7 3.8 9.6 8 7.9 10a11 11 0 0 0 6 6l2-1.7 4.2 2.6-1.1 2.7c-6.9.7-15.4-7.8-14.6-14.7Z"/>',
  gift: '<rect x="3.5" y="8.5" width="17" height="11.5" rx="1.5"/><path d="M3.5 12.5h17M12 8.5V20"/><path d="M12 8.5C10.5 5 8.8 4 7.5 4.8c-1.4.9-.6 3.7 4.5 3.7Zm0 0c1.5-3.5 3.2-4.5 4.5-3.7 1.4.9.6 3.7-4.5 3.7Z"/>',
  shield: '<path d="M12 3.5 19 6v6c0 4.2-3 7.2-7 8.5-4-1.3-7-4.3-7-8.5V6Z"/><path d="m9 12 2 2 4-4"/>',
  repair: '<path d="M14.5 6.5a3.5 3.5 0 0 0 4.6 4.6L21 13l-3 3-2-2a3.5 3.5 0 0 1-4.6-4.6Z"/><path d="m12 12-7 7 2 2 7-7"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowLeft: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  ruler: '<path d="m3.5 14.5 11-11 7 7-11 11z"/><path d="m7 11 2 2M10 8l2 2M13 5l2 2"/>',
  spark: '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"/>',
  play: '<circle cx="12" cy="12" r="8.5"/><path d="M10.5 9.2 15 12l-4.5 2.8Z"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4l-8.5 8.5"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  chart: '<path d="M4 20V9M10 20V4M16 20v-7M22 20H2"/>',
  box: '<path d="m12 3 8 4.2v9.6L12 21l-8-4.2V7.2Z"/><path d="m4 7.2 8 4.2 8-4.2M12 11.4V21"/>',
  users: '<circle cx="9" cy="9" r="3.2"/><path d="M3 20c.9-3.2 3.2-4.8 6-4.8s5.1 1.6 6 4.8"/><path d="M16 6.2a3.2 3.2 0 0 1 0 6.2M18 20c-.3-1.6-.9-2.9-1.7-3.9"/>',
  tag: '<path d="M11 3.5H20v9l-8.5 8.5-9-9Z"/><circle cx="16" cy="8" r="1.4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2M12 18.5v2M4.6 7.8l1.7 1M17.7 15.2l1.7 1M4.6 16.2l1.7-1M17.7 8.8l1.7-1"/>',
  logout: '<path d="M14 5.5H18A1.5 1.5 0 0 1 19.5 7v10A1.5 1.5 0 0 1 18 18.5h-4"/><path d="M10 8l-4 4 4 4M6 12h8"/>',
  heartFill: '<path fill="currentColor" d="M12 20.3s-7.6-4.6-7.6-9.6A4.4 4.4 0 0 1 12 8.1a4.4 4.4 0 0 1 7.6 2.6c0 5-7.6 9.6-7.6 9.6Z"/>',
  card: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3 10h18"/>',
  apple: '<path d="M15.8 12.4c0-2.2 1.8-3.2 1.9-3.3-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.6.8-3.3.8-.7 0-1.7-.8-2.8-.8-1.4 0-2.8.9-3.5 2.3-1.5 2.6-.4 6.4 1.1 8.5.7 1 1.5 2.1 2.6 2.1 1 0 1.4-.7 2.7-.7s1.6.7 2.7.7 1.8-1 2.5-2c.5-.8.8-1.6 1-2.4-.1 0-2.4-.9-2.4-3.5Z"/><path d="M14.4 5.9c.6-.7 1-1.7.9-2.7-.9 0-1.9.6-2.5 1.3-.5.6-1 1.6-.9 2.6 1 .1 2-.5 2.5-1.2Z"/>',
  // social networks the brand actually runs
  tiktok: '<path d="M15 4.5c.4 2 1.7 3.4 3.7 3.7v2.4c-1.4 0-2.7-.4-3.7-1.2v5.6a4.9 4.9 0 1 1-4.9-4.9c.3 0 .5 0 .8.1v2.5a2.4 2.4 0 1 0 1.7 2.3V4.5Z"/>',
  pinterest: '<circle cx="12" cy="12" r="8.5"/><path d="M10.4 19.5 12.6 11"/><path d="M9.8 13.4a3.2 3.2 0 1 1 5.2 1.6c-1 .8-2.4.6-3-.3"/>',
  linkedin: '<rect x="3.8" y="3.8" width="16.4" height="16.4" rx="2.6"/><path d="M8 10.6v6M8 7.6v.01M12 16.6v-3.4a2 2 0 0 1 4 0v3.4"/>',
  giftcard: '<rect x="3" y="6.5" width="18" height="11" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M12 6.5v11"/>'
};

function icon(name, { size = 20, cls = '', stroke = 1.5, fill = 'none' } = {}) {
  const path = ICONS[name] || '';
  return `<svg class="ic ${attr(cls)}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${path}</svg>`;
}

function stars(rating, { count = null, size = 14, showValue = true } = {}) {
  const rounded = Math.round((rating || 0) * 2) / 2;
  let out = '';
  for (let i = 1; i <= 5; i++) {
    const state = rounded >= i ? 'full' : rounded >= i - 0.5 ? 'half' : 'empty';
    if (state === 'half') {
      out += `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="half${i}"><stop offset="50%" stop-color="currentColor"/><stop offset="50%" stop-color="transparent"/></linearGradient></defs><path d="m12 3.6 2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6L3.4 10l6-.8Z" fill="url(#half${i})" stroke="currentColor" stroke-width="1.2"/></svg>`;
    } else {
      out += `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.6 2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6L3.4 10l6-.8Z" fill="${state === 'full' ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.2"/></svg>`;
    }
  }
  const label = showValue ? `<span class="rating-value">${(rating || 0).toFixed(1)}</span>` : '';
  const countLabel = count !== null && count !== undefined ? `<span class="rating-count">(${count})</span>` : '';
  return `<span class="stars" role="img" aria-label="${rating} out of 5 stars">${out}${label}${countLabel}</span>`;
}

function priceBlock(product, { size = 'base', showCompare = true } = {}) {
  const price = product.price;
  const compare = product.compareAtPrice;
  const onSale = compare && compare > price;
  if (product.priceMin !== undefined && product.priceMax !== undefined && product.priceMin !== product.priceMax) {
    return `<span class="price price--${size}">From ${money(product.priceMin)}</span>`;
  }
  return `<span class="price price--${size} ${onSale ? 'price--sale' : ''}">
    <span class="price__now">${money(price)}</span>
    ${onSale && showCompare ? `<span class="price__was">${money(compare)}</span><span class="price__save">Save ${Math.round(((compare - price) / compare) * 100)}%</span>` : ''}
  </span>`;
}

function badgesFor(product) {
  const out = [];
  const stock = product.inventoryQuantity;
  if (stock <= 0) out.push({ label: 'Sold out', cls: 'badge--soldout' });
  else if ((product.badges || []).includes('New')) out.push({ label: 'New in', cls: 'badge--new' });
  if (product.compareAtPrice && product.compareAtPrice > product.price) {
    out.push({ label: `−${Math.round(((product.compareAtPrice - product.price) / product.compareAtPrice) * 100)}%`, cls: 'badge--sale' });
  }
  if (stock > 0 && stock <= (store.getDb().settings.lowStockThreshold || 5)) out.push({ label: `Only ${stock} left`, cls: 'badge--low' });
  if ((product.badges || []).includes('Bestseller')) out.push({ label: 'Bestseller', cls: 'badge--best' });
  return out.slice(0, 2);
}

function productCard(product, { quickAdd = true, index = 0 } = {}) {
  const hover = product.images[1] ? product.images[1].src : product.images[0].src;
  const soldOut = product.inventoryQuantity <= 0;
  const colors = (product.options.find(o => o.name === 'Colour') || { values: [] }).values;
  const badges = badgesFor(product).map(b => `<span class="badge ${b.cls}">${esc(b.label)}</span>`).join('');
  const firstAvailable = product.variants.find(v => v.stock > 0) || product.variants[0];
  return `<article class="pcard" data-product="${attr(product.handle)}" data-variant="${attr(firstAvailable.id)}" style="--i:${index}">
  <div class="pcard__media">
    <a href="/products/${attr(product.handle)}" class="pcard__link" aria-label="${attr(product.title)}">
      <img class="pcard__img pcard__img--main" src="${attr(product.images[0].src)}" alt="${attr(product.images[0].alt || product.title)}" loading="lazy" width="800" height="800">
      <img class="pcard__img pcard__img--hover" src="${attr(hover)}" alt="" loading="lazy" width="800" height="800" aria-hidden="true">
    </a>
    <div class="pcard__badges">${badges}</div>
    <button class="pcard__wish" type="button" data-wish="${attr(product.handle)}" aria-label="Save ${attr(product.title)} to wishlist" aria-pressed="false">${icon('heart', { size: 18 })}</button>
    ${quickAdd ? `<div class="pcard__quick">
      <button class="btn btn--quick" type="button" data-quickadd="${attr(product.handle)}" ${soldOut ? 'disabled' : ''}>
        ${soldOut ? 'Sold out' : 'Quick add'} <span class="pcard__quick-icon">${icon('plus', { size: 16 })}</span>
      </button>
    </div>` : ''}
  </div>
  <div class="pcard__body">
    <div class="pcard__row">
      <h3 class="pcard__title"><a href="/products/${attr(product.handle)}">${esc(product.title)}</a></h3>
      ${priceBlock(product)}
    </div>
    <p class="pcard__meta">${esc(product.type)} · ${esc(product.tagline || '')}</p>
    <div class="pcard__foot">
      <div class="swatches swatches--sm" role="group" aria-label="Available colours">
        ${colors.slice(0, 5).map(c => `<span class="swatch" style="--sw:${attr(c.hex)}" title="${attr(c.name)}"></span>`).join('')}
        ${colors.length > 5 ? `<span class="swatch-more">+${colors.length - 5}</span>` : ''}
      </div>
      ${product.rating.count > 0
        ? `<span class="pcard__rating">${stars(product.rating.avg, { count: product.rating.count, size: 12, showValue: false })}</span>`
        : '<span class="pcard__rating pcard__rating--new">New — no reviews yet</span>'}
    </div>
  </div>
</article>`;
}

function productGrid(products, opts = {}) {
  if (!products.length) {
    return `<div class="empty-state">
      ${icon('search', { size: 28 })}
      <h3>No products match those filters</h3>
      <p>Try removing a filter or two — or browse the full range.</p>
      <a class="btn btn--primary" href="/collections/all">Shop all products</a>
    </div>`;
  }
  return `<div class="grid grid--products">${products.map((p, i) => productCard(p, { ...opts, index: i })).join('')}</div>`;
}

function breadcrumbs(trail) {
  return `<nav class="crumbs" aria-label="Breadcrumb"><ol>${trail.map((t, i) => {
    const last = i === trail.length - 1;
    return `<li>${t.url && !last ? `<a href="${attr(t.url)}">${esc(t.label)}</a>` : `<span aria-current="page">${esc(t.label)}</span>`}</li>`;
  }).join('')}</ol></nav>`;
}

function sectionHeader({ eyebrow, title, copy, link, linkLabel, align = 'left' }) {
  return `<header class="sec-head sec-head--${align}">
    <div>
      ${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}
      <h2 class="sec-title">${esc(title)}</h2>
      ${copy ? `<p class="sec-copy">${esc(copy)}</p>` : ''}
    </div>
    ${link ? `<a class="link-arrow" href="${attr(link)}">${esc(linkLabel || 'View all')} ${icon('arrow', { size: 16 })}</a>` : ''}
  </header>`;
}

function pagination({ page, totalPages, base, query = {} }) {
  if (totalPages <= 1) return '';
  const url = p => {
    const params = new URLSearchParams(Object.entries(query).filter(([, v]) => v));
    params.set('page', p);
    return `${base}?${params.toString()}`;
  };
  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - page) <= 1) pages.push(i);
    else if (pages[pages.length - 1] !== '…') pages.push('…');
  }
  return `<nav class="pager" aria-label="Pagination">
    ${page > 1 ? `<a class="pager__dir" href="${attr(url(page - 1))}" rel="prev">${icon('chevronLeft', { size: 16 })} Previous</a>` : `<span class="pager__dir is-disabled">${icon('chevronLeft', { size: 16 })} Previous</span>`}
    <ul class="pager__pages">${pages.map(p => p === '…' ? `<li class="pager__gap">…</li>` : `<li>${p === page ? `<span class="is-current" aria-current="page">${p}</span>` : `<a href="${attr(url(p))}">${p}</a>`}</li>`).join('')}</ul>
    ${page < totalPages ? `<a class="pager__dir" href="${attr(url(page + 1))}" rel="next">Next ${icon('chevron', { size: 16 })}</a>` : `<span class="pager__dir is-disabled">Next ${icon('chevron', { size: 16 })}</span>`}
  </nav>`;
}

function selectField({ name, value, options, label, attrs = '' }) {
  return `<label class="field"><span class="field__label">${esc(label)}</span>
    <select name="${attr(name)}" ${attrs}>${options.map(o => `<option value="${attr(o.value)}" ${String(o.value) === String(value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
  </label>`;
}

function inputField({ name, value = '', label, type = 'text', required = false, placeholder = '', autocomplete = '', attrs = '', hint = '', error = '' }) {
  return `<label class="field ${error ? 'has-error' : ''}">
    <span class="field__label">${esc(label)}${required ? ' <em>*</em>' : ''}</span>
    <input type="${attr(type)}" name="${attr(name)}" value="${attr(value)}" ${required ? 'required' : ''} placeholder="${attr(placeholder)}" ${autocomplete ? `autocomplete="${attr(autocomplete)}"` : ''} ${attrs}>
    ${hint ? `<span class="field__hint">${esc(hint)}</span>` : ''}
    ${error ? `<span class="field__error">${esc(error)}</span>` : ''}
  </label>`;
}

function trustRow(items, cls = '') {
  return `<ul class="trust ${attr(cls)}">${items.map(i => `<li>${icon(i.icon, { size: 22 })}<div><strong>${esc(i.title)}</strong>${i.body ? `<span>${esc(i.body)}</span>` : ''}</div></li>`).join('')}</ul>`;
}

function moneyOrFree(cents) { return cents === 0 ? 'Free' : money(cents); }

module.exports = {
  brand, freeShipText, wordMark,
  esc, attr, icon, stars, priceBlock, productCard, productGrid, badgesFor,
  breadcrumbs, sectionHeader, pagination, selectField, inputField, trustRow,
  money, moneyShort, moneyOrFree, raw
};
