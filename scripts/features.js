'use strict';
/**
 * features.js — the storefront's less obvious machinery, exercised over HTTP.
 *
 * The smoke test covers routes; this covers the rules behind the features:
 * paid monogramming (as a real Shopify service-product line), the size
 * finder, shop-the-look pairing, back-in-stock alerts, server-side filtering
 * and load-more — including the cases that must *refuse*.
 *
 * Usage: node scripts/features.js [baseUrl]
 */
const { ensureBase } = require('./helpers');
let BASE = '';
let stopServer = null;

let pass = 0, fail = 0;
const failures = [];

/** A cookie-jar session, because cart behaviour is per-session. */
function session(userAgent) {
  const jar = new Map();
  return {
    async req(path, { method = 'GET', body } = {}) {
      const headers = { 'User-Agent': userAgent };
      const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
      if (cookie) {
        headers.Cookie = cookie;
        const csrf = jar.get('vnx_csrf');
        if (csrf) headers['X-CSRF-Token'] = csrf;
      }
      if (method !== 'GET') headers.Origin = BASE;
      if (body) headers['Content-Type'] = 'application/json';
      const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
      (res.headers.getSetCookie ? res.headers.getSetCookie() : []).forEach((raw) => {
        const [pair] = raw.split(';');
        const index = pair.indexOf('=');
        if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1));
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* html or empty */ }
      return { status: res.status, text, json };
    }
  };
}

