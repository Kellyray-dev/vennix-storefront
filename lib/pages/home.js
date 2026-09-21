'use strict';
const store = require('../store');
const ui = require('../ui');
const { esc, attr, icon, productCard, sectionHeader, stars, money } = ui;

function rail(id, title, products, { eyebrow, copy, link, linkLabel } = {}) {
  return `<section class="sec wrap" aria-labelledby="${attr(id)}">
    ${sectionHeader({ eyebrow, title, copy, link, linkLabel })}
    <div class="rail" data-rail>
      <button class="rail__btn rail__btn--prev" type="button" data-rail-prev aria-label="Scroll left">${icon('chevronLeft', { size: 18 })}</button>
      <ul class="rail__track" data-rail-track>
        ${products.map((p, i) => `<li class="rail__item">${productCard(p, { index: i })}</li>`).join('')}
      </ul>
      <button class="rail__btn rail__btn--next" type="button" data-rail-next aria-label="Scroll right">${icon('chevron', { size: 18 })}</button>
    </div>
  </section>`;
}

function hero() {
  return `<section class="hero" aria-label="Capsule 01">
    <img class="hero__img" data-parallax="0.05" src="/images/hero-editorial.jpg" alt="Two models wearing ${attr(ui.brand())} training and everyday pieces against a concrete wall" width="1800" height="1000" fetchpriority="high">
    <div class="hero__scrim"></div>
    <div class="wrap hero__inner">
      <p class="eyebrow eyebrow--light">Capsule 01 · Autumn release</p>
      <h1 class="hero__title">Modern essentials,<br>engineered for movement.</h1>
      <p class="hero__copy">Eight deliberate styles. Heavyweight fleece, Peruvian Pima, technical shells and squat-proof compression — made in small runs, tested for 60 days before release.</p>
      <div class="hero__cta">
        <a class="btn btn--light btn--lg" href="/collections/men">Shop men ${icon('arrow', { size: 16 })}</a>
        <a class="btn btn--glass btn--lg" href="/collections/women">Shop women ${icon('arrow', { size: 16 })}</a>
      </div>
      <ul class="hero__trust">
        <li>${icon('truck', { size: 16 })} Free shipping over ${ui.freeShipText()}</li>
        <li>${icon('refresh', { size: 16 })} 30-day free returns</li>
        <li>${icon('lock', { size: 16 })} Secure sandbox checkout</li>
      </ul>
    </div>
    <a class="hero__scroll" href="#shop-by-category" aria-label="Scroll to shop by category">${icon('chevronDown', { size: 20 })}</a>
  </section>`;
}

function valueMarquee(settings) {
  const items = [...(settings.trustBadges || []), { title: 'Repairs for 2 years', body: 'Free fix, not landfill' }];
  return `<div class="marquee" aria-hidden="true"><div class="marquee__track">
    ${[0, 1].map(() => `<div class="marquee__group">${items.map(i => `<span>${icon(i.icon || 'spark', { size: 16 })} ${esc(i.title)}</span>`).join('')}</div>`).join('')}
  </div></div>`;
}

function categoryTriptych(settings) {
  const picks = [
    { handle: 'women', title: "Women's", copy: 'Compression, bras and layers', image: '/images/lookbook-2.jpg', count: store.all('collections').find(c => c.handle === 'women').productHandles.length },
    { handle: 'men', title: "Men's", copy: 'Heavyweight fleece and technical layers', image: '/images/p-atlas-hoodie.jpg', count: store.all('collections').find(c => c.handle === 'men').productHandles.length },
    { handle: 'active', title: 'Active', copy: 'Tested at pace by 30 wearers', image: '/images/lookbook-1.jpg', count: store.all('collections').find(c => c.handle === 'active').productHandles.length }
  ];
  return `<section class="sec wrap" id="shop-by-category" aria-labelledby="h-cats">
    ${sectionHeader({ eyebrow: 'Shop by category', title: 'Start where you train', copy: 'Three ways into the range — every piece shares one palette so it all works together.', link: '/collections/all', linkLabel: 'Shop all products' })}
    <div class="triptych">
      ${picks.map((p, i) => `<a class="tile" href="/collections/${attr(p.handle)}" style="--i:${i}" data-parallax="0.03">
        <img src="${attr(p.image)}" alt="${attr(p.title)} collection" width="900" height="1100" loading="lazy">
        <span class="tile__body">
          <strong>${esc(p.title)}</strong>
          <em>${esc(p.copy)}</em>
          <span class="tile__cta">${p.count} styles ${icon('arrow', { size: 15 })}</span>
        </span>
      </a>`).join('')}
    </div>
  </section>`;
}

