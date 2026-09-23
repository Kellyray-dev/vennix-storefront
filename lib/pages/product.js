'use strict';
/**
 * Product detail page.
 * Product, variants, prices and availability come from Shopify. Reviews come
 * from the store's reviews metafield (whatever a reviews app writes). The
 * shop-the-look rail prefers Shopify's productRecommendations. Monogramming
 * is charged through the store's monogramming service product when present.
 */
const settings = require('../settings');
const catalog = require('../shopify/catalog');
const personalize = require('../personalize');
const style = require('../style');
const fit = require('../fit');
const ui = require('../ui');
const { nonceAttr } = require('../security');
const { esc, attr, icon, stars, breadcrumbs, money, sectionHeader } = ui;

function gallery(product) {
  const images = product.images.length > 1 ? product.images : [product.images[0], { src: '/images/lookbook-1.jpg', alt: `Styled with other ${ui.brand()} pieces` }, { src: '/images/blog-1.jpg', alt: 'Materials in the studio' }];
  return `<div class="gallery" data-gallery>
    <ol class="gallery__thumbs" data-thumbs>
      ${images.map((img, i) => `<li><button type="button" class="${i === 0 ? 'is-active' : ''}" data-thumb="${i}" aria-label="View image ${i + 1}"><img src="${attr(img.src)}" alt="" width="140" height="170" loading="lazy"></button></li>`).join('')}
    </ol>
    <div class="gallery__stage">
      ${images.map((img, i) => `<figure class="gallery__slide ${i === 0 ? 'is-active' : ''}" data-slide="${i}">
        <img src="${attr(img.src)}" alt="${attr(img.alt || product.title)}" width="1000" height="1250" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'}>
      </figure>`).join('')}
      <div class="gallery__badges">${ui.badgesFor(product).map(b => `<span class="badge ${b.cls}">${esc(b.label)}</span>`).join('')}</div>
      <button class="gallery__zoom" type="button" data-gallery-zoom aria-label="Zoom image">${icon('search', { size: 18 })} Zoom</button>
    </div>
  </div>`;
}

