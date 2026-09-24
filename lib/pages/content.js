'use strict';
/**
 * CMS pages, journal and gift cards.
 * Page prose and journal articles come from Shopify (pages + blog). The rich
 * template structure (about stats, FAQ accordions, size charts, contact form)
 * is the storefront's presentation layer. The gift-card page buys the store's
 * real Shopify gift-card product when one exists.
 */
const settings = require('../settings');
const meta = require('../content/meta');
const ui = require('../ui');
const security = require('../security');
const { nonceAttr } = require('../security');
const { esc, attr, icon, breadcrumbs, productGrid, sectionHeader, inputField } = ui;

const TOPICS = ['Order status', 'Return or exchange', 'Sizing & fit', 'Product question', 'Repairs', 'Wholesale', 'Press', 'Data request', 'Delete account', 'Something else'];

function aboutPage(ctx, page) {
  const stats = [
    { n: '2019', l: 'Founded in Brooklyn' },
    { n: '8', l: 'Styles in Capsule 01' },
    { n: '30', l: 'Wear-testers per release' },
    { n: '2 yr', l: 'Free repairs on everything' }
  ];
  return {
    content: `<section class="page-hero">
      <img src="/images/blog-1.jpg" alt="${attr(ui.brand())} studio" width="1800" height="820" loading="lazy">
      <div class="wrap page-hero__inner">
        ${breadcrumbs([{ label: 'Home', url: '/' }, { label: page.title }])}
        <h1>${esc(page.title)}</h1>
        <p>${esc(page.seo.description)}</p>
      </div>
    </section>
    <div class="wrap prose">
      ${page.body}
      <div class="stat-row stat-row--about">${stats.map(s => `<div class="stat"><strong>${esc(s.n)}</strong><em>${esc(s.l)}</em></div>`).join('')}</div>
      <h2 id="repairs">Repairs, not replacements</h2>
      <p>Send any ${esc(ui.brand())} piece back within two years and our studio team repairs seams, zips and elastics at no cost. In three years we have repaired 1,240 garments and replaced 96 — the rest went back into rotation.</p>
      <div class="cta-row">
        <a class="btn btn--primary" href="/collections/all">Shop Capsule 01</a>
        <a class="btn btn--outline" href="/pages/contact">Book a repair</a>
        <a class="btn btn--ghost" href="/blogs/journal">Read the journal</a>
      </div>
      <h2>Visit the studio</h2>
      <p>${esc(ctx.settings.address.line1)}, ${esc(ctx.settings.address.city)}, ${esc(ctx.settings.address.province)} ${esc(ctx.settings.address.zip)} · Thursday to Sunday, 11am–6pm. Run club leaves at 6:30am Tuesdays — all paces, no sign-up.</p>
    </div>`
  };
}

function faqPage(ctx, page) {
  const faqs = meta.FAQ_DEFS;
  const groups = [...new Set(faqs.map(f => f.group))];
  const jsonLd = [{
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } }))
  }];
  return {
    jsonLd,
    content: `<div class="wrap page-head">
      ${breadcrumbs([{ label: 'Home', url: '/' }, { label: page.title }])}
      <h1>${esc(page.title)}</h1>
      <p class="page-head__meta">${esc(page.seo.description)}</p>
    </div>
    <div class="wrap faq">
      <div class="faq__main">
        ${groups.map(g => `<section class="faq__group">
          <h2>${esc(g)}</h2>
          <div class="accordion">
            ${faqs.filter(f => f.group === g).map(f => `<details class="accordion__item">
              <summary><span>${esc(f.q)}</span>${icon('chevronDown', { size: 18 })}</summary>
              <div class="accordion__body"><p>${esc(f.a)}</p></div>
            </details>`).join('')}
          </div>
        </section>`).join('')}
      </div>
      <aside class="faq__aside">
        <div class="panel">
          <h2>Still stuck?</h2>
          <p class="muted">We reply within one business day — Mon–Fri, 9am–5pm EST.</p>
          <a class="btn btn--primary btn--block" href="/pages/contact">Contact support</a>
          <a class="btn btn--ghost btn--block" href="/track">Track an order</a>
        </div>
        <div class="panel">
          <h2>Popular help pages</h2>
          <ul class="link-list">
            <li><a href="/pages/shipping-returns">Shipping &amp; returns</a></li>
            <li><a href="/pages/size-guide">Size guide</a></li>
            <li><a href="/pages/accessibility">Accessibility</a></li>
            <li><a href="/pages/privacy">Privacy policy</a></li>
          </ul>
        </div>
      </aside>
    </div>`
  };
}