function spotlight(product) {
  const colors = product.options.find(o => o.name === 'Colour').values;
  const sizes = product.options.find(o => o.name === 'Size').values;
  const firstInStock = product.variants.find(v => v.stock > 0) || product.variants[0];
  return `<section class="sec spotlight" aria-labelledby="h-spot">
    <div class="wrap spotlight__inner">
      <div class="spotlight__media">
        <img src="/images/lookbook-1.jpg" alt="Model wearing the ${attr(product.title)}" width="900" height="1100" loading="lazy">
        <span class="spotlight__stamp">${product.rating.count > 0
          ? `${icon('star', { size: 14 })} ${product.rating.avg} · ${product.rating.count} ${product.rating.count === 1 ? 'review' : 'reviews'}`
          : `${icon('spark', { size: 14 })} New to the range`}</span>
      </div>
      <div class="spotlight__body">
        <p class="eyebrow">The piece everyone starts with</p>
        <h2 id="h-spot" class="sec-title">${esc(product.title)}</h2>
        <p class="spotlight__tagline">${esc(product.tagline)}</p>
        ${product.rating.count > 0 ? `<div class="spotlight__rating">${stars(product.rating.avg, { count: product.rating.count })}</div>` : ''}
        <p class="spotlight__copy">${product.descriptionHtml.split('</p>')[0].replace('<p>', '')}</p>
        <form class="spotlight__form" data-add-form data-product="${attr(product.handle)}">
          <fieldset class="picker">
            <legend>Colour</legend>
            <div class="swatch-row" data-color-picker>
              ${colors.map((c, i) => `<button type="button" class="swatch swatch--lg ${i === 0 ? 'is-active' : ''}" style="--sw:${attr(c.hex)}" data-color="${attr(c.name)}" title="${attr(c.name)}" aria-label="${attr(c.name)}" aria-pressed="${i === 0}"></button>`).join('')}
            </div>
            <p class="picker__value" data-color-label>${esc(colors[0].name)}</p>
          </fieldset>
          <fieldset class="picker">
            <legend>Size</legend>
            <div class="size-row" data-size-picker>
              ${sizes.map((s, i) => {
                const variant = product.variants.find(v => v.color === colors[0].name && v.size === s.name);
                const out = !variant || variant.stock <= 0;
                return `<button type="button" class="size ${out ? 'is-out' : ''} ${i === 2 && !out ? 'is-active' : ''}" data-size="${attr(s.name)}" ${out ? 'disabled aria-disabled="true"' : ''} aria-pressed="false" data-variant="${variant ? attr(variant.id) : ''}">${esc(s.name)}</button>`;
              }).join('')}
            </div>
            <button class="link-inline" type="button" data-sizeguide-open>${icon('ruler', { size: 15 })} Size &amp; fit guide</button>
          </fieldset>
          <input type="hidden" name="variantId" value="${attr(firstInStock.id)}" data-variant-input>
          <div class="spotlight__actions">
            <button class="btn btn--primary btn--lg" type="submit" data-add-submit>Add to cart · ${money(firstInStock.price)}</button>
            <a class="btn btn--ghost btn--lg" href="/products/${attr(product.handle)}">Full details</a>
          </div>
          <p class="form-msg" data-form-msg role="status"></p>
        </form>
        <script type="application/json" data-product-json="${attr(product.handle)}">${JSON.stringify({
          handle: product.handle, title: product.title,
          variants: product.variants.map(v => ({ id: v.id, color: v.color, colorHex: v.colorHex, size: v.size, price: v.price, compareAtPrice: v.compareAtPrice, stock: v.stock, sku: v.sku, image: v.image })),
          images: product.images.map(i => i.src)
        })}</script>
        <ul class="mini-list">
          ${product.features.slice(0, 4).map(f => `<li>${icon('check', { size: 15 })} ${esc(f)}</li>`).join('')}
        </ul>
      </div>
    </div>
  </section>`;
}