function variantPicker(product, monogramConfig) {
  const colors = product.options.find(o => o.name === 'Colour').values;
  const sizes = product.options.find(o => o.name === 'Size').values;
  const first = product.variants.find(v => v.stock > 0) || product.variants[0];
  return `<form class="product-form" data-add-form data-product="${attr(product.handle)}">
    <fieldset class="picker">
      <legend>Colour: <strong data-color-label>${esc(first.color)}</strong></legend>
      <div class="swatch-row">
        ${colors.map(c => {
          const inStock = product.variants.some(v => v.color === c.name && v.stock > 0);
          return `<button type="button" class="swatch swatch--lg ${c.name === first.color ? 'is-active' : ''}" style="--sw:${attr(c.hex)}" data-color="${attr(c.name)}" data-hex="${attr(c.hex)}" title="${attr(c.name)}" aria-label="${attr(c.name)}${inStock ? '' : ' (sold out)'}" aria-pressed="${c.name === first.color}">${inStock ? '' : '<span class="swatch__out"></span>'}</button>`;
        }).join('')}
      </div>
    </fieldset>
    <fieldset class="picker">
      <legend>Size: <strong data-size-label>${esc(first.size)}</strong></legend>
      <div class="size-row">
        ${sizes.map(s => {
          const variant = product.variants.find(v => v.color === first.color && v.size === s.name);
          const out = !variant || variant.stock <= 0;
          // sold-out sizes stay clickable on purpose: selecting one is how a
          // customer reaches the back-in-stock alert instead of a dead end
          return `<button type="button" class="size ${out ? 'is-out' : ''} ${variant && variant.id === first.id ? 'is-active' : ''}" data-size="${attr(s.name)}" data-variant="${variant ? attr(variant.id) : ''}" data-stock="${variant ? variant.stock : 0}" aria-disabled="${out ? 'true' : 'false'}" title="${out ? 'Sold out — set an alert' : ''}" aria-pressed="${variant && variant.id === first.id}">${esc(s.name)}</button>`;
        }).join('')}
      </div>
      <div class="picker__links">
        ${fitTrigger()}
        <button class="link-inline" type="button" data-sizeguide-open>${icon('ruler', { size: 15 })} Size &amp; fit guide</button>
        <span class="picker__fit">${esc(product.fitNotes || '')}</span>
      </div>
    </fieldset>
    <div class="product-form__stock" data-stock-block>
      <span class="stock-pill" data-stock-pill>
        ${first.stock > 5 ? `${icon('check', { size: 14 })} In stock — ships today` : first.stock > 0 ? `${icon('clock', { size: 14 })} Only ${first.stock} left` : 'Sold out'}
      </span>
      <span class="delivery-est" data-delivery-est></span>
    </div>
    ${personalizationBlock(product, monogramConfig)}
    <div class="product-form__buy">
      <div class="qty qty--lg" data-qty>
        <button type="button" data-qty-dec aria-label="Decrease quantity">${icon('minus', { size: 15 })}</button>
        <input type="number" name="quantity" value="1" min="1" max="20" inputmode="numeric" data-qty-input aria-label="Quantity">
        <button type="button" data-qty-inc aria-label="Increase quantity">${icon('plus', { size: 15 })}</button>
      </div>
      <button class="btn btn--primary btn--lg product-form__atc" type="submit" data-add-submit ${product.inventoryQuantity <= 0 ? 'disabled' : ''}>
        ${icon('cart', { size: 18 })} <span data-atc-label>${product.inventoryQuantity <= 0 ? 'Sold out' : `Add to cart · ${money(first.price)}`}</span>
      </button>
    </div>
    <button class="btn btn--dark btn--lg btn--block" type="button" data-buy-now>${icon('lock', { size: 16 })} Buy it now — express checkout</button>
    <div class="product-form__meta">
      <button class="link-inline" type="button" data-wish="${attr(product.handle)}">${icon('heart', { size: 15 })} <span data-wish-label>Save for later</span></button>
      <a class="link-inline" href="#reviews">${icon('star', { size: 15 })} ${
        product.rating.count > 0
          ? `${product.rating.count} ${product.rating.count === 1 ? 'review' : 'reviews'}`
          : 'Be the first to review'}</a>
      <a class="link-inline" href="/pages/contact?topic=Sizing+%26+fit">${icon('mail', { size: 15 })} Ask about this piece</a>
    </div>
    <input type="hidden" name="variantId" value="${attr(first.id)}" data-variant-input>
    <p class="form-msg" data-form-msg role="status"></p>
  </form>`;
}

/**
 * Optional personalisation. When the store carries the monogramming service
 * product the fee is real (added as its own Shopify line); otherwise the
 * letters travel as a note and no fee is advertised.
 */
function personalizationBlock(product, config) {
  if (!config) return '';
  const slider = config.maxChars;
  const charged = config.chargedVia === 'service-product';
  return `<fieldset class="picker monogram" data-monogram data-price="${attr(charged ? config.price : 0)}" data-label="${attr(config.label)}" data-max="${attr(slider)}">
    <legend class="monogram__legend">
      <label class="check monogram__toggle">
        <input type="checkbox" data-monogram-toggle aria-controls="monogram-body" aria-expanded="false">
        <span>${esc(config.copy.heading)} ${charged ? `<em>+${money(config.price)}</em>` : '<em>recorded with your order</em>'}</span>
      </label>
    </legend>
    <div class="monogram__body" id="monogram-body" data-monogram-body hidden>
      <p class="monogram__intro">${esc(config.copy.subheading)} · ${esc(config.placement)}</p>
      <div class="monogram__row">
        <label class="field field--sm monogram__field">
          <span class="field__label">Your ${esc(config.label.toLowerCase())}</span>
          <input type="text" inputmode="text" autocomplete="off" spellcheck="false"
                 maxlength="${attr(slider)}" data-monogram-input placeholder="${attr('A'.repeat(slider))}"
                 aria-describedby="monogram-help">
        </label>
        <div class="monogram__preview" aria-hidden="true">
          <span class="monogram__stitch" data-monogram-preview>${esc('·'.repeat(slider))}</span>
          <small>${esc(config.placement)} — as stitched</small>
        </div>
      </div>
      <p class="monogram__help" id="monogram-help">
        Up to ${slider} characters · ${esc(config.copy.turnaround)} ·
        <strong>${esc(config.note)}</strong>
      </p>
    </div>
  </fieldset>`;
}

