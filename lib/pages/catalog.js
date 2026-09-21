'use strict';
const store = require('../store');
const ui = require('../ui');
const commerce = require('../commerce');
const { esc, attr, icon, productGrid, breadcrumbs, pagination, moneyShort, sectionHeader } = ui;

const PER_PAGE = 6;

const SORTS = [
  { value: 'featured', label: 'Featured' },
  { value: 'best-selling', label: 'Best selling' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
  { value: 'newest', label: 'Newest' },
  { value: 'rating', label: 'Top rated' },
  { value: 'title-asc', label: 'Alphabetical: A–Z' }
];

function collectionProducts(handle) {
  const products = store.all('products');
  if (!handle || handle === 'all') return products;
  const collection = store.find('collections', c => c.handle === handle);
  if (collection) return collection.productHandles.map(h => products.find(p => p.handle === h)).filter(Boolean);
  if (handle === 'sale') return products.filter(p => p.compareAtPrice && p.compareAtPrice > p.price);
  return [];
}

function applyFilters(products, q) {
  let out = [...products];
  if (q.q) {
    const term = q.q.toLowerCase();
    out = out.filter(p => `${p.title} ${p.tagline} ${p.type} ${p.tags.join(' ')}`.toLowerCase().includes(term));
  }
  if (q.color) out = out.filter(p => p.variants.some(v => v.color.toLowerCase() === q.color.toLowerCase()));
  if (q.size) out = out.filter(p => p.variants.some(v => v.size.toLowerCase() === q.size.toLowerCase()));
  if (q.type) out = out.filter(p => p.type.toLowerCase() === q.type.toLowerCase());
  if (q.tag) out = out.filter(p => p.tags.includes(q.tag.toLowerCase()));
  if (q.availability === 'in-stock') out = out.filter(p => p.inventoryQuantity > 0);
  if (q.availability === 'out-of-stock') out = out.filter(p => p.inventoryQuantity <= 0);
  if (q.min) out = out.filter(p => p.price >= Number(q.min) * 100);
  if (q.max) out = out.filter(p => p.price <= Number(q.max) * 100);
  switch (q.sort) {
    case 'price-asc': out.sort((a, b) => a.price - b.price); break;
    case 'price-desc': out.sort((a, b) => b.price - a.price); break;
    case 'newest': out.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)); break;
    case 'rating': out.sort((a, b) => b.rating.avg - a.rating.avg); break;
    case 'title-asc': out.sort((a, b) => a.title.localeCompare(b.title)); break;
    case 'best-selling': out.sort((a, b) => (b.flags ? 0 : 0) || b.rating.count - a.rating.count); break;
    default: break;
  }
  return out;
}

function facetCounts(products) {
  const colors = new Map(), sizes = new Map(), types = new Map(), tags = new Map();
  for (const p of products) {
    new Set(p.variants.map(v => v.color)).forEach(c => colors.set(c, (colors.get(c) || 0) + 1));
    new Set(p.variants.map(v => v.size)).forEach(s => sizes.set(s, (sizes.get(s) || 0) + 1));
    types.set(p.type, (types.get(p.type) || 0) + 1);
    p.tags.forEach(t => tags.set(t, (tags.get(t) || 0) + 1));
  }
  const order = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
  return {
    colors: [...colors.entries()].sort((a, b) => b[1] - a[1]),
    sizes: [...sizes.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])),
    types: [...types.entries()].sort((a, b) => b[1] - a[1]),
    tags: [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  };
}

function colorHex(name) {
  for (const p of store.all('products')) {
    const c = p.options.find(o => o.name === 'Colour');
    if (!c) continue;
    const v = c.values.find(x => x.name === name);
    if (v) return v.hex;
  }
  return '#ccc';
}