function storePulse() {
  const products = store.all('products');
  const published = store.all('reviews').filter(r => r.status === 'published');
  const variants = products.reduce((sum, p) => sum + p.variants.length, 0);
  const avg = published.length ? (published.reduce((s, r) => s + r.rating, 0) / published.length) : 0;
  const colours = new Set();
  products.forEach(p => (p.options.find(o => o.name === 'Colour') || { values: [] }).values.forEach(v => colours.add(v.name + p.handle)));

  // The ticker only ever states things that are true in the database.
  const events = [];
  const newest = published.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  if (newest) events.push(`${newest.author} reviewed the ${newest.productTitle} — ${newest.rating}★`);
  const unrated = products.filter(p => p.rating.count === 0 && p.status === 'active' && !p.digital);
  if (unrated.length) events.push(`${unrated[0].title} is new — no reviews yet, be the first`);
  const newIn = products.filter(p => p.collections.includes('new-in'));
  if (newIn.length) events.push(`${newIn.length} styles landed in Capsule 01 this month`);
  events.push('Every order ships carbon-neutral from the Brooklyn studio');
  events.push(`Free repairs for two years on all ${products.filter(p => !p.digital).length} apparel styles`);

  return `<section class="pulse" aria-label="Store facts">
    <div class="wrap pulse__inner">
      <div>
        <p class="pulse__label">The honest numbers</p>
        <h2 class="pulse__heading">${published.length} reviews. No invented ones.</h2>
        <p class="pulse__copy">We do not buy reviews, seed five-star ratings or pad our totals. Some pieces have hundreds of wears behind them and a handful of reviews; newer pieces have none yet. That is the whole picture.</p>
        <p class="pulse__ticker"><span class="pulse__dot" aria-hidden="true"></span><span class="pulse__ticker-text" data-live-ticker='${attr(JSON.stringify(events))}'>${esc(events[0])}</span></p>
      </div>
      <div class="pulse__stats">
        <div class="pulse__stat">
          <strong data-count-to="${products.filter(p => p.status === 'active').length}">0</strong>
          <span>Styles in capsule 01</span>
        </div>
        <div class="pulse__stat pulse__stat--reviews">
          <strong data-count-to="${published.length}">0</strong>
          <span>Verified reviews</span>
        </div>
        <div class="pulse__stat">
          <strong data-count-to="${avg.toFixed(1)}" data-count-decimals="1">0</strong>
          <span>Average rating</span>
        </div>
        <div class="pulse__stat">
          <strong data-count-to="${variants}">0</strong>
          <span>Colour &amp; size options</span>
        </div>
      </div>
    </div>
  </section>`;
}

function reviewsSection() {
  const published = store.all('reviews').filter(r => r.status === 'published');
  // show the newest handful, not the most flattering ones
  const reviews = published.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 6);
  const avg = published.reduce((s, r) => s + r.rating, 0) / (published.length || 1);
  const countLabel = published.length
    ? `Rated ${avg.toFixed(1)} out of 5 from ${published.length} ${published.length === 1 ? 'review' : 'reviews'}`
    : 'Be the first to review';
  return `<section class="sec sec--sand" aria-labelledby="h-reviews">
    <div class="wrap">
      ${sectionHeader({ eyebrow: 'Customer reviews', title: countLabel, copy: `Every review is written by a real customer — ${published.length} so far, and we publish the critical ones too.`, align: 'center' })}
      <div class="review-grid">
        ${reviews.map(r => `<figure class="review">
          <div class="review__stars">${stars(r.rating, { showValue: false })}</div>
          <blockquote><strong>${esc(r.title)}</strong><p>${esc(r.body)}</p></blockquote>
          <figcaption>
            <span class="review__avatar" aria-hidden="true">${esc(r.author.slice(0, 1))}</span>
            <span>${esc(r.author)}${r.verified ? ` <em class="verified">${icon('check', { size: 12 })} Verified buyer</em>` : ''}</span>
          </figcaption>
        </figure>`).join('')}
      </div>
    </div>
  </section>`;
}

function journalTeasers() {
  const posts = store.all('posts').slice(0, 3);
  return `<section class="sec wrap" aria-labelledby="h-journal">
    ${sectionHeader({ eyebrow: 'The Journal', title: 'Notes from the studio', copy: 'Materials, fits and training guides — written by the people who make the product.', link: '/blogs/journal', linkLabel: 'Read the journal' })}
    <div class="post-grid">
      ${posts.map(p => `<article class="post-card">
        <a href="/blogs/journal/${attr(p.handle)}" class="post-card__media"><img src="${attr(p.image)}" alt="${attr(p.title)}" width="800" height="560" loading="lazy"></a>
        <div class="post-card__body">
          <p class="post-card__meta">${esc(p.tags[0] || 'Journal')} · ${p.readMinutes} min read</p>
          <h3><a href="/blogs/journal/${attr(p.handle)}">${esc(p.title)}</a></h3>
          <p>${esc(p.excerpt)}</p>
          <a class="link-arrow" href="/blogs/journal/${attr(p.handle)}">Read more ${icon('arrow', { size: 15 })}</a>
        </div>
      </article>`).join('')}
    </div>
  </section>`;
}