function sizePage(ctx, page) {
  const charts = meta.SIZE_CHARTS;
  return {
    content: `<div class="wrap page-head">
      ${breadcrumbs([{ label: 'Home', url: '/' }, { label: page.title }])}
      <h1>${esc(page.title)}</h1>
      <p class="page-head__meta">${esc(page.seo.description)}</p>
    </div>
    <div class="wrap prose">
      ${page.body}
      <section class="how-to-measure" aria-labelledby="how-to-measure-title">
        <h2 class="sr-only" id="how-to-measure-title">How to measure</h2>
        <div><span class="step-dot">1</span><h3>Chest</h3><p>Measure around the fullest part, keeping the tape level under the arms.</p></div>
        <div><span class="step-dot">2</span><h3>Waist</h3><p>Measure at the natural crease where you bend to the side, not at the hip.</p></div>
        <div><span class="step-dot">3</span><h3>Hip</h3><p>Stand with feet together and measure around the widest point.</p></div>
      </section>
      ${Object.values(charts).map(chart => `<section class="size-chart">
        <h2>${esc(chart.label)}</h2>
        <div class="table-wrap"><table class="table table--size">
          <thead><tr>${chart.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
          <tbody>${chart.rows.map(r => `<tr>${r.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>
      </section>`).join('')}
      <section class="size-notes">
        <h2>Fit notes from the product team</h2>
        <ul class="feature-list">
          <li>${icon('check', { size: 15 })} <strong>Atlas Hoodie</strong> — relaxed; size down for a closer fit.</li>
          <li>${icon('check', { size: 15 })} <strong>Everyday Pima Tee</strong> — classic; size up for a boxier body.</li>
          <li>${icon('check', { size: 15 })} <strong>Velocity Base Layer</strong> — athletic, sits close to the skin.</li>
          <li>${icon('check', { size: 15 })} <strong>Flow Legging</strong> — compressive; if between sizes, go up.</li>
          <li>${icon('check', { size: 15 })} <strong>Fleece Jogger</strong> — tapered regular, true to size.</li>
        </ul>
      </section>
      <div class="cta-row">
        <a class="btn btn--primary" href="/collections/all">Shop with confidence</a>
        <a class="btn btn--outline" href="/pages/contact?topic=Sizing+%26+fit">Ask us about sizing</a>
      </div>
    </div>`
  };
}

/**
 * Hidden CSRF field for server-rendered forms.
 *
 * ensureCsrfCookie() returns the visitor's existing token or mints one (and
 * sets the matching cookie on this response), so the first render and every
 * later render agree on the same value.
 */
function csrfField(ctx) {
  if (!ctx || !ctx.req) return '';
  const token = security.ensureCsrfCookie(ctx.req, ctx.res, { secure: security.isSecure(ctx.req) });
  return `<input type="hidden" name="${security.CSRF_FIELD}" value="${attr(token)}">`;
}

function contactPage(ctx, page, extra) {
  const prefill = {
    topic: ctx.query.topic || 'Order status',
    orderNumber: ctx.query.order || ''
  };
  return {
    content: `<div class="wrap page-head">
      ${breadcrumbs([{ label: 'Home', url: '/' }, { label: page.title }])}
      <h1>${esc(page.title)}</h1>
      <p class="page-head__meta">${esc(page.seo.description)}</p>
    </div>
    <div class="wrap contact">
      <div class="contact__form">
        ${extra && extra.notice ? `<div class="alert alert--ok" role="status">${icon('check', { size: 18 })}<div><strong>Thanks — your message is with the studio.</strong><p>${esc(extra.notice)}</p></div></div>` : ''}
        ${extra && extra.error ? `<div class="alert alert--error" role="alert">${icon('info', { size: 18 })}<div>${esc(extra.error)}</div></div>` : ''}
        <form class="panel" method="post" action="/pages/contact" data-contact-form>
          ${csrfField(ctx)}
          <h2>Send us a message</h2>
          ${page.body}
          <div class="field-row">
            ${inputField({ name: 'name', label: 'Your name', required: true, value: extra && extra.values ? extra.values.name : '', autocomplete: 'name' })}
            ${inputField({ name: 'email', label: 'Email address', type: 'email', required: true, value: extra && extra.values ? extra.values.email : '', autocomplete: 'email' })}
          </div>
          <div class="field-row">
            <label class="field"><span class="field__label">Topic</span>
              <select name="topic">${TOPICS.map(t => `<option value="${attr(t)}" ${prefill.topic === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
            </label>
            ${inputField({ name: 'orderNumber', label: 'Order number (optional)', value: extra && extra.values ? extra.values.orderNumber : prefill.orderNumber, placeholder: 'From your Shopify confirmation email' })}
          </div>
          <label class="field"><span class="field__label">Message <em>*</em></span><textarea name="message" rows="6" required placeholder="Tell us what you need — the more detail, the faster we can help.">${esc(extra && extra.values ? extra.values.message : '')}</textarea></label>
          <label class="check"><input type="checkbox" name="copyMe" checked><span>Email me a copy of this message</span></label>
          <button class="btn btn--primary btn--lg" type="submit">${icon('mail', { size: 16 })} Send message</button>
          <p class="muted">By sending you agree to our <a href="/pages/privacy">privacy policy</a>. We never share your details.</p>
        </form>
      </div>
      <aside class="contact__aside">
        <div class="panel">
          <h2>Studio details</h2>
          <ul class="contact-details">
            <li>${icon('mail', { size: 17 })}<div><strong>Email</strong><a href="mailto:${attr(ctx.settings.supportEmail)}">${esc(ctx.settings.supportEmail)}</a></div></li>
            ${ctx.settings.supportPhone ? `<li>${icon('phone', { size: 17 })}<div><strong>Phone</strong><a href="tel:${attr(ctx.settings.supportPhone.replace(/[^\d]/g, ''))}">${esc(ctx.settings.supportPhone)}</a></div></li>` : ''}
            <li>${icon('pin', { size: 17 })}<div><strong>Studio</strong>${esc(ctx.settings.address.line1)}, ${esc(ctx.settings.address.city)} ${esc(ctx.settings.address.province)} ${esc(ctx.settings.address.zip)}</div></li>
            <li>${icon('clock', { size: 17 })}<div><strong>Hours</strong>Mon–Fri 9am–5pm EST</div></li>
          </ul>
        </div>
        <div class="panel">
          <h2>Faster answers</h2>
          <ul class="link-list">
            <li><a href="/track">Track an order</a></li>
            <li><a href="/pages/shipping-returns">Start a return</a></li>
            <li><a href="/pages/size-guide">Size guide</a></li>
            <li><a href="/account">Your account</a></li>
          </ul>
        </div>
      </aside>
    </div>`
  };
}

function textPage(ctx, page) {
  return {
    content: `<div class="wrap page-head">
      ${breadcrumbs([{ label: 'Home', url: '/' }, { label: page.title }])}
      <h1>${esc(page.title)}</h1>
      <p class="page-head__meta">Last updated ${page.updatedAt ? new Date(page.updatedAt).toDateString() : ''}</p>
    </div>
    <div class="wrap prose prose--narrow">${page.body}
      <div class="cta-row"><a class="btn btn--outline" href="/pages/contact">Questions? Contact us</a><a class="btn btn--ghost" href="/collections/all">Back to shopping</a></div>
    </div>`
  };
}

function renderPage(ctx, handle) {
  const page = ctx.page;
  if (!page) return null;
  const template = { about: 'about', faq: 'faq', 'size-guide': 'size', contact: 'contact' }[handle] || 'text';
  const base = {
    title: page.title,
    description: page.seo.description,
    canonical: `/pages/${page.handle}`,
    bodyClass: `template-page template-page--${template}`,
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: `https://${ctx.settings.domain}/` }, { '@type': 'ListItem', position: 2, name: page.title, item: `https://${ctx.settings.domain}/pages/${page.handle}` }] }]
  };
  const partial = template === 'about' ? aboutPage(ctx, page)
    : template === 'faq' ? faqPage(ctx, page)
      : template === 'size' ? sizePage(ctx, page)
        : template === 'contact' ? contactPage(ctx, page, ctx.flash)
          : textPage(ctx, page);
  return { ...base, ...partial, jsonLd: [...base.jsonLd, ...(partial.jsonLd || [])] };
}