/**
 * Back-in-stock alert. It lives outside the add-to-cart form on purpose: a form
 * nested in a form is invalid HTML, and browsers silently unpick the outer one.
 */
function notifyBlock(product) {
  return `<div class="notify" data-notify hidden>
    <p class="notify__lead">${icon('clock', { size: 15 })} <span data-notify-lead>This size is sold out. Leave your email and we will tell you the moment it lands.</span></p>
    <form class="notify__form" data-notify-form>
      <label class="field field--sm">
        <span class="field__label">Email</span>
        <input type="email" name="email" required autocomplete="email" placeholder="you@example.com" aria-label="Email address for the back-in-stock alert">
      </label>
      <button class="btn btn--outline" type="submit" data-notify-submit>Notify me</button>
      <p class="form-msg" data-notify-msg role="status"></p>
    </form>
  </div>`;
}

function fitTrigger() {
  return `<button class="link-inline" type="button" data-fit-open>${icon('ruler', { size: 15 })} ${esc(fit.COPY.heading)}</button>`;
}

/**
 * Size finder. Three fields, then a recommendation the server computes from the
 * body-measurement band plus how this specific piece is cut.
 */
function fitPanel(product) {
  const sizes = product.options.find(o => o.name === 'Size').values.map(v => v.name);
  return `<div class="quickview quickview--fit" data-fit-panel hidden role="dialog" aria-modal="true" aria-labelledby="fit-title">
    <div class="quickview__panel">
      <button class="icon-btn quickview__close" type="button" data-fit-close aria-label="Close size finder">${icon('close')}</button>
      <div class="fit">
        <p class="eyebrow">Size finder</p>
        <h2 id="fit-title" class="fit__title">${esc(fit.COPY.heading)}</h2>
        <p class="fit__intro">${esc(fit.COPY.intro)}</p>
        <form class="fit__form" data-fit-form data-product="${attr(product.handle)}">
          <div class="fit__field">
            <span class="field__label">${esc(fit.COPY.fields.height)}</span>
            <div class="fit__units" role="radiogroup" aria-label="Units">
              <label class="fit__unit"><input type="radio" name="units" value="imperial" checked><span>ft / in</span></label>
              <label class="fit__unit"><input type="radio" name="units" value="metric"><span>cm</span></label>
            </div>
            <div class="fit__pair" data-units-imperial>
              <label class="field field--sm"><span class="field__label">Feet</span><input type="number" name="heightFt" min="4" max="7" value="5" inputmode="numeric"></label>
              <label class="field field--sm"><span class="field__label">Inches</span><input type="number" name="heightIn" min="0" max="11" value="9" inputmode="numeric"></label>
            </div>
            <label class="field field--sm" data-units-metric hidden><span class="field__label">Centimetres</span><input type="number" name="heightCm" min="120" max="230" value="175" inputmode="numeric"></label>
          </div>
          <div class="fit__field">
            <span class="field__label">${esc(fit.COPY.fields.weight)}</span>
            <div class="fit__pair">
              <label class="field field--sm"><span class="field__label" data-weight-unit>Pounds</span><input type="number" name="weight" min="70" max="450" value="165" inputmode="numeric"></label>
            </div>
          </div>
          <label class="field field--sm"><span class="field__label">${esc(fit.COPY.fields.usualSize)}</span>
            <select name="usualSize">
              ${['I have no idea', ...sizes].map(v => `<option value="${attr(v)}">${esc(v)}</option>`).join('')}
            </select>
          </label>
          <fieldset class="fit__pref">
            <legend class="field__label">${esc(fit.COPY.fields.preference)}</legend>
            <label class="check"><input type="radio" name="preference" value="snug"><span>Close to the body</span></label>
            <label class="check"><input type="radio" name="preference" value="true" checked><span>True to size</span></label>
            <label class="check"><input type="radio" name="preference" value="relaxed"><span>Room to move</span></label>
          </fieldset>
          <button class="btn btn--primary btn--block" type="submit">${esc(fit.COPY.cta)}</button>
          <p class="form-msg" data-fit-msg role="status"></p>
        </form>
        <div class="fit__result" data-fit-result hidden aria-live="polite"></div>
        <p class="fit__disclaimer">${esc(fit.COPY.disclaimer)} <a href="/pages/size-guide">Full size guide</a>.</p>
      </div>
    </div>
  </div>`;
}