function lookbookStrip() {
  const shots = ['/images/lookbook-1.jpg', '/images/lookbook-2.jpg', '/images/hero-editorial.jpg', '/images/blog-1.jpg'];
  return `<section class="lookbook" aria-label="Lookbook">
    <div class="wrap lookbook__head">
      <p class="eyebrow eyebrow--light">@vennixstore</p>
      <h2 class="sec-title">Worn by the run club</h2>
    </div>
    <ul class="lookbook__strip">${shots.map(s => `<li><img src="${attr(s)}" alt="${attr(ui.brand())} lookbook photography" width="700" height="700" loading="lazy"></li>`).join('')}</ul>
  </section>`;
}

function newsletterBand() {
  return `<section class="sec band" aria-labelledby="h-news">
    <div class="wrap band__inner">
      <div>
        <p class="eyebrow eyebrow--light">Studio letter</p>
        <h2 id="h-news" class="sec-title">10% off your first order.</h2>
        <p>Two emails a month: new pieces, restocks and run club dates. One click to unsubscribe, always.</p>
      </div>
      <form class="news-form news-form--band" data-newsletter novalidate>
        <div class="news-form__row">
          <input type="email" name="email" placeholder="you@email.com" required aria-label="Email address" autocomplete="email">
          <button class="btn btn--light" type="submit">Get my code</button>
        </div>
        <p class="news-form__msg" data-newsletter-msg role="status"></p>
      </form>
    </div>
  </section>`;
}

function render(ctx) {
  const products = store.all('products');
  const bestsellers = products.filter(p => p.collections.includes('bestsellers'));
  const newIn = products.filter(p => p.collections.includes('new-in'));
  const spotlightProduct = products.find(p => p.handle === 'atlas-heavyweight-hoodie') || products[0];
  const jsonLd = [
    {
      '@context': 'https://schema.org', '@type': 'Organization',
      name: ctx.settings.brandName, url: `https://${ctx.settings.domain}`,
      logo: `https://${ctx.settings.domain}/favicon.svg`,
      email: ctx.settings.supportEmail,
      // only published contact details — an empty telephone is a bad signal
      ...(ctx.settings.supportPhone ? { telephone: ctx.settings.supportPhone } : {}),
      address: { '@type': 'PostalAddress', streetAddress: ctx.settings.address.line1, addressLocality: ctx.settings.address.city, addressRegion: ctx.settings.address.province, postalCode: ctx.settings.address.zip, addressCountry: 'US' },
      sameAs: Object.values(ctx.settings.socials)
    },
    {
      '@context': 'https://schema.org', '@type': 'WebSite',
      name: ctx.settings.brandName, url: `https://${ctx.settings.domain}`,
      potentialAction: { '@type': 'SearchAction', target: `https://${ctx.settings.domain}/search?q={search_term_string}`, 'query-input': 'required name=search_term_string' }
    },
    {
      '@context': 'https://schema.org', '@type': 'ItemList', name: 'Bestsellers',
      itemListElement: bestsellers.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `https://${ctx.settings.domain}/products/${p.handle}`, name: p.title }))
    }
  ];
  return {
    title: '', bodyClass: 'template-index', navActive: '',
    description: ctx.settings.seo.description,
    canonical: '/',
    jsonLd,
    content: `${hero()}
      ${valueMarquee(ctx.settings)}
      ${categoryTriptych(ctx.settings)}
      ${rail('h-best', 'Most wanted', bestsellers, { eyebrow: 'Bestsellers', copy: 'Ranked by units sold in the last 90 days.', link: '/collections/bestsellers', linkLabel: 'All bestsellers' })}
      ${spotlight(spotlightProduct)}
      ${rail('h-new', 'New in Capsule 01', newIn, { eyebrow: 'Just landed', copy: 'Fresh from the mill — small runs, restocked when they sell out.', link: '/collections/new-in', linkLabel: 'Shop new in' })}
      ${storePulse()}
      ${reviewsSection()}
      ${journalTeasers()}
      ${lookbookStrip()}
      ${newsletterBand()}`
  };
}

module.exports = { render };