function renderJournal(ctx) {
  const posts = ctx.articles || [];
  if (!posts.length) {
    return {
      title: 'The Journal',
      description: `Notes from the ${ui.brand()} studio.`,
      canonical: '/blogs/journal',
      bodyClass: 'template-blog', jsonLd: [],
      content: `<div class="wrap page-head">
        ${breadcrumbs([{ label: 'Home', url: '/' }, { label: 'Journal' }])}
        <h1>The Journal</h1>
        <p class="page-head__meta">Journal posts published in the Shopify blog “${esc(settings.get().journalHandle)}” appear here.</p>
      </div>`
    };
  }
  const [lead, ...rest] = posts;
  return {
    title: 'The Journal',
    description: `Materials, fits and training guides from the ${ui.brand()} studio in Brooklyn.`,
    canonical: '/blogs/journal',
    bodyClass: 'template-blog',
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'Blog', name: `The ${ui.brand()} Journal`, url: `https://${ctx.settings.domain}/blogs/journal` }],
    content: `<div class="wrap page-head">
      ${breadcrumbs([{ label: 'Home', url: '/' }, { label: 'Journal' }])}
      <h1>The Journal</h1>
      <p class="page-head__meta">Notes from the studio — how we choose materials, cut fits and test the range before it ships.</p>
    </div>
    <div class="wrap">
      <article class="post-lead">
        <a href="/blogs/journal/${attr(lead.handle)}" class="post-lead__media"><img src="${attr(lead.image)}" alt="${attr(lead.title)}" width="1200" height="800" loading="lazy"></a>
        <div class="post-lead__body">
          <p class="post-card__meta">${esc(lead.tags[0] || 'Journal')} · ${lead.readMinutes} min read</p>
          <h2><a href="/blogs/journal/${attr(lead.handle)}">${esc(lead.title)}</a></h2>
          <p>${esc(lead.excerpt)}</p>
          <p class="muted">${esc(lead.author)} · ${new Date(lead.publishedAt).toDateString()}</p>
          <a class="btn btn--primary" href="/blogs/journal/${attr(lead.handle)}">Read the piece</a>
        </div>
      </article>
      <div class="post-grid post-grid--2">
        ${rest.map(p => `<article class="post-card">
          <a href="/blogs/journal/${attr(p.handle)}" class="post-card__media"><img src="${attr(p.image)}" alt="${attr(p.title)}" width="800" height="560" loading="lazy"></a>
          <div class="post-card__body">
            <p class="post-card__meta">${esc(p.tags[0] || 'Journal')} · ${p.readMinutes} min read</p>
            <h3><a href="/blogs/journal/${attr(p.handle)}">${esc(p.title)}</a></h3>
            <p>${esc(p.excerpt)}</p>
            <a class="link-arrow" href="/blogs/journal/${attr(p.handle)}">Read more ${icon('arrow', { size: 15 })}</a>
          </div>
        </article>`).join('')}
      </div>
    </div>`
  };
}