/**
 * Shop the look. Complements prefer Shopify's productRecommendations, fall
 * back to the deterministic pairing rules, and only ever show in-stock pieces.
 */
function styleRail(product, look) {
  if (!look.length) return '';
  const subtotal = look.reduce((sum, p) => sum + p.price, product.price);
  const bundle = style.bundleFor(look, subtotal);
  const items = [product, ...look];
  return `<section class="sec wrap stylerail" aria-labelledby="h-style">
    ${sectionHeader({ eyebrow: 'Style it with', title: 'Build the whole look', copy: 'Pieces our stylists put with this one — take all of them in one tap.', link: '/collections/all', linkLabel: 'Shop all' })}
    <div class="stylerail__grid">
      <ol class="stylerail__items">
        ${items.map((p, i) => {
          const first = p.variants.find(v => v.stock > 0) || p.variants[0];
          return `<li class="stylerail__item ${i === 0 ? 'is-base' : ''}">
            <a class="stylerail__media" href="/products/${attr(p.handle)}">
              <img src="${attr(p.images[0] ? p.images[0].src : '')}" alt="${attr((p.images[0] && p.images[0].alt) || p.title)}" width="300" height="360" loading="lazy">
              ${i === 0 ? '<span class="stylerail__tag">This piece</span>' : ''}
            </a>
            <div class="stylerail__meta">
              <a class="stylerail__name" href="/products/${attr(p.handle)}">${esc(p.title)}</a>
              <span class="stylerail__price">${money(p.price)}</span>
              <span class="stylerail__avail">${first && first.stock > 0 ? 'In stock' : 'Sold out'}</span>
            </div>
          </li>`;
        }).join('')}
      </ol>
      <aside class="stylerail__summary">
        <h3>The full look</h3>
        <dl class="stylerail__totals">
          ${items.map(p => `<div><dt>${esc(p.title)}</dt><dd>${money(p.price)}</dd></div>`).join('')}
          <div class="stylerail__grand"><dt>${items.length} pieces</dt><dd>${money(subtotal)}</dd></div>
        </dl>
        <button class="btn btn--primary btn--block" type="button"
                data-add-look="${attr(JSON.stringify(items.map(p => ({ handle: p.handle, variantId: ((p.variants.find(v => v.stock > 0) || p.variants[0]) || { id: '' }).id }))))}">
          ${icon('plus', { size: 16 })} Add all ${items.length} to bag
        </button>
        ${bundle.message ? `<p class="stylerail__bundle">${icon('tag', { size: 14 })} ${esc(bundle.message)}</p>` : ''}
        <p class="stylerail__note">Every piece ships and returns on its own — you are not locked into a set.</p>
      </aside>
    </div>
  </section>`;
}