function activeChips(q, base, collection) {
  const chips = [];
  const map = {
    color: v => `Colour: ${v}`, size: v => `Size: ${v}`, type: v => `Type: ${v}`,
    tag: v => `Tag: ${v}`, availability: v => (v === 'in-stock' ? 'In stock' : 'Sold out'),
    min: v => `Min $${v}`, max: v => `Max $${v}`, q: v => `Search: ${v}`
  };
  for (const [key, value] of Object.entries(q)) {
    if (!value || key === 'sort' || key === 'page') continue;
    const params = { ...q };
    delete params[key];
    delete params.page;
    const qs = new URLSearchParams(Object.entries(params).filter(([, v2]) => v2)).toString();
    chips.push(`<li><a class="chip chip--active" href="${attr(base + (qs ? `?${qs}` : ''))}">${esc((map[key] || (() => key)) (value))} ${icon('close', { size: 12 })}</a></li>`);
  }
  if (!chips.length) return '';
  const clean = new URLSearchParams({ ...(q.sort ? { sort: q.sort } : {}) }).toString();
  return `<ul class="chips" aria-label="Active filters">${chips.join('')}<li><a class="chip chip--clear" href="${attr(base + (clean ? `?${clean}` : ''))}">Clear all</a></li></ul>`;
}

function filterSidebar(facets, q, base, collection) {
  const action = base;
  const keep = (name, value) => `<input type="hidden" name="${attr(name)}" value="${attr(value)}">`;
  return `<form class="filters" data-filters action="${attr(action)}" method="get">
    ${q.sort ? keep('sort', q.sort) : ''}
    ${q.q ? keep('q', q.q) : ''}
    <div class="filters__group">
      <h3>Availability</h3>
      <label class="check"><input type="radio" name="availability" value="" ${!q.availability ? 'checked' : ''}><span>All products (${store.all('products').length})</span></label>
      <label class="check"><input type="radio" name="availability" value="in-stock" ${q.availability === 'in-stock' ? 'checked' : ''}><span>In stock</span></label>
      <label class="check"><input type="radio" name="availability" value="out-of-stock" ${q.availability === 'out-of-stock' ? 'checked' : ''}><span>Sold out</span></label>
    </div>
    <details class="filters__group" open>
      <summary><h3>Colour</h3>${icon('chevronDown', { size: 16 })}</summary>
      <div class="swatch-filters">
        ${facets.colors.map(([name, count]) => `<label class="swatch-filter">
          <input type="radio" name="color" value="${attr(name)}" ${q.color === name ? 'checked' : ''}>
          <span class="swatch" style="--sw:${attr(colorHex(name))}"></span>
          <span class="swatch-filter__name">${esc(name)}</span>
          <span class="swatch-filter__count">${count}</span>
        </label>`).join('')}
      </div>
      ${q.color ? `<a class="filters__clear" href="${attr(base + (q.sort ? `?sort=${attr(q.sort)}` : ''))}">Clear colour</a>` : ''}
    </details>
    <details class="filters__group" open>
      <summary><h3>Size</h3>${icon('chevronDown', { size: 16 })}</summary>
      <div class="size-filters">
        ${facets.sizes.map(([name]) => `<label class="size-filter">
          <input type="radio" name="size" value="${attr(name)}" ${q.size === name ? 'checked' : ''}>
          <span>${esc(name)}</span>
        </label>`).join('')}
      </div>
    </details>
    <details class="filters__group">
      <summary><h3>Product type</h3>${icon('chevronDown', { size: 16 })}</summary>
      <ul class="link-filters">
        ${facets.types.map(([name, count]) => `<li><a href="${attr(base)}?${new URLSearchParams({ ...q, type: name, page: '' }).toString()}" class="${q.type === name ? 'is-active' : ''}">${esc(name)} <em>${count}</em></a></li>`).join('')}
      </ul>
    </details>
    <details class="filters__group">
      <summary><h3>Price</h3>${icon('chevronDown', { size: 16 })}</summary>
      <div class="price-range">
        <label class="field field--sm"><span class="field__label">Min $</span><input type="number" name="min" min="0" step="10" value="${attr(q.min || '')}" placeholder="0"></label>
        <label class="field field--sm"><span class="field__label">Max $</span><input type="number" name="max" min="0" step="10" value="${attr(q.max || '')}" placeholder="200"></label>
      </div>
      <div class="quick-price">
        <a href="${attr(base)}?${new URLSearchParams({ ...q, min: '', max: '', page: '' }).toString()}" class="chip">All prices</a>
        <a href="${attr(base)}?${new URLSearchParams({ ...q, min: '', max: 60, page: '' }).toString()}" class="chip">Under $60</a>
        <a href="${attr(base)}?${new URLSearchParams({ ...q, min: 60, max: 120, page: '' }).toString()}" class="chip">$60–$120</a>
        <a href="${attr(base)}?${new URLSearchParams({ ...q, min: 120, max: '', page: '' }).toString()}" class="chip">$120+</a>
      </div>
    </details>
    <div class="filters__actions">
      <button class="btn btn--primary btn--block" type="submit">Apply filters</button>
      <a class="btn btn--ghost btn--block" href="${attr(base)}">Reset</a>
    </div>
  </form>`;
}