function renderPost(ctx, handle) {
  const post = ctx.article;
  if (!post) return null;
  const more = (ctx.articles || []).filter(p => p.handle !== handle).slice(0, 2);
  return {
    title: post.title,
    description: post.excerpt,
    canonical: `/blogs/journal/${post.handle}`,
    bodyClass: 'template-article',
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'BlogPosting', headline: post.title, description: post.excerpt, image: post.image.startsWith('http') ? post.image : `https://${ctx.settings.domain}${post.image}`, datePublished: post.publishedAt, author: { '@type': 'Organization', name: post.author }, publisher: { '@type': 'Organization', name: ctx.settings.brandName } }],
    content: `<article class="article">
      <div class="wrap article__head">
        ${breadcrumbs([{ label: 'Home', url: '/' }, { label: 'Journal', url: '/blogs/journal' }, { label: post.title }])}
        <p class="eyebrow">${esc(post.tags.join(' · '))}</p>
        <h1>${esc(post.title)}</h1>
        <p class="article__meta">${esc(post.author)} · ${new Date(post.publishedAt).toDateString()} · ${post.readMinutes} min read</p>
      </div>
      ${post.image ? `<figure class="article__hero"><img src="${attr(post.image)}" alt="${attr(post.imageAlt || post.title)}" width="1600" height="900" loading="lazy"></figure>` : ''}
      <div class="wrap prose prose--article">${post.body}</div>
    </article>
    <section class="sec wrap">
      ${sectionHeader({ eyebrow: 'Keep reading', title: 'More from the journal', link: '/blogs/journal', linkLabel: 'All articles' })}
      <div class="post-grid post-grid--2">
        ${more.map(p => `<article class="post-card">
          <a href="/blogs/journal/${attr(p.handle)}" class="post-card__media"><img src="${attr(p.image)}" alt="${attr(p.title)}" width="800" height="560" loading="lazy"></a>
          <div class="post-card__body"><p class="post-card__meta">${esc(p.tags[0] || 'Journal')} · ${p.readMinutes} min read</p><h3><a href="/blogs/journal/${attr(p.handle)}">${esc(p.title)}</a></h3><p>${esc(p.excerpt)}</p></div>
        </article>`).join('')}
      </div>
    </section>`
  };
}