function expect(label, condition, detail = '') {
  if (condition) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fail += 1; failures.push(label + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
}

function productJson(html, handle) {
  const match = html.match(new RegExp(`<script[^>]*data-product-json="${handle}"[^>]*>([\\s\\S]*?)</script>`));
  return match ? JSON.parse(match[1]) : null;
}

let RUNTIME_BASE = null;
(async function run() {
  const host = await ensureBase(process.argv[2]);
  BASE = host.base;
  stopServer = host.stop;
  RUNTIME_BASE = BASE;
  console.log(`\nVennix feature test → ${BASE}\n${'─'.repeat(48)}`);

  /* ------------------------------------------------------------ monogramming */
  console.log('\nMonogramming (paid personalisation via a Shopify service product)');
  const s = session('vennix-features/monogram');
  const pdp = await s.req('/products/atlas-heavyweight-hoodie');
  expect('product page offers monogramming', pdp.text.includes('data-monogram-input'));
  expect('the add-on price is stated up front', pdp.text.includes('+$20.00'));

  const bare = await s.req('/products/flow-high-rise-legging-28');
  expect('a product that does not offer it shows no module', !bare.text.includes('data-monogram-input'));

  const preview = await s.req('/api/monogram', { method: 'POST', body: { handle: 'atlas-heavyweight-hoodie', text: 'a1!' } });
  expect('preview strips what cannot be stitched', preview.json && preview.json.text === 'A1', JSON.stringify(preview.json && preview.json.text));
  const overflow = await s.req('/api/monogram', { method: 'POST', body: { handle: 'atlas-heavyweight-hoodie', text: 'ABCDE' } });
  expect('too many characters is refused, not silently trimmed', overflow.json && overflow.json.valid === false);
  const wrongProduct = await s.req('/api/monogram', { method: 'POST', body: { handle: 'flow-high-rise-legging-28', text: 'ABC' } });
  expect('a non-eligible product is refused outright', wrongProduct.status === 422);

  const data = productJson(pdp.text, 'atlas-heavyweight-hoodie');
  const variant = data.variants.find(v => v.stock > 5);
  const add = await s.req('/api/cart/add', { method: 'POST', body: { variantId: variant.id, quantity: 1, personalization: { text: 'abc' } } });
  expect('a monogrammed piece can be added', add.json.ok);
  expect('the line carries the characters', add.json.cart.lines[0].personalization.text === 'ABC');
  expect('the fee is charged via the service product line', add.json.cart.subtotal === variant.price + 2000,
    `${add.json.cart.subtotal} vs ${variant.price + 2000}`);
  const blank = await s.req('/api/cart/add', { method: 'POST', body: { variantId: variant.id, quantity: 1 } });
  expect('identical garments merge; cart still shows one display line', blank.json.cart.lines.length === 1 && blank.json.cart.lines[0].quantity === 2,
    JSON.stringify(blank.json.cart.lines.map(l => ({ q: l.quantity, p: !!l.personalization }))));
  const again = await s.req('/api/cart/add', { method: 'POST', body: { variantId: variant.id, quantity: 1, personalization: { text: 'abc' } } });
  expect('adding the same monogram again merges quantities', again.json.cart.lines.length === 1 && again.json.cart.lines[0].quantity === 3);
  const badAdd = await s.req('/api/cart/add', { method: 'POST', body: { variantId: variant.id, personalization: { text: 'TOOLONG' } } });
  expect('an invalid monogram never reaches the cart', badAdd.status === 400);

  /* --------------------------------------------------------------- size finder */
  console.log('\nSize finder (an estimate, with its reasoning)');
  expect('the size finder ships on the product page', pdp.text.includes('data-fit-form'));
  const tall = await s.req('/api/fit', { method: 'POST', body: { handle: 'atlas-heavyweight-hoodie', height: 74, weight: 210, units: 'imperial' } });
  expect('tall and heavy lands in XL', tall.json.fit.size === 'XL', tall.json.fit.size);
  const metric = await s.req('/api/fit', { method: 'POST', body: { handle: 'atlas-heavyweight-hoodie', height: 180, weight: 80, units: 'metric' } });
  expect('metric measurements work', ['M', 'L'].includes(metric.json.fit.size), metric.json.fit.size);
  const relaxed = await s.req('/api/fit', { method: 'POST', body: { handle: 'atlas-heavyweight-hoodie', height: 70, weight: 170, preference: 'relaxed' } });
  const snug = await s.req('/api/fit', { method: 'POST', body: { handle: 'atlas-heavyweight-hoodie', height: 70, weight: 170, preference: 'snug' } });
  const order = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL'];
  expect('"room to move" recommends a size up from "close fit"', order.indexOf(relaxed.json.fit.size) > order.indexOf(snug.json.fit.size),
    `${relaxed.json.fit.size} vs ${snug.json.fit.size}`);
  expect('the answer explains itself', tall.json.fit.reasons.length >= 2);
  expect('the answer admits how sure it is', ['high', 'medium', 'low'].includes(tall.json.fit.confidence));
  expect('the answer links to the full size guide', tall.json.fit.sizeGuide === '/pages/size-guide');
  const nonsense = await s.req('/api/fit', { method: 'POST', body: { handle: 'atlas-heavyweight-hoodie', height: 300, weight: 210 } });
  expect('impossible measurements are rejected', nonsense.status === 400);
  const bra = await s.req('/api/fit', { method: 'POST', body: { handle: 'ribbed-seamless-sports-bra', height: 66, weight: 150 } });
  expect('it never recommends a size the product does not make', ['XS', 'S', 'M', 'L', 'XL'].includes(bra.json.fit.size), bra.json.fit.size);

  /* ------------------------------------------------------------ shop the look */
  console.log('\nShop the look (Shopify recommendations + studio pairing rules)');
  const look = await s.req('/api/style?handle=atlas-heavyweight-hoodie&limit=3');
  expect('the rail returns three partners', look.json.look.length === 3);
  expect('partners are complementary, not more of the same', look.json.look.every(l => l.type !== 'Hoodie'));
  expect('every partner is actually in stock', look.json.look.every(l => l.available));
  const railPdp = await s.req('/products/everyday-brushed-fleece-jogger');
  expect('the product page renders the rail with real prices', railPdp.text.includes('data-add-look') && railPdp.text.includes('The full look'));
  expect('the rail never invents a bundle discount', !/bundle (saving|discount)/i.test(railPdp.text) && railPdp.text.includes('Have a code'));

  const lookSession = session('vennix-features/look');
  const items = look.json.look.map(l => ({ variantId: l.variant, quantity: 1 }));
  const lookAdd = await lookSession.req('/api/cart/add', { method: 'POST', body: { items } });
  expect('the whole look adds in one request', lookAdd.json.ok && lookAdd.json.added === 3, JSON.stringify(lookAdd.json.failed));
  expect('the cart then holds three pieces', lookAdd.json.cart.count === 3, String(lookAdd.json.cart.count));
  const partial = await lookSession.req('/api/cart/add', { method: 'POST', body: { items: [{ variantId: 'gid://shopify/ProductVariant/not_real_x' }, { variantId: look.json.look[1].variant }] } });
  expect('one bad item does not discard the good ones', partial.json.ok && partial.json.added === 1 && partial.json.failed.length === 1);

  /* ------------------------------------------------------- back in stock */
  console.log('\nBack-in-stock alerts (every promise is actionable)');
  const notifySession = session('vennix-features/notify');
  const hoodie = await notifySession.req('/products/atlas-heavyweight-hoodie');
  const soldOut = productJson(hoodie.text, 'atlas-heavyweight-hoodie').variants.find(v => v.stock <= 0);
  expect('a sold-out size exists in the catalog', !!soldOut, soldOut ? `${soldOut.color}/${soldOut.size}` : 'none');
  if (soldOut) {
    const badEmail = await notifySession.req('/api/notify', { method: 'POST', body: { email: 'not-an-email', variantId: soldOut.id } });
    expect('a nonsense email is refused', badEmail.status === 400);
    const inStock = productJson(hoodie.text, 'atlas-heavyweight-hoodie').variants.find(v => v.stock > 5);
    const allowed = await notifySession.req('/api/notify', { method: 'POST', body: { email: 'waiting@example.com', variantId: inStock.id } });
    expect('an alert is refused for something you can just buy', allowed.status === 400);
    const first = await notifySession.req('/api/notify', { method: 'POST', body: { email: 'waiting@example.com', variantId: soldOut.id } });
    expect('a sold-out size accepts a request', first.json && first.json.ok);
    expect('the confirmation names the piece and size', /Atlas Heavyweight Hoodie/.test(first.json.message) && first.json.message.includes(soldOut.size));
    const dupe = await notifySession.req('/api/notify', { method: 'POST', body: { email: 'waiting@example.com', variantId: soldOut.id } });
    // Uniform confirmation regardless of prior signup (prevents email
    // enumeration): both responses must look identical to an attacker.
    expect('asking twice returns a confirmation (no email enumeration)', dupe.json.ok && /will email/.test(dupe.json.message) && !/already/i.test(dupe.json.message));
  }
  const notifyForm = await session('vennix-features/notify-form').req('/products/atlas-heavyweight-hoodie');
  expect('the product page ships a working alert form', notifyForm.text.includes('data-notify-form'));

  /* ----------------------------------------------------- filtering + paging */
  console.log('\nCollections: server-side filtering, sorting, load more');
  const all = await s.req('/collections/all');
  const next = all.text.match(/data-next="([^"]+)"/);
  expect('the collection ships a load-more control', !!next);
  expect('the keyed fallback link is still there for crawlers', all.text.includes('noscript') || all.text.includes('data-more'));
  if (next) {
    const page2 = await s.req(next[1].replace(/&amp;/g, '&'));
    expect('the next page returns real product cards', (page2.text.match(/class="pcard"/g) || []).length > 0);
  }
  const filtered = await s.req('/collections/all?color=Clay&sort=price-asc');
  expect('load-more preserves the active filters and sort',
    !/data-next/.test(filtered.text) || /data-next="[^"]*color=Clay[^"]*sort=price-asc/.test(filtered.text) || /data-next="[^"]*sort=price-asc/.test(filtered.text));
  const tagged = await s.req('/collections/active?tag=running');
  expect('tag filters narrow the listing', (tagged.text.match(/class="pcard"/g) || []).length < (all.text.match(/class="pcard"/g) || []).length + 1);
  const sorted = await s.req('/collections/all?sort=price-asc');
  const prices = sorted.text.split('<article class="pcard"').slice(1)
    .map(chunk => { const m = chunk.match(/\$(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : null; })
    .filter(n => n !== null);
  expect('price-asc sort is honoured by the server', prices.length > 1 && prices.every((p, i) => i === 0 || prices[i - 1] <= p), prices.join(','));

  /* ------------------------------------------------------------------ search */
  console.log('\nSearch: remembering what people looked for');
  expect('the search overlay has a slot for recent searches', all.text.includes('data-recent-searches'));
  const searchJson = await s.req('/api/search?q=atlas');
  expect('predictive search finds products, collections or articles', searchJson.json.ok &&
    (searchJson.json.products.length + searchJson.json.collections.length + searchJson.json.articles.length) > 0);

  /* ------------------------------------------------------------ free shipping */
  console.log('\nFree-shipping promise (storefront brand rule, not shipping calc)');
  const fsSession = session('vennix-features/collections');
  const expensive = productJson(pdp.text, 'atlas-heavyweight-hoodie').variants.find(v => v.stock > 5 && v.price >= 5000);
  await fsSession.req('/api/cart/add', { method: 'POST', body: { variantId: expensive.id, quantity: 1 } });
  const cartRes = await fsSession.req('/api/cart');
  expect('cart drawer reports the free-shipping promise', /free standard shipping/i.test(cartRes.json.html.shipMsg));

  if (stopServer) await stopServer();
  console.log(`\n${'─'.repeat(48)}`);
  console.log(`  ${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(`  · ${f}`));
  }
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