function accordions(product) {
  const items = [
    { title: 'Description', body: product.descriptionHtml, open: true },
    { title: 'Features & materials', body: `<ul class="feature-list">${product.features.map(f => `<li>${icon('check', { size: 15 })} ${esc(f)}</li>`).join('')}</ul><dl class="spec-list"><dt>Materials</dt><dd>${esc(product.materials)}</dd><dt>Fit</dt><dd>${esc(product.fit)}</dd>${product.shippingWeight ? `<dt>Weight</dt><dd>${product.shippingWeight} g</dd>` : ''}<dt>Product code</dt><dd>${esc((product.variants[0] || {}).sku || '')}</dd></dl>` },
    { title: 'Care instructions', body: `<p>${esc(product.care || 'Follow the care label inside the garment.')}</p><p class="muted">Caring for technical fabrics: skip fabric softener (it blocks the wicking channels), wash with like colours and hang dry where you can. Repairs are free for two years — <a href="/pages/contact?topic=Repairs">book one here</a>.</p>` },
    { title: 'Shipping & returns', body: `<ul class="feature-list"><li>${icon('truck', { size: 15 })} Free standard shipping over ${ui.freeShipText()} (4–6 business days)</li><li>${icon('refresh', { size: 15 })} 30-day free returns and free exchanges</li><li>${icon('lock', { size: 15 })} Secure checkout — powered by Shopify</li></ul><p class="muted">Full details in <a href="/pages/shipping-returns">Shipping &amp; returns</a>.</p>` }
  ];
  return `<div class="accordion" data-accordion>
    ${items.map((it, i) => `<details class="accordion__item" ${it.open || i === 0 ? 'open' : ''}>
      <summary><span>${esc(it.title)}</span>${icon('chevronDown', { size: 18 })}</summary>
      <div class="accordion__body">${it.body}</div>
    </details>`).join('')}
  </div>`;
}

