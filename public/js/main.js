/* ==========================================================================
   Vennix Athletic — storefront client
   Everything talks to the server-authoritative JSON API (/api/*).
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function fmt(cents) {
    var n = (Math.round(cents || 0) / 100).toFixed(2);
    return '$' + n.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /* CSRF: the server mints a vnx_csrf cookie on every page; every POST echoes
     it back in a header (double-submit). Cookies are SameSite=Lax too — this is
     the second lock, not the only one. */
  function csrfToken() {
    var match = /(?:^|; )vnx_csrf=([^;]+)/.exec(document.cookie || '');
    return match ? decodeURIComponent(match[1]) : '';
  }

  function api(path, data) {
    var headers = { 'Content-Type': 'application/json' };
    var token = csrfToken();
    if (token) headers['X-CSRF-Token'] = token;
    return fetch('/api' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: headers,
      body: data === undefined ? undefined : JSON.stringify(data)
    }).then(function (r) { return r.json().catch(function () { return { ok: false, error: 'Unexpected server response.' }; }); });
  }

  window.vennixCsrfToken = csrfToken;

  /* Per-tab id. The server uses it (with ip + user agent) to recognise the
     parallel requests of one click-burst, so a first add-to-cart never spawns
     two carts. It is a random value, not an identity, and it dies with the tab. */
  (function sessionId() {
    try {
      if (/(?:^|; )vnx_sid=/.test(document.cookie || '')) return;
      var sid = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : String(Date.now()) + Math.random().toString(16).slice(2);
      document.cookie = 'vnx_sid=' + encodeURIComponent(sid) + '; Path=/; SameSite=Lax' +
        (location.protocol === 'https:' ? '; Secure' : '');
    } catch (error) { /* cookies disabled: the server falls back to ip + user agent */ }
  })();

  /* --------------------------------------------------------------- toasts */
  function toast(message, kind, linkHref, linkText) {
    var wrap = $('[data-toasts]');
    if (!wrap) return;
    var el = document.createElement('div');
    el.className = 'toast toast--' + (kind || 'ok');
    el.setAttribute('role', 'status');
    el.innerHTML = '<span>' + message + '</span>' +
      (linkHref ? '<a class="toast__link" href="' + linkHref + '">' + (linkText || 'View') + '</a>' : '');
    wrap.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('is-in'); });
    setTimeout(function () {
      el.classList.remove('is-in');
      setTimeout(function () { el.remove(); }, 350);
    }, 4600);
  }
  window.vennixToast = toast;

  /* ---------------------------------------------------- panels & overlays */
  var overlay = $('[data-overlay]');
  var openPanels = [];

  function lockBody(state) { document.body.classList.toggle('is-locked', state); }

  function showOverlay(show) {
    if (!overlay) return;
    if (show) { overlay.hidden = false; requestAnimationFrame(function () { overlay.classList.add('is-open'); }); }
    else { overlay.classList.remove('is-open'); setTimeout(function () { overlay.hidden = true; }, 280); }
  }

  function openPanel(el) {
    if (!el) return;
    el.hidden = false;
    requestAnimationFrame(function () { el.classList.add('is-open'); });
    if (openPanels.indexOf(el) === -1) openPanels.push(el);
    lockBody(true); showOverlay(true);
    var focusable = el.querySelector('input, button, a[href]');
    if (focusable) setTimeout(function () { focusable.focus(); }, 300);
  }

  function closePanel(el) {
    if (!el) return;
    el.classList.remove('is-open');
    openPanels = openPanels.filter(function (p) { return p !== el; });
    setTimeout(function () { el.hidden = true; }, 320);
    if (!openPanels.length && !$('.quickview.is-open') && !$('.mob-menu.is-open')) { lockBody(false); showOverlay(false); }
  }

  closePanel.all = function () { [].concat(openPanels).forEach(closePanel); };

  if (overlay) overlay.addEventListener('click', function () { closePanel.all(); closeMobileMenu(); });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    closePanel.all();
    closeMobileMenu();
    closeSearch();
    closeQuickView();
  });

  /* --------------------------------------------------- announcement + header */
  (function announce() {
    var bar = $('[data-announce]');
    var items = $$('[data-announce-item]');
    if (items.length > 1) {
      var i = 0;
      setInterval(function () {
        items[i].classList.remove('is-active');
        i = (i + 1) % items.length;
        items[i].classList.add('is-active');
      }, 5200);
    }
    var close = $('[data-announce-close]');
    if (close && bar) close.addEventListener('click', function () {
      bar.classList.add('is-hidden');
      try { sessionStorage.setItem('vnx_announce', '1'); } catch (e) { /* ignore */ }
    });
    try { if (sessionStorage.getItem('vnx_announce') && bar) bar.classList.add('is-hidden'); } catch (e) { /* ignore */ }
  })();

  (function headerScroll() {
    var head = $('[data-header]');
    var progress = $('[data-header-progress] span');
    var bar = $('[data-header-progress]');
    if (!head) return;
    function onScroll() {
      var y = window.scrollY || 0;
      head.classList.toggle('is-scrolled', y > 8);
      if (progress && bar && document.body.scrollHeight > window.innerHeight) {
        var pct = Math.min(100, (y / (document.body.scrollHeight - window.innerHeight)) * 100);
        progress.style.width = pct + '%';
        bar.hidden = y < 6;
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  })();

  /* ---------------------------------------------------------------- mobile */
  var mobMenu = $('[data-menu]');
  function closeMobileMenu() {
    if (mobMenu && mobMenu.classList.contains('is-open')) {
      mobMenu.classList.remove('is-open');
      setTimeout(function () { mobMenu.hidden = true; }, 320);
      if (!openPanels.length) { lockBody(false); showOverlay(false); }
    }
  }
  $$('[data-menu-open]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      mobMenu.hidden = false;
      requestAnimationFrame(function () { mobMenu.classList.add('is-open'); });
      lockBody(true); showOverlay(true);
      btn.setAttribute('aria-expanded', 'true');
    });
  });
  $$('[data-menu-close]').forEach(function (b) { b.addEventListener('click', closeMobileMenu); });

  /* mega menu (touch/click) */
  $$('[data-mega-trigger]').forEach(function (trigger) {
    trigger.addEventListener('click', function (e) {
      var li = trigger.parentElement;
      if (window.matchMedia('(hover: none)').matches) {
        e.preventDefault();
        li.classList.toggle('is-open');
        trigger.setAttribute('aria-expanded', li.classList.contains('is-open') ? 'true' : 'false');
      }
    });
  });

  /* ---------------------------------------------------------------- search */
  var searchPanel = $('[data-search]');
  var searchInput = $('[data-search-input]');
  var searchResults = $('[data-search-results]');
  var defaultSearchHTML = searchResults ? searchResults.innerHTML : '';

  function openSearch() {
    if (!searchPanel) return;
    // restore the default panel (recent searches slot) whenever it was
    // replaced by a previous result set
    if (searchResults && searchInput && !searchInput.value.trim() && defaultSearchHTML) {
      searchResults.innerHTML = defaultSearchHTML;
    }
    searchPanel.hidden = false;
    requestAnimationFrame(function () { searchPanel.classList.add('is-open'); });
    lockBody(true);
    document.dispatchEvent(new Event('vennix:search-open'));
    if (searchInput) setTimeout(function () { searchInput.focus(); }, 120);
  }
  function closeSearch() {
    if (searchPanel && searchPanel.classList.contains('is-open')) {
      searchPanel.classList.remove('is-open');
      setTimeout(function () { searchPanel.hidden = true; }, 300);
      lockBody(false);
    }
  }
  $$('[data-search-open]').forEach(function (b) { b.addEventListener('click', openSearch); });
  $$('[data-search-close]').forEach(function (b) { b.addEventListener('click', closeSearch); });

  if (searchInput && searchResults) {
    var timer = null;
    searchInput.addEventListener('input', function () {
      var q = searchInput.value.trim();
      clearTimeout(timer);
      if (!q) { searchResults.innerHTML = defaultSearchHTML; return; }
      timer = setTimeout(function () {
        api('/search?q=' + encodeURIComponent(q)).then(function (res) {
          if (!res.ok) return;
          var html = '';
          if (res.products && res.products.length) {
            html += '<div class="sr-group"><h3>Products</h3><div class="sr-grid">' + res.products.map(function (p) {
              return '<a class="sr-item" href="' + p.url + '"><img src="' + p.image + '" alt="" width="58" height="70" loading="lazy">' +
                '<span><strong>' + p.title + '</strong><span>' + p.type + ' · ' + p.price + (p.available ? '' : ' · Sold out') + '</span></span></a>';
            }).join('') + '</div></div>';
          }
          if (res.collections && res.collections.length) {
            html += '<div class="sr-group"><h3>Collections</h3><div class="sr-grid">' + res.collections.map(function (c) {
              return '<a class="sr-item" href="' + c.url + '"><span><strong>' + c.title + '</strong><span>' + c.count + ' products</span></span></a>';
            }).join('') + '</div></div>';
          }
          if (res.articles && res.articles.length) {
            html += '<div class="sr-group"><h3>Journal</h3>' + res.articles.map(function (a) {
              return '<a class="sr-link" href="' + a.url + '"><strong>' + a.title + '</strong></a>';
            }).join('') + '</div>';
          }
          // Escape the raw query before splicing it into HTML to prevent
          // DOM XSS if the user (or a crafted URL) types HTML into the field.
          var safeQ = q.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
          searchResults.innerHTML = html || '<p class="sr-empty">Nothing matched “' + safeQ + '”. Try “hoodie”, “legging” or “base layer”.</p>';
        });
      }, 200);
    });
  }

  /* ------------------------------------------------------------------ cart */
  function paintCart(res) {
    if (!res || !res.ok) return;
    var h = res.html || {};
    var previous = parseInt(($('[data-cart-count]') || {}).textContent, 10) || 0;
    $$('[data-cart-count]').forEach(function (el) {
      el.textContent = h.count;
      el.hidden = String(h.count) === '0';
    });
    var next = parseInt(h.count, 10) || 0;
    if (next !== previous) {
      document.dispatchEvent(new CustomEvent('vennix:cart', { detail: { count: next, delta: next - previous } }));
    }
    var drawerBody = $('[data-cart-body]');
    if (drawerBody && h.drawer) drawerBody.innerHTML = h.drawer;
    var foot = $('[data-cart-foot]');
    if (foot) foot.hidden = String(h.count) === '0';
    var sub = $('[data-cart-subtotal]'); if (sub && h.subtotal) sub.textContent = h.subtotal;
    var tot = $('[data-cart-total]'); if (tot && h.total) tot.textContent = h.total;
    var dc = $('[data-drawer-count]');
    if (dc) dc.textContent = h.count + (String(h.count) === '1' ? ' item' : ' items');
    var msg = $('.drawer__ship-msg');
    if (msg && h.shipMsg) msg.innerHTML = h.shipMsg;
    var bar = $('.drawer__ship .bar span');
    if (bar && h.shipPct !== undefined) bar.style.width = h.shipPct + '%';
    // cart page + summary reflections
    var pageSub = $('[data-sum-subtotal]'); if (pageSub) pageSub.textContent = h.subtotal || pageSub.textContent;
    var pageTotal = $('[data-sum-total]'); if (pageTotal) pageTotal.textContent = h.total || pageTotal.textContent;
    if (res.cart) {
      // shipping + taxes are calculated by Shopify at checkout; only paint
      // them if the server ever provides real numbers (null = "calculated
      // at checkout" text stays untouched).
      if (typeof res.cart.shipping === 'number') {
        var ship = $('[data-sum-shipping]');
        if (ship) ship.textContent = res.cart.shipping === 0 ? 'Free' : fmt(res.cart.shipping);
      }
      if (typeof res.cart.tax === 'number') {
        var tax = $('[data-sum-tax]');
        if (tax) tax.textContent = fmt(res.cart.tax);
      }
      var place = $('[data-place-total]');
      if (place) place.textContent = fmt(res.cart.total);
      if (res.cart.discountCode) {
        var discRow = document.querySelector('.totals__discount');
        var totals = document.querySelector('.totals');
        if (!discRow && totals) {
          // the page rendered without a discount — create the row in place
          discRow = document.createElement('div');
          discRow.className = 'totals__discount';
          discRow.innerHTML = '<dt></dt><dd></dd>';
          var shipRow = null;
          $$('div', totals).forEach(function (r) {
            var dt = r.querySelector('dt');
            if (dt && /shipping/i.test(dt.textContent)) shipRow = r;
          });
          if (shipRow) totals.insertBefore(discRow, shipRow);
          else totals.appendChild(discRow);
        }
        if (discRow) {
          discRow.hidden = false;
          discRow.querySelector('dt').textContent = 'Discount · ' + res.cart.discountCode;
          discRow.querySelector('dd').textContent = '−' + fmt(res.cart.discountAmount);
        }
      } else {
        $$('.totals__discount').forEach(function (row) { row.hidden = true; });
      }
      paintWishCounts();
    }
  }

  function addToCart(variantId, quantity, opts) {
    opts = opts || {};
    var button = opts.button;
    if (button) { button.disabled = true; var label = button.innerHTML; button.innerHTML = 'Adding…'; }
    var body = { variantId: variantId, quantity: quantity || 1 };
    if (opts.personalization) body.personalization = opts.personalization;
    if (opts.items) return addMany(opts.items, opts);
    return api('/cart/add', body)
      .then(function (res) {
        if (!res.ok) { toast(res.error || 'Could not add to cart.', 'error'); return res; }
        paintCart(res);
        toast('Added to your cart.', 'ok', '/checkout', 'Checkout');
        // let the motion layer fly the product image to the cart and pop the badge
        document.dispatchEvent(new CustomEvent('vennix:added', { detail: {
          variantId: variantId,
          button: button,
          source: opts.source || null
        } }));
        if (opts.openDrawer !== false) openPanel($('[data-cart-drawer]'));
        return res;
      })
      .finally(function () {
        if (!button) return;
        button.disabled = false;
        // only put the original label back if nothing repainted it in the
        // meantime — a monogram toggle mid-request must not be overwritten
        if (button.innerHTML.indexOf('Adding') === 0) button.innerHTML = label;
      });
  }

  $$('[data-cart-open]').forEach(function (b) { b.addEventListener('click', function () { openPanel($('[data-cart-drawer]')); }); });
  $$('[data-drawer-close]').forEach(function (b) { b.addEventListener('click', function () { closePanel($('[data-cart-drawer]')); }); });

  document.addEventListener('click', function (e) {
    var target = e.target.closest('[data-add-variant], [data-line-inc], [data-line-dec], [data-line-remove], [data-helpful], [data-print], [data-wish-open], [data-wish-close]');
    if (!target) return;

    if (target.hasAttribute('data-add-variant')) {
      e.preventDefault();
      addToCart(target.getAttribute('data-add-variant'), 1, { button: target });
      return;
    }
    if (target.hasAttribute('data-print')) { window.print(); return; }
    if (target.hasAttribute('data-wish-open')) { openPanel($('[data-wish-panel]')); renderWishPanel(); return; }
    if (target.hasAttribute('data-wish-close')) { closePanel($('[data-wish-panel]')); return; }

    if (target.hasAttribute('data-line-inc') || target.hasAttribute('data-line-dec')) {
      e.preventDefault();
      var lineId = target.getAttribute('data-line-inc') || target.getAttribute('data-line-dec');
      var input = $('[data-line-qty="' + lineId + '"]');
      var qty = Math.max(0, (Number(input && input.value) || 1) + (target.hasAttribute('data-line-inc') ? 1 : -1));
      if (input) input.value = qty;
      api('/cart/update', { lineId: lineId, quantity: qty }).then(function (res) {
        if (!res.ok) toast(res.error || 'Could not update quantity.', 'error');
        paintCart(res);
        if (res.ok && res.cart) refreshCartPageLine(res, lineId, qty);
      });
      return;
    }
    if (target.hasAttribute('data-line-remove')) {
      e.preventDefault();
      var id = target.getAttribute('data-line-remove');
      api('/cart/remove', { lineId: id }).then(function (res) {
        if (!res.ok) { toast(res.error || 'Could not remove item.', 'error'); return; }
        var row = document.querySelector('.cart-page__line[data-line="' + id + '"]');
        if (row) row.remove();
        paintCart(res);
        toast('Item removed.', 'ok');
        if (res.cart && res.cart.count === 0) window.location.reload();
      });
      return;
    }
    if (target.hasAttribute('data-helpful')) {
      e.preventDefault();
      api('/reviews/helpful/' + target.getAttribute('data-helpful'), {}).then(function (res) {
        if (!res.ok) return;
        target.innerHTML = target.innerHTML.replace(/\((\d+)\)/, '(' + res.helpful + ')');
        target.disabled = true;
      });
    }
  });

  /* qty inputs on cart page & drawer */
  document.addEventListener('change', function (e) {
    var input = e.target.closest('[data-line-qty]');
    if (!input) return;
    var lineId = input.getAttribute('data-line-qty');
    api('/cart/update', { lineId: lineId, quantity: Number(input.value) }).then(function (res) {
      if (!res.ok) { toast(res.error || 'Could not update quantity.', 'error'); }
      paintCart(res);
      if (res.ok && res.cart) refreshCartPageLine(res, lineId, Number(input.value));
    });
  });

  function refreshCartPageLine(res, lineId, qty) {
    var row = document.querySelector('.cart-page__line[data-line="' + lineId + '"]');
    if (!row || !res.cart) return;
    var line = (res.cart.lines || []).filter(function (l) { return l.id === lineId; })[0];
    if (!line) return;
    var priceEl = row.querySelector('.cart-page__price strong');
    if (priceEl) priceEl.textContent = fmt(line.price * line.quantity);
  }

  /* discount forms (cart page + checkout) */
  $$('[data-discount-form]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = form.querySelector('input[name="code"]');
      var msg = form.querySelector('[data-form-msg]');
      var removing = input.readOnly;
      api('/cart/discount', { code: input.value, remove: removing }).then(function (res) {
        if (!res.ok) {
          if (msg) { msg.textContent = res.error; msg.className = 'form-msg is-error'; }
          toast(res.error || 'That code did not work.', 'error');
          return;
        }
        paintCart(res);
        if (msg) { msg.textContent = removing ? 'Code removed.' : 'Discount applied.'; msg.className = 'form-msg is-ok'; }
        toast(removing ? 'Discount removed.' : 'Discount applied.', 'ok');
        input.readOnly = !removing;
        form.querySelector('button').textContent = removing ? 'Apply' : 'Remove';
      });
    });
  });

  $$('[data-fill-code]').forEach(function (b) {
    b.addEventListener('click', function () {
      var form = b.closest('[data-discount-form]');
      if (!form) return;
      form.querySelector('input[name="code"]').value = b.getAttribute('data-fill-code');
      form.querySelector('input[name="code"]').focus();
    });
  });

  /* gift + order notes */
  $$('[data-gift-note], [data-order-note]').forEach(function (field) {
    field.addEventListener('blur', function () {
      var payload = {};
      if (field.hasAttribute('data-gift-note')) payload.giftNote = field.value;
      if (field.hasAttribute('data-order-note')) payload.note = field.value;
      api('/cart/note', payload).then(function (res) {
        if (res.ok) toast('Saved to your order.', 'ok');
      });
    });
  });

  /* ----------------------------------------------------------- quick view */
  function closeQuickView() {
    var qv = $('[data-quickview]');
    if (qv && qv.classList.contains('is-open')) {
      qv.classList.remove('is-open');
      setTimeout(function () { qv.hidden = true; }, 260);
      if (!openPanels.length) { lockBody(false); showOverlay(false); }
    }
  }
  document.addEventListener('click', function (e) {
    var trigger = e.target.closest('[data-quickadd]');
    if (trigger) {
      e.preventDefault();
      var qv = $('[data-quickview]');
      var panel = $('[data-quickview-panel]');
      panel.innerHTML = '<button class="icon-btn quickview__close" type="button" data-quickview-close aria-label="Close">×</button><div class="quickview__loading">Loading ' + trigger.getAttribute('data-quickadd') + '…</div>';
      qv.hidden = false;
      requestAnimationFrame(function () { qv.classList.add('is-open'); });
      lockBody(true);
      api('/quickview/' + trigger.getAttribute('data-quickadd')).then(function (res) {
        if (!res.ok) { panel.innerHTML = '<div class="quickview__loading">' + (res.error || 'Could not load product') + '</div>'; return; }
        panel.innerHTML = '<button class="icon-btn quickview__close" type="button" data-quickview-close aria-label="Close">' +
          '<svg class="ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>' + res.html;
        initProductForms(panel);
      });
      return;
    }
    if (e.target.closest('[data-quickview-close]') || (e.target.matches('[data-quickview]'))) { closeQuickView(); }
  });

  /* ------------------------------------------------------------- wishlist */
  var WISH_KEY = 'vnx_wishlist';
  function getWish() {
    try { return JSON.parse(localStorage.getItem(WISH_KEY) || '[]'); } catch (e) { return []; }
  }
  function setWish(list) {
    try { localStorage.setItem(WISH_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
    paintWishCounts();
  }
  function paintWishCounts() {
    var count = getWish().length;
    $$('[data-wish-count]').forEach(function (el) {
      el.textContent = count;
      el.hidden = count === 0;
    });
    $$('[data-wish]').forEach(function (el) {
      var on = getWish().indexOf(el.getAttribute('data-wish')) !== -1;
      el.classList.toggle('is-active', on);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
      var label = el.querySelector('[data-wish-label]');
      if (label) label.textContent = on ? 'Saved to wishlist' : 'Save for later';
    });
  }
  function toggleWish(handle) {
    if (!handle) return;
    var list = getWish();
    var idx = list.indexOf(handle);
    if (idx === -1) { list.push(handle); toast('Saved to your wishlist.', 'ok', '/account/wishlist', 'View list'); }
    else { list.splice(idx, 1); toast('Removed from your wishlist.', 'ok'); }
    setWish(list);
    renderWishPanel();
  }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-wish]');
    if (!btn) return;
    e.preventDefault();
    toggleWish(btn.getAttribute('data-wish'));
  });

  function catalogIndex() {
    var el = $('[data-catalog-index]');
    if (!el) return [];
    try { return JSON.parse(el.textContent); } catch (e) { return []; }
  }

  function renderWishPanel() {
    var body = $('[data-wish-body]');
    if (!body) return;
    var index = catalogIndex();
    var list = getWish().map(function (h) { return index.filter(function (p) { return p.handle === h; })[0]; }).filter(Boolean);
    if (!list.length) {
      body.innerHTML = '<div class="wish-empty"><p>Nothing saved yet.</p><p>Tap the heart on any product to keep it here.</p><a class="btn btn--primary btn--sm" href="/collections/all">Browse the range</a></div>';
      return;
    }
    body.innerHTML = list.map(function (p) {
      return '<div class="wish-item"><img src="' + p.image + '" alt="" width="84" height="100" loading="lazy">' +
        '<div><a href="' + p.url + '"><strong>' + p.title + '</strong></a><span class="muted">' + fmt(p.price) + '</span></div>' +
        '<div><button class="btn btn--mini btn--primary" type="button" data-add-variant="' + p.variant + '">Add</button>' +
        '<button class="btn btn--mini btn--ghost" type="button" data-wish="' + p.handle + '">Remove</button></div></div>';
    }).join('');
  }

  function renderWishGrid() {
    var grid = $('[data-wish-grid]');
    if (!grid) return;
    var index = catalogIndex();
    var list = getWish().map(function (h) { return index.filter(function (p) { return p.handle === h; })[0]; }).filter(Boolean);
    if (!list.length) {
      grid.outerHTML = '<div class="empty-state"><h3>Nothing saved yet</h3><p>Tap the heart on any product page to build your list.</p><a class="btn btn--primary" href="/collections/all">Shop the range</a></div>';
      return;
    }
    grid.innerHTML = list.map(function (p, i) {
      return '<article class="pcard" style="--i:' + i + '"><div class="pcard__media"><a class="pcard__link" href="' + p.url + '">' +
        '<img class="pcard__img" src="' + p.image + '" alt="' + p.title + '" width="800" height="800" loading="lazy"></a></div>' +
        '<div class="pcard__body"><div class="pcard__row"><h3 class="pcard__title"><a href="' + p.url + '">' + p.title + '</a></h3><span class="price">' + fmt(p.price) + '</span></div>' +
        '<p class="pcard__meta">' + (p.tagline || p.type) + '</p>' +
        '<div class="pcard__foot"><button class="btn btn--mini btn--primary" type="button" data-add-variant="' + p.variant + '">Add to cart</button>' +
        '<button class="btn btn--mini btn--ghost" type="button" data-wish="' + p.handle + '">Remove</button></div></div></article>';
    }).join('');
  }

  /* ------------------------------------------------- product form engines */
  function productData(form) {
    var handle = form.getAttribute('data-product');
    var el = document.querySelector('[data-product-json="' + handle + '"]');
    if (!el) return null;
    try { return JSON.parse(el.textContent); } catch (e) { return null; }
  }

  function initProductForms(root) {
    $$('[data-add-form]', root).forEach(function (form) {
      if (form.dataset.ready === '1') return;
      form.dataset.ready = '1';
      var data = productData(form);
      var hidden = form.querySelector('[data-variant-input]');
      var state = { color: null, size: null };
      var monogram = initMonogram(form);
      function monoState() { return monogram ? monogram.get() : null; }
      // toggling or typing a monogram has to re-price the button immediately
      document.addEventListener('vennix:monogram', paint);

      function currentVariant() {
        if (!data || !hidden) return null;
        return data.variants.filter(function (v) { return v.id === hidden.value; })[0] || null;
      }

      function paint() {
        var variant = currentVariant();
        if (!variant) return;
        var colorLabel = form.querySelector('[data-color-label]');
        if (colorLabel) colorLabel.textContent = variant.color;
        var sizeLabel = form.querySelector('[data-size-label]');
        if (sizeLabel) sizeLabel.textContent = variant.size;
        var submit = form.querySelector('[data-add-submit]');
        if (submit) {
          var label = submit.querySelector('[data-atc-label]');
          // the button has to quote what will actually be charged, monogram included
          var mono = monoState();
          var extra = mono && mono.active && mono.text ? mono.price : 0;
          var money = fmt(variant.price + extra);
          var text = variant.stock > 0 ? 'Add to cart · ' + money + (extra ? ' · ' + mono.label : '') : 'Sold out';
          if (label) label.textContent = text;
          else submit.textContent = text;
          submit.disabled = variant.stock <= 0;
        }
        var pill = form.querySelector('[data-stock-pill]');
        if (pill) {
          pill.className = 'stock-pill' + (variant.stock <= 0 ? ' is-out' : variant.stock <= 5 ? ' is-low' : '');
          pill.textContent = variant.stock > 5 ? 'In stock — ships today' : variant.stock > 0 ? 'Only ' + variant.stock + ' left' : 'Sold out in this size';
        }
        // only offer the alert when there is genuinely nothing to buy
        // (it sits outside the form — see lib/pages/product.js)
        var notify = document.querySelector('[data-notify]');
        if (notify) {
          notify.hidden = variant.stock > 0;
          var lead = notify.querySelector('[data-notify-lead]');
          if (lead && variant.stock <= 0) {
            lead.textContent = variant.color + ' / ' + variant.size + ' is sold out. Leave your email and we will tell you the moment it is back.';
          }
        }
        var stickyVariant = document.querySelector('[data-sticky-variant]');
        if (stickyVariant) stickyVariant.textContent = variant.color + ' · ' + variant.size;
        var stickyPrice = document.querySelector('.sticky-atc__price');
        if (stickyPrice) stickyPrice.textContent = fmt(variant.price);
        // gallery image swap
        if (data.images && data.images.length) {
          var stage = document.querySelector('[data-gallery]');
          if (stage) {
            var activeIdx = state.color && variant.image ? data.images.indexOf(variant.image) : -1;
            if (activeIdx === -1 && data.images.indexOf(variant.image) !== -1) activeIdx = data.images.indexOf(variant.image);
            if (activeIdx > -1) activateSlide(activeIdx);
          }
        }
      }

      function refreshSizes() {
        $$('[data-size]', form).forEach(function (btn) {
          if (!data) return;
          var sizeName = btn.getAttribute('data-size');
          var match = data.variants.filter(function (v) { return v.color === state.color && v.size === sizeName; })[0];
          btn.setAttribute('data-variant', match ? match.id : '');
          btn.setAttribute('data-stock', match ? match.stock : 0);
          var out = !match || match.stock <= 0;
          // kept selectable: the sold-out state is a route to the stock alert,
          // not a dead end. Adding to cart is what gets blocked, further down.
          btn.classList.toggle('is-out', out);
          btn.setAttribute('aria-disabled', out ? 'true' : 'false');
          if (out) btn.setAttribute('title', 'Sold out — set an alert');
          else btn.removeAttribute('title');
        });
      }

      $$('[data-color]', form).forEach(function (btn) {
        btn.addEventListener('click', function () {
          state.color = btn.getAttribute('data-color');
          $$('[data-color]', form).forEach(function (b) {
            b.classList.toggle('is-active', b === btn);
            b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
          });
          refreshSizes();
          // pick the first available size in this colour
          var available = $$('[data-size]', form).filter(function (b) { return !b.classList.contains('is-out'); });
          var preferred = available.filter(function (b) { return b.classList.contains('is-active') && !b.disabled; })[0] || available[0];
          if (preferred) {
            $$('[data-size]', form).forEach(function (b) { b.classList.remove('is-active'); });
            preferred.classList.add('is-active');
            if (hidden) hidden.value = preferred.getAttribute('data-variant');
          }
          paint();
        });
      });

      $$('[data-size]', form).forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (!btn.getAttribute('data-variant')) return;
          $$('[data-size]', form).forEach(function (b) {
            b.classList.toggle('is-active', b === btn);
            b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
          });
          state.size = btn.getAttribute('data-size');
          if (hidden) hidden.value = btn.getAttribute('data-variant');
          paint();
        });
      });

      // quantity stepper
      var qtyInput = form.querySelector('[data-qty-input]');
      var inc = form.querySelector('[data-qty-inc]');
      var dec = form.querySelector('[data-qty-dec]');
      if (inc && qtyInput) inc.addEventListener('click', function () { qtyInput.value = Math.min(20, (Number(qtyInput.value) || 1) + 1); });
      if (dec && qtyInput) dec.addEventListener('click', function () { qtyInput.value = Math.max(1, (Number(qtyInput.value) || 1) - 1); });

      // submit
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var variantId = hidden ? hidden.value : null;
        if (!variantId) { toast('Choose a size first.', 'error'); return; }
        var mono = monoState();
        if (mono && mono.active && !mono.text) { toast('Add your characters, or switch monogramming off.', 'error'); return; }
        addToCart(variantId, qtyInput ? Number(qtyInput.value) || 1 : 1, {
          button: form.querySelector('[data-add-submit]'),
          openDrawer: !form.closest('.quickview'),
          personalization: mono && mono.active && mono.text ? { text: mono.text } : null
        });
      });

      var buyNow = form.querySelector('[data-buy-now]');
      if (buyNow) buyNow.addEventListener('click', function () {
        var variantId = hidden ? hidden.value : null;
        if (!variantId) { toast('Choose a size first.', 'error'); return; }
        buyNow.disabled = true;
        addToCart(variantId, qtyInput ? Number(qtyInput.value) || 1 : 1, { openDrawer: false }).then(function (res) {
          buyNow.disabled = false;
          if (res && res.ok) window.location.href = '/checkout';
        });
      });

      paint();
    });
  }

  initProductForms(document);

  /* gallery */
  function activateSlide(i) {
    $$('[data-slide]').forEach(function (s) { s.classList.toggle('is-active', Number(s.getAttribute('data-slide')) === i); });
    $$('[data-thumb]').forEach(function (t) { t.classList.toggle('is-active', Number(t.getAttribute('data-thumb')) === i); });
  }
  document.addEventListener('click', function (e) {
    var thumb = e.target.closest('[data-thumb]');
    if (thumb) { activateSlide(Number(thumb.getAttribute('data-thumb'))); return; }
    var zoom = e.target.closest('[data-gallery-zoom]');
    if (zoom) {
      var stage = document.querySelector('.gallery__stage');
      stage.classList.toggle('is-zoomed');
      zoom.textContent = stage.classList.contains('is-zoomed') ? 'Reset zoom' : 'Zoom';
      return;
    }
    var sg = e.target.closest('[data-sizeguide-open]');
    if (sg) { e.preventDefault(); openSizeGuide(); }
  });

  function openSizeGuide() {
    var modal = document.createElement('div');
    modal.className = 'quickview is-open';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = '<div class="quickview__panel" style="max-width:820px"><button class="icon-btn quickview__close" type="button" data-sg-close aria-label="Close">' +
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>' +
      '<div class="quickview__info"><h2>Size &amp; fit guide</h2><p class="muted">Loading measurements…</p></div></div>';
    document.body.appendChild(modal);
    lockBody(true);
    modal.addEventListener('click', function (ev) {
      if (ev.target === modal || ev.target.closest('[data-sg-close]')) { modal.remove(); lockBody(false); }
    });
    fetch('/pages/size-guide').then(function (r) { return r.text(); }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var charts = doc.querySelectorAll('.size-chart');
      var notes = doc.querySelector('.size-notes');
      var body = doc.querySelector('.how-to-measure');
      var host = modal.querySelector('.quickview__info');
      host.innerHTML = '<h2>Size &amp; fit guide</h2>' +
        (charts.length ? Array.prototype.map.call(charts, function (c) { return c.outerHTML; }).join('') : '<p class="muted">See the full size guide.</p>') +
        (body ? body.outerHTML : '') + (notes ? notes.outerHTML : '') +
        '<a class="btn btn--outline btn--sm" href="/pages/size-guide">Open full guide</a>';
    });
  }

  /* sticky add-to-cart */
  (function stickyAtc() {
    var bar = $('[data-sticky-atc]');
    var form = $('.product-form');
    if (!bar || !form) return;
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var show = !entry.isIntersecting && entry.boundingClientRect.top < 0;
        bar.classList.toggle('is-visible', show);
        bar.hidden = !show;
      });
    }, { threshold: 0 });
    observer.observe(form);
    var add = bar.querySelector('[data-sticky-add]');
    if (add) add.addEventListener('click', function () {
      var hidden = form.querySelector('[data-variant-input]');
      if (!hidden) return;
      addToCart(hidden.value, 1, { button: add });
    });
  })();

  /* recently viewed */
  (function recentlyViewed() {
    var box = $('[data-recently-viewed]');
    var grid = $('[data-recently-viewed-grid]');
    var form = $('[data-add-form][data-product]');
    if (!grid || !form) return;
    var handle = form.getAttribute('data-product');
    var KEY = 'vnx_recent';
    var list = [];
    try { list = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { list = []; }
    list = [handle].concat(list.filter(function (h) { return h !== handle; })).slice(0, 8);
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
    var index = catalogIndex();
    var others = list.slice(1).map(function (h) { return index.filter(function (p) { return p.handle === h; })[0]; }).filter(Boolean);
    if (!others.length) return;
    box.hidden = false;
    grid.innerHTML = others.map(function (p, i) {
      return '<article class="pcard" style="--i:' + i + '"><div class="pcard__media"><a class="pcard__link" href="' + p.url + '">' +
        '<img class="pcard__img" src="' + p.image + '" alt="' + p.title + '" width="800" height="800" loading="lazy"></a></div>' +
        '<div class="pcard__body"><div class="pcard__row"><h3 class="pcard__title"><a href="' + p.url + '">' + p.title + '</a></h3><span class="price">' + fmt(p.price) + '</span></div>' +
        '<p class="pcard__meta">' + (p.tagline || p.type) + '</p></div></article>';
    }).join('');
  })();

  /* ------------------------------------------------------------ collections */
  $$('[data-filter-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var panel = document.querySelector('[data-filter-panel]');
      var open = panel.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) { lockBody(true); showOverlay(true); } else { lockBody(false); showOverlay(false); }
    });
  });
  $$('[data-auto-submit]').forEach(function (sel) {
    sel.addEventListener('change', function () { sel.form.submit(); });
  });
  $$('[data-filters]').forEach(function (form) {
    form.addEventListener('change', function (e) {
      if (e.target.type === 'radio') {
        clearTimeout(form._t);
        form._t = setTimeout(function () { form.submit(); }, 220);
      }
    });
  });
  $$('[data-rail]').forEach(function (rail) {
    var track = rail.querySelector('[data-rail-track]');
    var prev = rail.querySelector('[data-rail-prev]');
    var next = rail.querySelector('[data-rail-next]');
    var step = function () { return Math.max(260, track.clientWidth * 0.8); };
    if (prev) prev.addEventListener('click', function () { track.scrollBy({ left: -step(), behavior: 'smooth' }); });
    if (next) next.addEventListener('click', function () { track.scrollBy({ left: step(), behavior: 'smooth' }); });
  });

  /* Checkout lives in Shopify — the storefront hands off via /checkout (302). */

  /* account helpers — order history lives in the Shopify-hosted account */
  document.addEventListener('click', function (e) {
    var reorderItem = e.target.closest('[data-reorder-item]');
    if (reorderItem) {
      addToCart(reorderItem.getAttribute('data-reorder-item'), 1, { button: reorderItem });
    }
  });

  /* newsletter + contact via API (progressive enhancement) */
  $$('[data-newsletter]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = form.querySelector('input[name="email"]');
      var msg = form.querySelector('[data-newsletter-msg]');
      api('/newsletter', { email: input.value, source: form.closest('.band') ? 'homepage band' : 'footer' }).then(function (res) {
        if (msg) { msg.textContent = res.ok ? res.message : res.error; msg.className = 'news-form__msg ' + (res.ok ? 'is-ok' : 'is-error'); }
        if (res.ok) { input.value = ''; toast('You are on the list.', 'ok'); }
        else toast(res.error || 'Check that email address.', 'error');
      });
    });
  });

  $$('[data-contact-form]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = {};
      new FormData(form).forEach(function (value, key) { data[key] = value; });
      api('/contact', data).then(function (res) {
        toast(res.ok ? res.message : res.error, res.ok ? 'ok' : 'error');
        if (res.ok) form.reset();
      });
    });
  });

  /* review form */
  $$('[data-review-form]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = {};
      new FormData(form).forEach(function (v, k) { data[k] = v; });
      data.handle = form.getAttribute('data-product');
      api('/reviews', data).then(function (res) {
        var msg = form.querySelector('[data-form-msg]');
        if (msg) { msg.textContent = res.ok ? res.message : res.error; msg.className = 'form-msg ' + (res.ok ? 'is-ok' : 'is-error'); }
        toast(res.ok ? 'Review submitted for moderation.' : res.error, res.ok ? 'ok' : 'error');
        if (res.ok) form.reset();
      });
    });
  });

  /* ------------------------------------------------------------------ *
   * Add several lines at once — "add the whole look", and any future
   * bundle. One sold-out piece never discards the rest of the basket.
   * ------------------------------------------------------------------ */
  function addMany(items, opts) {
    opts = opts || {};
    var button = opts.button;
    if (button) { button.disabled = true; var label = button.innerHTML; button.innerHTML = 'Adding…'; }
    return api('/cart/add', { items: items })
      .then(function (res) {
        if (button) { button.disabled = false; if (button.innerHTML.indexOf('Adding') === 0) button.innerHTML = label; }
        if (!res.ok) { toast(res.error || 'Could not add those pieces.', 'error'); return res; }
        paintCart(res);
        var failed = res.failed || [];
        if (failed.length) {
          toast(failed.length + ' of ' + items.length + ' could not be added — ' + failed[0].error, 'error');
        } else {
          toast(items.length + ' pieces added to your cart.', 'ok', '/checkout', 'Checkout');
        }
        document.dispatchEvent(new CustomEvent('vennix:added', { detail: { button: button, source: button } }));
        if (opts.openDrawer !== false) openPanel($('[data-cart-drawer]'));
        return res;
      });
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-add-look]');
    if (!btn) return;
    e.preventDefault();
    var items = [];
    try { items = JSON.parse(btn.getAttribute('data-add-look')); } catch (err) { items = []; }
    if (!items.length) return;
    addMany(items.map(function (i) { return { variantId: i.variantId, quantity: 1 }; }), { button: btn });
  });

  /* ------------------------------------------------------------------ *
   * Monogramming — optional, priced per unit, previewed live, and
   * carried into the cart as part of the line item.
   * ------------------------------------------------------------------ */
  function initMonogram(form) {
    var box = form.querySelector('[data-monogram]');
    if (!box) return null;
    var toggle = box.querySelector('[data-monogram-toggle]');
    var body = box.querySelector('[data-monogram-body]');
    var input = box.querySelector('[data-monogram-input]');
    var preview = box.querySelector('[data-monogram-preview]');
    var max = Number(box.getAttribute('data-max')) || 3;
    var price = Number(box.getAttribute('data-price')) || 0;
    var label = box.getAttribute('data-label') || 'Monogram';
    var state = { active: false, text: '', price: 0, label: label };

    function clean(value) {
      return String(value || '').toUpperCase().replace(/[^A-Z0-9.&'\- ]/g, '').replace(/\s{2,}/g, ' ').trim().slice(0, max);
    }

    function paint() {
      var next = input ? clean(input.value) : '';
      if (input && input.value !== next) {
        var caret = input.selectionStart;
        input.value = next;
        try { input.setSelectionRange(caret, caret); } catch (err) { /* ignore */ }
      }
      state.active = !!(toggle && toggle.checked);
      state.text = state.active ? next : '';
      state.price = state.active && next ? price : 0;
      if (body) body.hidden = !state.active;
      if (toggle) toggle.setAttribute('aria-expanded', String(state.active));
      if (preview) {
        preview.textContent = next || new Array(max + 1).join('·');
        preview.classList.toggle('is-empty', !next);
      }
      box.classList.toggle('is-active', state.active);
      document.dispatchEvent(new CustomEvent('vennix:monogram', { detail: state }));
    }

    if (toggle) toggle.addEventListener('change', function () { paint(); if (state.active && input) input.focus(); });
    if (input) {
      input.addEventListener('input', paint);
      input.addEventListener('blur', paint);
    }
    paint();
    return { get: function () { return state; }, paint: paint };
  }

  /* ------------------------------------------------------------------ *
   * Size finder — server-side recommendation, applied straight to the
   * size picker so the customer never has to scroll back up.
   * ------------------------------------------------------------------ */
  (function sizeFinder() {
    var panel = $('[data-fit-panel]');
    var form = $('[data-fit-form]');
    if (!panel || !form) return;
    var result = $('[data-fit-result]', panel);
    var msg = $('[data-fit-msg]', panel);
    var STORE_KEY = 'vnx_fit_profile';

    function units() {
      var checked = form.querySelector('input[name="units"]:checked');
      return checked ? checked.value : 'imperial';
    }

    function syncUnits() {
      var metric = units() === 'metric';
      var imperialBox = $('[data-units-imperial]', panel);
      var metricBox = $('[data-units-metric]', panel);
      if (imperialBox) imperialBox.hidden = metric;
      if (metricBox) metricBox.hidden = !metric;
      var weightLabel = $('[data-weight-unit]', panel);
      if (weightLabel) weightLabel.textContent = metric ? 'Kilograms' : 'Pounds';
      var input = form.querySelector('input[name="weight"]');
      if (input) {
        if (metric && Number(input.value) > 220) input.value = Math.round(Number(input.value) / 2.20462);
        if (!metric && Number(input.value) < 70) input.value = Math.round(Number(input.value) * 2.20462);
      }
    }

    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (err) { saved = null; }
    if (saved && saved.units === 'metric') {
      var metricRadio = form.querySelector('input[name="units"][value="metric"]');
      if (metricRadio) metricRadio.checked = true;
      if (saved.heightCm) form.querySelector('input[name="heightCm"]').value = saved.heightCm;
      if (saved.weight) form.querySelector('input[name="weight"]').value = saved.weight;
    } else if (saved) {
      if (saved.heightFt) form.querySelector('input[name="heightFt"]').value = saved.heightFt;
      if (saved.heightIn) form.querySelector('input[name="heightIn"]').value = saved.heightIn;
      if (saved.weight) form.querySelector('input[name="weight"]').value = saved.weight;
    }
    if (saved && saved.preference) {
      var pref = form.querySelector('input[name="preference"][value="' + saved.preference + '"]');
      if (pref) pref.checked = true;
    }
    syncUnits();
    $$('input[name="units"]', form).forEach(function (radio) { radio.addEventListener('change', syncUnits); });

    $$('[data-fit-open]').forEach(function (btn) {
      btn.addEventListener('click', function () { openPanel(panel); });
    });
    $$('[data-fit-close]').forEach(function (btn) {
      btn.addEventListener('click', function () { closePanel(panel); });
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = { handle: form.getAttribute('data-product'), units: units(), preference: (form.querySelector('input[name="preference"]:checked') || {}).value || 'true' };
      if (data.units === 'metric') {
        data.height = Number(form.querySelector('input[name="heightCm"]').value);
      } else {
        var ft = Number(form.querySelector('input[name="heightFt"]').value) || 0;
        var inch = Number(form.querySelector('input[name="heightIn"]').value) || 0;
        data.height = ft * 12 + inch;
      }
      data.weight = Number(form.querySelector('input[name="weight"]').value);
      var usual = form.querySelector('select[name="usualSize"]');
      data.usualSize = usual ? usual.value : '';

      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({
          units: data.units, heightFt: form.querySelector('input[name="heightFt"]') ? form.querySelector('input[name="heightFt"]').value : null,
          heightIn: form.querySelector('input[name="heightIn"]') ? form.querySelector('input[name="heightIn"]').value : null,
          heightCm: form.querySelector('input[name="heightCm"]') ? form.querySelector('input[name="heightCm"]').value : null,
          weight: data.weight, preference: data.preference
        }));
      } catch (err) { /* ignore */ }

      if (msg) { msg.textContent = 'Working it out…'; msg.className = 'form-msg'; }
      api('/fit', data).then(function (res) {
        if (!res.ok) {
          if (msg) { msg.textContent = res.error; msg.className = 'form-msg is-error'; }
          return;
        }
        if (msg) { msg.textContent = ''; msg.className = 'form-msg'; }
        render(res.fit);
      });
    });

    function render(f) {
      if (!result) return;
      var confidence = { high: 'Confident', medium: 'Close call', low: 'Ask the studio' }[f.confidence] || 'Estimate';
      result.hidden = false;
      result.innerHTML = '<div class="fit__verdict fit__verdict--' + f.confidence + '">' +
        '<p class="eyebrow">' + confidence + '</p>' +
        '<p class="fit__size">We suggest <strong>' + f.size + '</strong></p>' +
        '<p class="fit__conf">' + f.confidenceCopy + '</p>' +
        '<ul class="fit__reasons">' + f.reasons.map(function (r) { return '<li>' + r + '</li>'; }).join('') + '</ul>' +
        (f.inStock ? '' : '<p class="fit__warn">That size is out of stock right now — we can email you when it lands.</p>') +
        '<div class="fit__actions">' +
          '<button class="btn btn--primary" type="button" data-fit-apply="' + f.size + '">Select ' + f.size + '</button>' +
          (f.suggestions && f.suggestions.length > 1 ? '<span class="fit__also">Also worth trying: ' + f.suggestions.filter(function (s) { return s !== f.size; }).join(', ') + '</span>' : '') +
        '</div></div>';
    }

    document.addEventListener('click', function (e) {
      var apply = e.target.closest('[data-fit-apply]');
      if (!apply) return;
      var size = apply.getAttribute('data-fit-apply');
      var btn = document.querySelector('[data-size="' + size + '"]');
      if (btn && !btn.disabled) {
        btn.click();
        var picker = btn.closest('.picker');
        if (picker) picker.scrollIntoView({ behavior: 'smooth', block: 'center' });
        toast('Size ' + size + ' selected — adjust it any time.', 'ok');
        closePanel(panel);
      } else {
        toast('That size is not available in this colour.', 'error');
      }
    });
  })();

  /* ------------------------------------------------------------------ *
   * Back-in-stock alerts. Deliberately its own page-level form: it must not
   * be nested inside the add-to-cart form, which is invalid HTML and breaks
   * the outer form's parsing.
   * ------------------------------------------------------------------ */
  (function backInStock() {
    var box = $('[data-notify]');
    var notifyForm = $('[data-notify-form]');
    if (!box || !notifyForm) return;

    notifyForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var emailInput = notifyForm.querySelector('input[name="email"]');
      var msg = notifyForm.querySelector('[data-notify-msg]');
      var hiddenVariant = document.querySelector('[data-add-form] [data-variant-input]');
      if (!hiddenVariant || !hiddenVariant.value) {
        if (msg) { msg.textContent = 'Choose a size first.'; msg.className = 'form-msg is-error'; }
        return;
      }
      api('/notify', { email: emailInput ? emailInput.value : '', variantId: hiddenVariant.value }).then(function (res) {
        if (msg) { msg.textContent = res.ok ? res.message : res.error; msg.className = 'form-msg ' + (res.ok ? 'is-ok' : 'is-error'); }
        if (res.ok) { toast('You are on the list.', 'ok'); notifyForm.reset(); }
        else toast(res.error || 'Could not save that.', 'error');
      });
    });
  })();

  /* ------------------------------------------------------------------ *
   * Collections: "load more" without leaving the page. The paginated
   * links stay in the markup, so this only ever enhances the crawlable
   * version of the page.
   * ------------------------------------------------------------------ */
  (function loadMore() {
    var btn = $('[data-load-more]');
    var grid = document.querySelector('.collection__main .grid--products');
    if (!btn || !grid) return;
    var nextUrl = btn.getAttribute('data-next');
    btn.hidden = false;

    btn.addEventListener('click', function () {
      if (!nextUrl || btn.disabled) return;
      btn.disabled = true;
      var original = btn.innerHTML;
      btn.innerHTML = 'Loading…';
      fetch(nextUrl, { credentials: 'same-origin', headers: (function () { var t = csrfToken(); return t ? { 'X-CSRF-Token': t } : {}; })() })
        .then(function (r) { return r.text(); })
        .then(function (html) {
          var doc = new DOMParser().parseFromString(html, 'text/html');
          var incoming = doc.querySelectorAll('.collection__main .grid--products > *');
          if (incoming.length) {
            Array.prototype.forEach.call(incoming, function (node) { grid.appendChild(node); });
            document.dispatchEvent(new CustomEvent('vennix:content-added', { detail: { count: incoming.length, container: grid } }));
          }
          var nextBtn = doc.querySelector('[data-load-more]');
          var count = doc.querySelector('.toolbar__count');
          if (nextBtn && nextBtn.getAttribute('data-next')) {
            nextUrl = nextBtn.getAttribute('data-next');
            btn.innerHTML = original;
            btn.disabled = false;
          } else {
            btn.remove();
          }
          if (count) {
            var live = document.querySelector('.toolbar__count');
            if (live) live.textContent = count.textContent;
          }
        })
        .catch(function () {
          btn.innerHTML = original;
          btn.disabled = false;
          toast('Could not load more right now.', 'error');
        });
    });
  })();

  /* ------------------------------------------------------------------ *
   * Search: remember what this visitor actually looked for.
   * ------------------------------------------------------------------ */
  (function recentSearches() {
    var input = $('[data-search-input]');
    if (!input || !$('[data-recent-searches]')) return;
    var KEY = 'vnx_searches';

    function read() {
      try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (err) { return []; }
    }

    function remember(term) {
      var clean = String(term || '').trim();
      if (clean.length < 2) return;
      var list = read().filter(function (t) { return t.toLowerCase() !== clean.toLowerCase(); });
      list.unshift(clean);
      try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 5))); } catch (err) { /* ignore */ }
      paint();
    }

    function paint() {
      // re-query: the results container may have been re-rendered since boot
      var host = $('[data-recent-searches]');
      if (!host) return;
      var list = read();
      if (!list.length) { host.hidden = true; host.innerHTML = ''; return; }
      host.hidden = false;
      host.innerHTML = '<h3>Your recent searches</h3><ul class="chip-list">' +
        list.map(function (t) { return '<li><a class="chip" href="/search?q=' + encodeURIComponent(t) + '">' + t.replace(/[<>&"]/g, '') + '</a></li>'; }).join('') +
        '<li><button class="chip chip--clear" type="button" data-clear-searches>Clear</button></li></ul>';
    }

    var form = $('[data-search-form]');
    if (form) form.addEventListener('submit', function () { remember(input.value); });
    document.addEventListener('vennix:search-open', paint);
    document.addEventListener('click', function (e) {
      var clear = e.target.closest('[data-clear-searches]');
      if (!clear) return;
      try { localStorage.removeItem(KEY); } catch (err) { /* ignore */ }
      paint();
    });
    paint();
  })();

  /* boot */
  paintWishCounts();
  renderWishPanel();
  renderWishGrid();
})();