/**
 * Gift cards. Buys the store's real Shopify gift-card product when one is
 * published; otherwise links to the store's own gift card page.
 */
function renderGiftCards(ctx) {
  const giftHandle = settings.get().giftCardProductHandle || 'gift-card';
  const gift = ctx.chrome.products.find(p => p.handle === giftHandle && (p.giftCard || p.digital));
  const bestsellers = ctx.chrome.products.filter(p => p.collections.includes('bestsellers') && !p.giftCard).slice(0, 3);
  const aside = `
    <section class="sec wrap">
      ${sectionHeader({ eyebrow: 'While you are here', title: 'Bestsellers they might want' })}
      ${productGrid(bestsellers)}
    </section>`;

  if (!gift || !gift.variants.length) {
    const s = settings.get();
    return {
      title: 'Gift cards',
      description: `${ui.brand()} digital gift cards — delivered by email, never expires.`,
      canonical: '/gift-cards', bodyClass: 'template-gift', jsonLd: [],
      content: `<div class="wrap page-head">
        ${breadcrumbs([{ label: 'Home', url: '/' }, { label: 'Gift cards' }])}
        <h1>Gift cards</h1>
        <p class="page-head__meta">Gift cards are sold and delivered by Shopify.</p>
      </div>
      <div class="wrap">
        <div class="panel" style="max-width:560px;margin:0 auto;text-align:center">
          ${icon('giftcard', { size: 30 })}
          <h2>Buy a ${esc(ui.brand())} gift card</h2>
          <p class="muted">Gift cards are delivered by email by Shopify — no expiry, usable on everything in the range. This store has not published a gift-card product yet.</p>
          <a class="btn btn--primary btn--lg" href="/collections/all">Shop the range instead</a>
        </div>
      </div>${aside}`
    };
  }

  const sorted = [...gift.variants].sort((a, b) => a.price - b.price);
  const defaultVariant = sorted[Math.min(1, sorted.length - 1)];
  return {
    title: 'Gift cards',
    description: `${ui.brand()} digital gift cards — delivered by email, never expires, works on everything including sale items.`,
    canonical: '/gift-cards',
    bodyClass: 'template-gift',
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'Product', name: gift.title, offers: sorted.map(d => ({ '@type': 'Offer', price: (d.price / 100).toFixed(2), priceCurrency: 'USD', availability: d.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock' })) }],
    content: `<div class="wrap page-head">
      ${breadcrumbs([{ label: 'Home', url: '/' }, { label: 'Gift cards' }])}
      <h1>Gift cards</h1>
      <p class="page-head__meta">Delivered by email within minutes. No expiry, usable on everything, including sale pieces.</p>
    </div>
    <div class="wrap gift">
      <div class="gift__card">
        <div class="gift__art" aria-hidden="true">
          <span class="brand__word">${ui.wordMark()}</span>
          <strong>GIFT CARD</strong>
          <em>studio.vennix</em>
        </div>
      </div>
      <form class="panel gift__form" data-add-form data-product="${attr(gift.handle)}">
        <h2>Choose an amount</h2>
        <fieldset class="picker">
          <legend>Value</legend>
          <div class="size-row">
            ${sorted.map(v => `<button type="button" class="size ${v.id === defaultVariant.id ? 'is-active' : ''}" data-size="${attr(v.size)}" data-variant="${attr(v.id)}" data-stock="${v.stock}" aria-pressed="${v.id === defaultVariant.id}" ${v.stock <= 0 ? 'disabled' : ''}>${esc(v.size)}</button>`).join('')}
          </div>
        </fieldset>
        <input type="hidden" name="variantId" value="${attr(defaultVariant.id)}" data-variant-input>
        <button class="btn btn--primary btn--lg btn--block" type="submit" data-add-submit>Add gift card · ${ui.money(defaultVariant.price)}</button>
        <p class="form-msg" data-form-msg role="status"></p>
        <script type="application/json" data-product-json="${attr(gift.handle)}"${nonceAttr()}>${JSON.stringify({
          handle: gift.handle, title: gift.title,
          variants: sorted.map(v => ({ id: v.id, color: v.color, size: v.size, price: v.price, compareAtPrice: v.compareAtPrice, stock: v.stock, sku: v.sku, image: v.image })),
          images: gift.images.map(i => i.src)
        })}</script>
        <ul class="feature-list">
          <li>${icon('check', { size: 15 })} Delivered by email via Shopify, no shipping cost</li>
          <li>${icon('check', { size: 15 })} Redeemable on everything in the range</li>
          <li>${icon('check', { size: 15 })} Never expires · balance checked at checkout</li>
        </ul>
      </form>
      <aside class="gift__aside">
        <div class="panel">
          <h2>How it works</h2>
          <ol class="steps">
            <li><span>1</span> Pick an amount and add it to your cart.</li>
            <li><span>2</span> Check out through Shopify — gift cards ship instantly by email.</li>
            <li><span>3</span> They redeem it at checkout with the code in the email.</li>
          </ol>
        </div>
        <div class="panel">
          <h2>Prefer a physical card?</h2>
          <p class="muted">Stop by the studio at ${esc(ctx.settings.address.line1)}, Brooklyn — we keep letterpress cards behind the counter.</p>
        </div>
      </aside>
    </div>
    ${aside}`
  };
}

function render404(ctx) {
  const picks = ctx.chrome.products.filter(p => p.inventoryQuantity > 0 && !p.hidden).slice(0, 4);
  return {
    title: 'Page not found',
    description: 'That page does not exist — here are some places to go instead.',
    canonical: '/404',
    bodyClass: 'template-404',
    jsonLd: [],
    content: `<div class="wrap page-head page-head--404">
      <p class="eyebrow">Error 404</p>
      <h1>We could not find that page.</h1>
      <p class="page-head__meta">The link may be old, or the product may have sold through. Nothing is broken on your end.</p>
      <form class="search-page-form" role="search" action="/search" method="get">
        <input type="search" name="q" placeholder="Search the store…" aria-label="Search">
        <button class="btn btn--primary" type="submit">Search</button>
      </form>
      <div class="cta-row">
        <a class="btn btn--primary" href="/collections/all">Shop all products</a>
        <a class="btn btn--outline" href="/collections/bestsellers">Bestsellers</a>
        <a class="btn btn--ghost" href="/pages/faq">Help &amp; FAQ</a>
      </div>
    </div>
    <section class="sec wrap">
      ${sectionHeader({ eyebrow: 'Popular', title: 'Maybe one of these' })}
      ${productGrid(picks)}
    </section>`
  };
}

module.exports = { renderPage, renderJournal, renderPost, renderGiftCards, render404, TOPICS };