/**
 * "Load more" sits above the paginated links rather than replacing them: the
 * numbered pages stay crawlable and work with JavaScript switched off, while
 * everyone else gets one tap that appends the next page in place.
 */
function moreBar({ page, totalPages, base, query, shown, total }) {
  if (page >= totalPages) return '';
  const nextQuery = new URLSearchParams(Object.entries(query).filter(([, v]) => v));
  nextQuery.set('page', page + 1);
  const remaining = Math.max(0, total - shown);
  return `<div class="more" data-more>
    <button class="btn btn--outline btn--lg" type="button" data-load-more data-next="${attr(`${base}?${nextQuery.toString()}`)}" hidden>
      Show more <span class="more__count">(${remaining} left)</span>
    </button>
    <noscript><a class="btn btn--outline btn--lg" href="${attr(`${base}?${nextQuery.toString()}`)}">Next page →</a></noscript>
    <p class="more__note">Showing ${shown} of ${total}${totalPages > 1 ? ` across ${totalPages} pages` : ''}.</p>
  </div>`;
}

function renderCollection(ctx, handle) {
  const collection = handle === 'all' ? null : store.find('collections', c => c.handle === handle);
  if (handle !== 'all' && !collection && handle !== 'sale') return null;
  const base = handle === 'all' ? '/collections/all' : `/collections/${handle}`;
  const all = collectionProducts(handle);
  const filtered = applyFilters(all, ctx.query);
  const page = Math.max(1, Number(ctx.query.page) || 1);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const pageItems = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const facets = facetCounts(all);
  const title = collection ? collection.title : handle === 'sale' ? 'Sale' : 'All Products';
  const description = collection ? collection.description : `Every piece in the ${ui.brand()} range.`;
  const image = collection ? collection.image : '/images/hero-editorial.jpg';
  const sidebarOpen = !!(ctx.query.color || ctx.query.size || ctx.query.type || ctx.query.availability || ctx.query.min || ctx.query.max);
  return {
    title,
    description: (collection && collection.seo && collection.seo.description) || description,
    canonical: base,
    navActive: '',
    bodyClass: 'template-collection',
    jsonLd: [
      { '@context': 'https://schema.org', '@type': 'CollectionPage', name: `${title} | ${ctx.settings.brandName}`, description, url: `https://${ctx.settings.domain}${base}` },
      { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: `https://${ctx.settings.domain}/` }, { '@type': 'ListItem', position: 2, name: title, item: `https://${ctx.settings.domain}${base}` }] }
    ],
    content: `
    <div class="collection-hero">
      <img src="${attr(image)}" alt="" width="1600" height="600" loading="lazy">
      <div class="wrap collection-hero__inner">
        ${breadcrumbs([{ label: 'Home', url: '/' }, { label: title }])}
        <h1>${esc(title)}</h1>
        <p>${esc(description)}</p>
        <p class="collection-hero__count">${filtered.length} ${filtered.length === 1 ? 'style' : 'styles'}${all.length !== filtered.length ? ` of ${all.length}` : ''}</p>
      </div>
    </div>
    <div class="wrap collection">
      <aside class="collection__aside ${sidebarOpen ? 'is-open' : ''}" data-filter-panel>
        ${filterSidebar(facets, ctx.query, base, handle)}
      </aside>
      <div class="collection__main">
        <div class="toolbar">
          <button class="btn btn--outline btn--sm toolbar__filter" type="button" data-filter-toggle aria-expanded="${sidebarOpen}">${icon('filter', { size: 16 })} Filters</button>
          <p class="toolbar__count" aria-live="polite">Showing ${pageItems.length} of ${filtered.length}</p>
          <form class="toolbar__sort" method="get" action="${attr(base)}" data-sort-form>
            ${Object.entries(ctx.query).filter(([k, v]) => v && k !== 'sort' && k !== 'page').map(([k, v]) => `<input type="hidden" name="${attr(k)}" value="${attr(v)}">`).join('')}
            <label for="sort">Sort by</label>
            <select id="sort" name="sort" data-auto-submit>
              ${SORTS.map(s => `<option value="${attr(s.value)}" ${ctx.query.sort === s.value ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
            </select>
          </form>
        </div>
        ${activeChips(ctx.query, base, collection)}
        ${productGrid(pageItems)}
        ${moreBar({ page, totalPages, base, query: ctx.query, shown: pageItems.length, total: filtered.length })}
        ${pagination({ page, totalPages, base, query: ctx.query })}
        <section class="collection__seo">
          <h2>About the ${esc(title)} collection</h2>
          <p>${esc(description)} Every ${esc(ui.brand())} piece ships free over ${ui.freeShipText(ctx.settings)} with 30-day returns, free exchanges and a two-year repair service. Need help choosing a size? Our <a href="/pages/size-guide">size guide</a> includes fit notes from the product team, or <a href="/pages/contact">ask us directly</a> — we reply within one business day.</p>
        </section>
      </div>
    </div>`
  };
}

function renderSearch(ctx) {
  const q = (ctx.query.q || '').trim();
  const products = q ? applyFilters(store.all('products'), { ...ctx.query, q }) : [];
  const collections = q ? store.all('collections').filter(c => `${c.title} ${c.description}`.toLowerCase().includes(q.toLowerCase())) : [];
  const pages = q ? store.all('pages').filter(p => p.title.toLowerCase().includes(q.toLowerCase())).slice(0, 5) : [];
  const posts = q ? store.all('posts').filter(p => `${p.title} ${p.excerpt}`.toLowerCase().includes(q.toLowerCase())).slice(0, 4) : [];
  const total = products.length + collections.length + posts.length + pages.length;
  const popular = store.all('products').slice(0, 4);
  return {
    title: q ? `Search: ${q}` : 'Search',
    description: `Search results for ${q}`,
    canonical: '/search',
    bodyClass: 'template-search',
    jsonLd: [],
    content: `<div class="wrap page-head">
      ${breadcrumbs([{ label: 'Home', url: '/' }, { label: 'Search' }])}
      <h1>${q ? `Results for “${esc(q)}”` : 'Search the store'}</h1>
      <form class="search-page-form" role="search" action="/search" method="get">
        <input type="search" name="q" value="${attr(q)}" placeholder="What are you looking for?" aria-label="Search">
        <button class="btn btn--primary" type="submit">Search</button>
      </form>
      ${q ? `<p class="page-head__meta">${total} ${total === 1 ? 'result' : 'results'} across products, collections and the journal.</p>` : ''}
    </div>
    <div class="wrap search-results">
      ${!q ? `
        <section class="sec">
          ${sectionHeader({ eyebrow: 'Popular', title: 'Start with these' })}
          ${productGrid(popular)}
        </section>`
      : total === 0 ? `<div class="empty-state">
          ${icon('search', { size: 28 })}
          <h3>Nothing matched “${esc(q)}”</h3>
          <p>Check the spelling, try a broader term, or browse the full range.</p>
          <a class="btn btn--primary" href="/collections/all">Shop all products</a>
        </div>`
        : `
        ${products.length ? `<section class="sec"><h2 class="sec-title">Products (${products.length})</h2>${productGrid(products.slice(0, 12))}</section>` : ''}
        ${collections.length ? `<section class="sec"><h2 class="sec-title">Collections</h2><ul class="result-list">${collections.map(c => `<li><a href="/collections/${attr(c.handle)}"><strong>${esc(c.title)}</strong><span>${esc(c.description)}</span></a></li>`).join('')}</ul></section>` : ''}
        ${posts.length ? `<section class="sec"><h2 class="sec-title">Journal</h2><ul class="result-list">${posts.map(p => `<li><a href="/blogs/journal/${attr(p.handle)}"><strong>${esc(p.title)}</strong><span>${esc(p.excerpt)}</span></a></li>`).join('')}</ul></section>` : ''}
        ${pages.length ? `<section class="sec"><h2 class="sec-title">Help &amp; information</h2><ul class="result-list">${pages.map(p => `<li><a href="/pages/${attr(p.handle)}"><strong>${esc(p.title)}</strong><span>Support and policy information</span></a></li>`).join('')}</ul></section>` : ''}`}
    </div>`
  };
}

module.exports = { renderCollection, renderSearch, collectionProducts, applyFilters, PER_PAGE, SORTS };