function reviewsBlock(product) {
  const all = product.reviews || [];
  const avg = all.length ? all.reduce((s, r) => s + r.rating, 0) / all.length : 0;
  const buckets = [5, 4, 3, 2, 1].map(n => ({ n, count: all.filter(r => r.rating === n).length }));
  const maxCount = Math.max(1, ...buckets.map(b => b.count));
  const reviewWord = all.length === 1 ? 'review' : 'reviews';
  return `<section class="sec reviews-block" id="reviews" aria-labelledby="h-reviews-product">
    <div class="wrap">
      <div class="reviews-block__head">
        <div>
          <p class="eyebrow">Customer reviews</p>
          <h2 id="h-reviews-product" class="sec-title">What wearers say</h2>
          <div class="reviews-block__avg">
            ${all.length
              ? `${stars(avg, { size: 18, showValue: false })}<strong>${avg.toFixed(1)}</strong>
                 <span>from ${all.length} ${reviewWord} · ${all.filter(r => r.verified).length} verified ${all.filter(r => r.verified).length === 1 ? 'buyer' : 'buyers'}</span>`
              : `<span class="reviews-block__none">No reviews yet — this piece is new to the range. Be the first to say how it fits.</span>`}
          </div>
        </div>
        ${all.length ? `<div class="reviews-block__breakdown">
          ${buckets.map(b => `<div class="bar-row">
            <span class="bar-row__label">${b.n} star</span>
            <span class="bar-row__bar"><span style="width:${Math.round((b.count / maxCount) * 100)}%"></span></span>
            <span class="bar-row__count">${b.count}</span>
          </div>`).join('')}
        </div>` : ''}
      </div>
      <ul class="review-list">
        ${all.length ? all.slice().sort((a, b) => (b.helpful || 0) - (a.helpful || 0)).map((r, i) => `<li class="review-item">
          <div class="review-item__head">
            <div>
              ${stars(r.rating, { showValue: false })}
              <strong>${esc(r.title)}</strong>
            </div>
            <span class="review-item__date">${r.date ? new Date(r.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : ''}</span>
          </div>
          <p>${esc(r.body)}</p>
          <div class="review-item__foot">
            <span class="review__avatar" aria-hidden="true">${esc(String(r.author).slice(0, 1))}</span>
            <span>${esc(r.author)}${r.verified ? ` <em class="verified">${icon('check', { size: 12 })} Verified buyer</em>` : ''}</span>
            <button class="link-inline" type="button" data-helpful="${attr(`${product.handle}:${i}`)}">${icon('heart', { size: 14 })} Helpful (${r.helpful || 0})</button>
          </div>
        </li>`).join('') : `<li class="review-item review-item--empty">
          ${icon('mail', { size: 18 })}
          <p><strong>No reviews yet.</strong> Reviews on ${esc(ui.brand())} are only ever written by real customers, so a new piece starts at zero. If you own it, the form below takes about a minute.</p>
        </li>`}
      </ul>
      <details class="review-form-wrap">
        <summary class="btn btn--outline">Write a review</summary>
        <form class="review-form" data-review-form data-product="${attr(product.handle)}">
          <div class="field-row">
            ${ui.inputField({ name: 'author', label: 'Your name', required: true, value: '', autocomplete: 'name' })}
            ${ui.inputField({ name: 'email', label: 'Email (not published)', type: 'email', required: true, autocomplete: 'email' })}
          </div>
          <label class="field"><span class="field__label">Rating <em>*</em></span>
            <div class="star-input" role="radiogroup" aria-label="Rating">
              ${[5, 4, 3, 2, 1].map(n => `<label><input type="radio" name="rating" value="${n}" ${n === 5 ? 'checked' : ''}><span>${'★'.repeat(n)}</span></label>`).join('')}
            </div>
          </label>
          ${ui.inputField({ name: 'title', label: 'Review title', required: true, placeholder: 'Sum it up in a few words' })}
          <label class="field"><span class="field__label">Your review <em>*</em></span><textarea name="body" rows="5" required placeholder="Fit, fabric, how you use it — detail helps other shoppers."></textarea></label>
          <button class="btn btn--primary" type="submit">Submit review</button>
          <p class="form-msg" data-form-msg role="status"></p>
          <p class="muted">Reviews are moderated before they appear on the product.</p>
        </form>
      </details>
    </div>
  </section>`;
}

function stickyBar(product) {
  const first = product.variants.find(v => v.stock > 0) || product.variants[0];
  return `<div class="sticky-atc" data-sticky-atc hidden>
    <div class="wrap sticky-atc__inner">
      <img src="${attr(product.images[0] ? product.images[0].src : '')}" alt="" width="64" height="64" loading="lazy">
      <div class="sticky-atc__meta">
        <strong>${esc(product.title)}</strong>
        <span data-sticky-variant>${esc(first.color)} · ${esc(first.size)}</span>
      </div>
      <span class="sticky-atc__price">${money(first.price)}</span>
      <button class="btn btn--primary" type="button" data-sticky-add>Add to cart</button>
    </div>
  </div>`;
}

async function render(ctx, handle) {
  const product = ctx.chrome.products.find(p => p.handle === handle);
  if (!product || product.hidden) return null;

  const [serviceProduct, recommended] = await Promise.all([
    product.personalization
      ? catalog.getServiceProduct(settings.get().personalization.serviceProductHandle).catch(() => null)
      : Promise.resolve(null),
    catalog.recommendations(product.id, 6).catch(() => [])
  ]);
  const monogramConfig = personalize.configFor(product, { serviceProduct });
  const look = style.lookFor(product, 3, ctx.chrome.products, recommended);

  const primaryHandle = (product.collections || [])[0];
  const primaryCollection = primaryHandle ? ctx.chrome.collections.find(c => c.handle === primaryHandle) : null;
  const primaryCrumb = primaryCollection
    ? { label: primaryCollection.title, url: `/collections/${primaryCollection.handle}` }
    : { label: product.digital ? 'Gift cards' : 'All products', url: product.digital ? '/gift-cards' : '/collections/all' };

  const reviews = product.reviews || [];
  const jsonLd = [
    {
      '@context': 'https://schema.org', '@type': 'Product',
      name: product.title, description: product.seo.description || product.tagline,
      image: product.images.map(i => i.src.startsWith('http') ? i.src : `https://${ctx.settings.domain}${i.src}`),
      sku: (product.variants[0] || {}).sku || undefined, brand: { '@type': 'Brand', name: product.vendor },
      category: product.type,
      ...(product.materials ? { material: product.materials } : {}),
      offers: {
        '@type': 'AggregateOffer', priceCurrency: 'USD',
        lowPrice: (Math.min(...product.variants.map(v => v.price)) / 100).toFixed(2),
        highPrice: (Math.max(...product.variants.map(v => v.price)) / 100).toFixed(2),
        offerCount: product.variants.length,
        availability: product.inventoryQuantity > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        url: `https://${ctx.settings.domain}/products/${product.handle}`
      },
      // aggregateRating and review blocks are only emitted when the store
      // actually has reviews — never advertise ratings you do not have
      ...(product.rating.count > 0 ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: product.rating.avg, reviewCount: product.rating.count } } : {}),
      review: reviews.slice(0, 5).map(r => ({
        '@type': 'Review', reviewRating: { '@type': 'Rating', ratingValue: r.rating }, author: { '@type': 'Person', name: r.author }, name: r.title, reviewBody: r.body, ...(r.date ? { datePublished: String(r.date).slice(0, 10) } : {})
      }))
    },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: `https://${ctx.settings.domain}/` }, { '@type': 'ListItem', position: 2, name: primaryCrumb.label, item: `https://${ctx.settings.domain}${primaryCrumb.url}` }, { '@type': 'ListItem', position: 3, name: product.title, item: `https://${ctx.settings.domain}/products/${product.handle}` }] }
  ];
  return {
    title: product.title,
    description: (product.seo && product.seo.description) || product.tagline,
    canonical: `/products/${product.handle}`,
    bodyClass: 'template-product',
    navActive: '',
    jsonLd,
    content: `
    <div class="wrap">
      ${breadcrumbs([{ label: 'Home', url: '/' }, { label: primaryCrumb.label, url: primaryCrumb.url }, { label: product.title }])}
    </div>
    <div class="wrap product">
      <div class="product__media">${gallery(product)}</div>
      <div class="product__info">
        <div class="product__head">
          <p class="eyebrow">${esc(product.vendor)} · ${esc(product.type)}</p>
          <h1 class="product__title">${esc(product.title)}</h1>
          <p class="product__tagline">${esc(product.tagline)}</p>
          <div class="product__rating">
            ${product.rating.count > 0
              ? `${stars(product.rating.avg, { size: 16 })}<a href="#reviews">${product.rating.count} ${product.rating.count === 1 ? 'review' : 'reviews'}</a>`
              : `<a class="product__rating-new" href="#reviews">${icon('star', { size: 15 })} No reviews yet — be the first</a>`}
          </div>
          <div class="product__price">
            ${ui.priceBlock(product, { size: 'lg' })}
            <span class="product__tax">Tax calculated at checkout · Free shipping over ${ui.freeShipText()}</span>
          </div>
        </div>
        ${variantPicker(product, monogramConfig)}
        ${notifyBlock(product)}
        <div class="product__assurances">
          ${ui.trustRow(ctx.settings.trustBadges.slice(0, 4))}
        </div>
        ${accordions(product)}
        <script type="application/json" data-product-json="${attr(product.handle)}"${nonceAttr()}>${JSON.stringify({
          handle: product.handle, title: product.title,
          variants: product.variants.map(v => ({ id: v.id, color: v.color, colorHex: v.colorHex, size: v.size, price: v.price, compareAtPrice: v.compareAtPrice, stock: v.stock, sku: v.sku, image: v.image })),
          images: product.images.map(i => i.src)
        })}</script>
      </div>
    </div>
    ${reviewsBlock(product)}
    ${styleRail(product, look)}
    ${fitPanel(product)}
    <section class="sec wrap" data-recently-viewed hidden aria-labelledby="h-recent">
      ${sectionHeader({ eyebrow: 'Recently viewed', title: 'Pick up where you left off' })}
      <div class="grid grid--products" data-recently-viewed-grid></div>
    </section>
    ${stickyBar(product)}`
  };
}

module.exports = { render };
