/* ==========================================================================
   Vennix — Online Store 2.0 theme behaviour
   Cart API · drawers · predictive search · variant pickers · quick view
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var routes = window.routes || {};
  var money = function (cents) {
    return '$' + (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };
  var debounce = function (fn, wait) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, wait);
    };
  };

  /* ------------------------------- toasts ------------------------------- */
  function toast(title, body, link) {
    var wrap = $('[data-toasts]');
    if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toasts'; wrap.setAttribute('data-toasts', ''); document.body.appendChild(wrap); }
    var el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.innerHTML = '<strong></strong><span></span>';
    $('strong', el).textContent = title;
    $('span', el).textContent = body || '';
    if (link) {
      var a = document.createElement('a');
      a.href = link.href; a.textContent = link.label || 'View';
      el.appendChild(a);
    }
    wrap.appendChild(el);
    setTimeout(function () { el.style.opacity = '0'; setTimeout(function () { el.remove(); }, 300); }, 4200);
  }
  window.vennixToast = toast;

  /* ------------------------------- drawers ------------------------------ */
  function openEl(el) { if (el) { el.hidden = false; document.body.classList.add('no-scroll'); } }
  function closeEl(el) { if (el) { el.hidden = true; document.body.classList.remove('no-scroll'); } }

  function cartDrawer() { return $('[data-cart-drawer]'); }
  function overlay() { return $('[data-overlay]'); }
  function openCart() { openEl(cartDrawer()); openEl(overlay()); }
  function closeAll() {
    closeEl(cartDrawer()); closeEl(overlay()); closeEl($('[data-menu]')); closeEl($('[data-search]'));
    document.body.classList.remove('no-scroll');
  }

  document.addEventListener('click', function (event) {
    var t = event.target.closest('[data-cart-open],[data-cart-close],[data-overlay],[data-menu-open],[data-menu-close],[data-search-open],[data-search-close],[data-announcement-close],[data-share],[data-quick-view],[data-media-thumb],[data-media-zoom],[data-filters-toggle],[data-address-form-open],[data-address-form-close],[data-recover-open],[data-recover-close],[data-rail-next],[data-rail-prev],[data-size-guide-open]');
    if (!t) return;

    if (t.hasAttribute('data-cart-open')) { event.preventDefault(); openCart(); }
    else if (t.hasAttribute('data-cart-close') || t.hasAttribute('data-overlay') || t.hasAttribute('data-menu-close') || t.hasAttribute('data-search-close')) { event.preventDefault(); closeAll(); }
    else if (t.hasAttribute('data-menu-open')) { event.preventDefault(); openEl($('[data-menu]')); openEl(overlay()); }
    else if (t.hasAttribute('data-search-open')) { event.preventDefault(); openEl($('[data-search]')); var i = $('[data-predictive-search-input]'); if (i) setTimeout(function () { i.focus(); }, 60); }
    else if (t.hasAttribute('data-announcement-close')) { var bar = t.closest('[data-announcement-bar]'); if (bar) bar.remove(); }
    else if (t.hasAttribute('data-share')) {
      var data = { title: t.getAttribute('data-share-title'), url: t.getAttribute('data-share-url') };
      if (navigator.share) navigator.share(data).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(data.url).then(function () { toast('Link copied', data.url); });
    } else if (t.hasAttribute('data-media-thumb')) { showMedia(t.getAttribute('data-media-thumb')); }
    else if (t.hasAttribute('data-media-zoom')) { var slide = $('.product__slide.is-active img'); if (slide) window.open(slide.src, '_blank'); }
    else if (t.hasAttribute('data-filters-toggle')) { var f = $('[data-filters]'); if (f) { f.classList.toggle('is-open'); t.setAttribute('aria-expanded', f.classList.contains('is-open')); } }
    else if (t.hasAttribute('data-address-form-open')) { var form = document.getElementById(t.getAttribute('data-form-id')); if (form) form.hidden = false; }
    else if (t.hasAttribute('data-address-form-close')) { var wrap = t.closest('.address-form'); if (wrap) wrap.hidden = true; }
    else if (t.hasAttribute('data-recover-open')) { event.preventDefault(); $('#login').hidden = true; $('#recover').hidden = false; }
    else if (t.hasAttribute('data-recover-close')) { event.preventDefault(); $('#recover').hidden = true; $('#login').hidden = false; }
    else if (t.hasAttribute('data-rail-next') || t.hasAttribute('data-rail-prev')) {
      var rail = t.closest('section') ? $('[data-rail]', t.closest('section')) : null;
      if (rail) rail.scrollBy({ left: (t.hasAttribute('data-rail-next') ? 1 : -1) * Math.min(rail.clientWidth * 0.8, 640), behavior: 'smooth' });
    } else if (t.hasAttribute('data-size-guide-open')) {
      event.preventDefault();
      window.open('/pages/size-guide', 'size-guide', 'width=760,height=820');
    }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAll(); });

  function showMedia(index) {
    $$('[data-media-slide]').forEach(function (slide) { slide.classList.toggle('is-active', slide.getAttribute('data-media-slide') === String(index)); });
    $$('[data-media-thumb]').forEach(function (thumb) { thumb.classList.toggle('is-active', thumb.getAttribute('data-media-thumb') === String(index)); });
  }

  /* ----------------------------- announcement --------------------------- */
  (function announcement() {
    var bar = $('[data-announcement-bar]');
    if (!bar) return;
    var items = $$('[data-announcement-item]', bar);
    var speed = parseInt(bar.getAttribute('data-rotate-speed'), 10) || 0;
    if (items.length < 2 || speed <= 0) return;
    var i = 0;
    setInterval(function () {
      items[i].classList.remove('is-active');
      i = (i + 1) % items.length;
      items[i].classList.add('is-active');
    }, speed);
  })();

  /* -------------------------------- header ------------------------------ */
  (function stickyHeader() {
    var header = $('[data-header]');
    if (!header) return;
    var onScroll = function () { header.classList.toggle('is-scrolled', window.scrollY > 20); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  })();

  (function megaMenu() {
    $$('[data-mega-trigger]').forEach(function (trigger) {
      var item = trigger.closest('li');
      item.addEventListener('mouseenter', function () { item.classList.add('is-open'); trigger.setAttribute('aria-expanded', 'true'); });
      item.addEventListener('mouseleave', function () { item.classList.remove('is-open'); trigger.setAttribute('aria-expanded', 'false'); });
    });
  })();

  /* ---------------------------- predictive search ----------------------- */
  (function predictiveSearch() {
    var input = $('[data-predictive-search-input]');
    var results = $('[data-predictive-search-results]');
    if (!input || !results) return;
    var hint = results.innerHTML;

    var render = function (data) {
      if (!data || !data.resources) { results.innerHTML = hint; return; }
      var html = '';
      if (data.resources.results && data.resources.results.products && data.resources.results.products.length) {
        html += '<div class="predictive-search__group"><h3>Products</h3>';
        data.resources.results.products.slice(0, 6).forEach(function (p) {
          html += '<a class="predictive-search__hit" href="' + p.url + '">' +
            (p.featured_image && p.featured_image.url ? '<img src="' + p.featured_image.url + '&width=120" width="54" height="68" alt="">' : '<span></span>') +
            '<div><strong>' + p.title + '</strong><span>' + (p.price ? money(p.price) : '') + '</span></div>' +
            '<span>' + (p.available === false ? (window.strings.soldOut || 'Sold out') : '→') + '</span></a>';
        });
        html += '</div>';
      }
      if (data.resources.results && data.resources.results.articles && data.resources.results.articles.length) {
        html += '<div class="predictive-search__group"><h3>Journal</h3>';
        data.resources.results.articles.slice(0, 3).forEach(function (a) {
          html += '<a class="predictive-search__hit" href="' + a.url + '"><span></span><div><strong>' + a.title + '</strong></div><span>→</span></a>';
        });
        html += '</div>';
      }
      if (data.resources.results && data.resources.results.queries && data.resources.results.queries.length) {
        html += '<div class="predictive-search__group"><h3>Suggestions</h3>';
        data.resources.results.queries.slice(0, 4).forEach(function (q) {
          html += '<a class="predictive-search__hit" href="/search?q=' + encodeURIComponent(q.text) + '"><span></span><div><strong>' + q.text + '</strong></div><span>→</span></a>';
        });
        html += '</div>';
      }
      results.innerHTML = html || '<p class="skeleton">No matches — try another word.</p>';
    };

    input.addEventListener('input', debounce(function () {
      var q = input.value.trim();
      if (q.length < 2) { results.innerHTML = hint; return; }
      results.innerHTML = '<p class="skeleton">Searching…</p>';
      fetch(routes.predictive_search_url + '.json?q=' + encodeURIComponent(q) + '&resources[type]=product,article,query&resources[limit]=6&section_id=predictive-search')
        .then(function (r) { return r.json(); })
        .then(render)
        .catch(function () { results.innerHTML = '<p class="skeleton">Search is unavailable right now.</p>'; });
    }, 220));
  })();

  /* --------------------------- variant pickers -------------------------- */
  $$('[data-product-root]').forEach(function (root) {
    var variants = [];
    var jsonEl = $('[data-variant-json]', root) || $('[data-variant-json]');
    try { variants = jsonEl ? JSON.parse(jsonEl.textContent) : []; } catch (e) { variants = []; }
    var state = {};

    var form = $('form[data-type="add-to-cart-form"]', root) || $('form[action*="/cart/add"]');
    var selection = {};

    function current() {
      return variants.find(function (v) {
        return Object.keys(selection).every(function (k) { return v.options[parseInt(k, 10)] === selection[k]; });
      }) || variants[0];
    }

    function paint() {
      var v = current();
      if (!v) return;
      // the back-in-stock alert only exists while the chosen size is unavailable
      var notify = $('[data-notify]');
      if (notify) notify.hidden = !!v.available;
      $$('[data-option-select]', root).forEach(function (btn) {
        var idx = btn.getAttribute('data-option-select');
        var val = btn.getAttribute('data-option-value');
        var active = selection[idx] === val;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-checked', active ? 'true' : 'false');
        var available = variants.some(function (variant) {
          return String(variant.options[parseInt(idx, 10)]) === val && variant.available;
        });
        btn.classList.toggle('is-unavailable', !available);
      });

      var valueLabels = $$('[data-option-value]', root).filter(function (el) { return !el.closest('[data-option-select]'); });
      valueLabels.forEach(function (el, i) { if (selection[i] != null) el.textContent = selection[i]; });

      var input = $('[data-variant-id]', root);
      if (input) input.value = v.id;

      var priceNow = $('[data-price-current]', root);
      if (priceNow) priceNow.textContent = money(v.price);
      var priceWas = $('[data-price-was]', root);
      if (priceWas) { if (v.compare_at_price && v.compare_at_price > v.price) { priceWas.textContent = money(v.compare_at_price); priceWas.hidden = false; } else { priceWas.hidden = true; } }

      var stock = $('[data-stock-message]', root);
      if (stock) {
        var low = window.vennixLowStockThreshold || 5;
        if (!v.available) stock.textContent = window.strings.soldOut || 'Sold out';
        else if (v.inventory_quantity != null && v.inventory_quantity <= low) stock.textContent = 'Low stock — only ' + v.inventory_quantity + ' left';
        else stock.textContent = 'In stock — ready to ship';
      }

      var addBtn = $('[data-add-to-cart]', root);
      if (addBtn) {
        addBtn.disabled = !v.available;
        var text = $('[data-add-to-cart-text]', addBtn);
        if (text) text.textContent = v.available ? (window.strings.addToCart || 'Add to cart') : (window.strings.unavailable || 'Unavailable');
        var price = $('[data-add-to-cart-price]', addBtn);
        if (price) price.textContent = money(v.price);
      }

      var img = v.featured_image && (v.featured_image.src || v.featured_image);
      if (img) {
        var idx = variants.indexOf(v);
        var slides = $$('[data-media-slide]');
        var match = slides.indexOf(slides.find(function (s) { return s.querySelector('img') && s.querySelector('img').src.split('?')[0] === String(img).split('?')[0]; }) || null);
        if (match > -1) showMedia(match); else if (idx > -1 && slides[idx]) showMedia(slides[idx].getAttribute('data-media-slide'));
      }
      return v;
    }

    // initial selection from the first available variant
    var initial = variants.find(function (v) { return v.available; }) || variants[0];
    if (initial) initial.options.forEach(function (value, index) { selection[index] = value; });
    paint();

    root.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-option-select]');
      if (!btn) return;
      var idx = btn.getAttribute('data-option-select');
      var val = btn.getAttribute('data-option-value');
      if (btn.classList.contains('is-unavailable')) {
        // still allow selecting so shoppers can see the price, but warn
        toast('Not available', val + ' is out of stock in this style.');
      }
      selection[idx] = val;
      paint();
    });

    if (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        addToCart(form, event.submitter);
      });
    }
  });

  /* -------------------------- quantity steppers ------------------------- */
  document.addEventListener('click', function (event) {
    var btn = event.target.closest('[data-qty-change]');
    if (!btn) return;
    var input = $('[data-qty-input]', btn.closest('[data-qty]'));
    if (!input) return;
    var next = (parseInt(input.value, 10) || 1) + parseInt(btn.getAttribute('data-qty-change'), 10);
    var min = parseInt(input.getAttribute('min'), 10);
    input.value = Math.max(isNaN(min) ? 1 : min, next);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  /* ------------------------------- cart API ----------------------------- */
  function paintCart(cart) {
    $$('[data-cart-count]').forEach(function (el) { el.textContent = cart.item_count; });
    var inline = $('[data-cart-count-inline]'); if (inline) inline.textContent = cart.item_count;
    var sub = $('[data-cart-subtotal]'); if (sub) sub.textContent = money(cart.total_price);
    var bar = $('[data-ship-progress]');
    if (bar) {
      var threshold = parseInt(bar.getAttribute('data-threshold'), 10) || 7500;
      var remaining = threshold - cart.total_price;
      var msg = $('.ship-progress__msg', bar);
      if (msg) msg.textContent = remaining > 0 ? 'You are ' + money(remaining) + ' away from free shipping' : 'Free shipping unlocked 🎉';
      var fill = $('span', $('.ship-progress__bar', bar));
      if (fill) fill.style.width = Math.min(100, (cart.total_price / threshold) * 100) + '%';
    }
  }

  function refreshDrawer() {
    return fetch(routes.cart_url + '?section_id=cart-drawer')
      .then(function (r) { return r.text(); })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var fresh = doc.querySelector('[data-cart-body]');
        var body = $('[data-cart-body]');
        if (fresh && body) body.innerHTML = fresh.innerHTML;
        var freshFoot = doc.querySelector('.cart-drawer__foot');
        var foot = $('.cart-drawer__foot');
        if (freshFoot && foot) foot.innerHTML = freshFoot.innerHTML;
        return fetch(routes.cart_url + '.js').then(function (r) { return r.json(); }).then(paintCart);
      });
  }

  function addToCart(form, submitter) {
    var button = submitter || $('[data-add-to-cart]', form);
    var original = button ? button.innerHTML : '';
    if (button) { button.disabled = true; button.textContent = 'Adding…'; }
    var errBox = $('[data-cart-error]');
    if (errBox) { errBox.hidden = true; errBox.textContent = ''; }

    return fetch(routes.cart_add_url + '.js', { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.status) {
          var message = data.description || data.message || 'That item could not be added.';
          if (errBox) { errBox.textContent = message; errBox.hidden = false; } else { toast('Sorry', message); }
          return;
        }
        var line = data.items ? data.items[data.items.length - 1] : null;
        document.dispatchEvent(new CustomEvent('vennix:added', { detail: { button: button, form: form } }));
        toast('Added to cart', line ? line.product_title + ' · ' + line.variant_title : 'Your bag is updated', { href: routes.cart_url, label: 'View cart' });
        var quick = form.closest('.product-card');
        if (!quick && settingsDrawerEnabled()) openCart();
        return refreshDrawer();
      })
      .catch(function () { toast('Connection problem', 'Please try again in a moment.'); })
      .then(function () { if (button) button.innerHTML = original; if (button) button.disabled = false; });
  }
  function settingsDrawerEnabled() { return !!$('[data-cart-drawer]'); }

  // quick add forms on product cards
  document.addEventListener('submit', function (event) {
    var form = event.target.closest('[data-quick-add-form]');
    if (!form) return;
    event.preventDefault();
    addToCart(form, form.querySelector('button'));
  });

  // cart line updates inside the drawer
  document.addEventListener('change', function (event) {
    var input = event.target.closest('[data-qty-input][data-line-key]');
    if (!input) return;
    updateLine(input.getAttribute('data-line-key'), parseInt(input.value, 10) || 0);
  });
  document.addEventListener('click', function (event) {
    var remove = event.target.closest('[data-line-remove]');
    if (remove) updateLine(remove.getAttribute('data-line-remove'), 0);
    var apply = event.target.closest('[data-discount-apply]');
    if (apply) {
      var input = $('[data-discount-input]');
      if (input && input.value.trim()) {
        window.location.href = '/discount/' + encodeURIComponent(input.value.trim()) + '?redirect=' + encodeURIComponent(window.location.pathname);
      }
    }
  });
  document.addEventListener('blur', function (event) {
    var note = event.target.closest('[data-cart-note],[data-cart-attribute]');
    if (!note) return;
    var body = new URLSearchParams();
    if (note.hasAttribute('data-cart-note')) body.append('note', note.value);
    else body.append('attributes[' + note.getAttribute('data-cart-attribute') + ']', note.value);
    fetch(routes.cart_update_url + '.js', { method: 'POST', body: body, headers: { Accept: 'application/json' } }).catch(function () {});
  }, true);

  function updateLine(key, quantity) {
    fetch(routes.cart_change_url + '.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ id: key, quantity: quantity })
    }).then(function (r) { return r.json(); }).then(refreshDrawer);
  }

  /* ------------------------------ quick view ---------------------------- */
  (function quickView() {
    document.addEventListener('click', function (event) {
      var trigger = event.target.closest('[data-quick-view]');
      if (!trigger) return;
      var handle = trigger.getAttribute('data-quick-view');
      openQuickView(handle);
    });

    function openQuickView(handle) {
      var panel = document.createElement('div');
      panel.className = 'search-overlay';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.innerHTML = '<div class="search-overlay__inner"><div class="skeleton">Loading ' + handle + '…</div></div>';
      panel.addEventListener('click', function (e) { if (e.target === panel) panel.remove(); });
      document.body.appendChild(panel);

      fetch('/products/' + handle + '?view=quick')
        .then(function (r) { return r.text(); })
        .then(function (html) {
          var doc = new DOMParser().parseFromString(html, 'text/html');
          var inner = doc.querySelector('[data-quick-view-content]');
          panel.firstChild.innerHTML = inner ? inner.innerHTML : '<div class="skeleton">' + html.replace(/<[^>]+>/g, '').slice(0, 200) + '</div>';
          var form = panel.querySelector('form[action*="/cart/add"]');
          if (form) form.addEventListener('submit', function (e) { e.preventDefault(); addToCart(form, form.querySelector('button')); panel.remove(); });
        })
        .catch(function () { panel.firstChild.innerHTML = '<div class="skeleton">Could not load that product.</div>'; });
    }
  })();

  /* ------------------------------- wishlist ----------------------------- */
  (function wishlist() {
    var key = 'vennix:wishlist';
    var list = function () { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; } };
    var save = function (items) { localStorage.setItem(key, JSON.stringify(items)); paint(); };

    function paint() {
      var items = list();
      $$('[data-wishlist-count]').forEach(function (el) {
        el.textContent = items.length;
        el.hidden = items.length === 0;
      });
      $$('[data-wishlist-toggle]').forEach(function (btn) {
        var on = items.indexOf(btn.getAttribute('data-wishlist-toggle')) > -1;
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }

    document.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-wishlist-toggle]');
      if (!btn) return;
      event.preventDefault();
      var handle = btn.getAttribute('data-wishlist-toggle');
      var items = list();
      var i = items.indexOf(handle);
      if (i > -1) { items.splice(i, 1); toast('Removed from wishlist', handle.replace(/-/g, ' ')); }
      else { items.push(handle); toast('Saved to wishlist', handle.replace(/-/g, ' '), { href: '/pages/wishlist', label: 'View list' }); }
      save(items);
    });

    document.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-wishlist-open]');
      if (!btn) return;
      var page = '/pages/wishlist';
      window.location.href = page;
    });

    paint();
  })();

  /* --------------------------- delivery estimate ------------------------ */
  (function deliveryEstimate() {
    var el = $('[data-delivery-window]');
    if (!el) return;
    var fmt = function (d) { return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); };
    var from = new Date(); from.setDate(from.getDate() + 3);
    var to = new Date(); to.setDate(to.getDate() + 6);
    el.textContent = fmt(from) + ' – ' + fmt(to);
  })();

  /* ----------------------------- sticky ATC ----------------------------- */
  (function stickyAtc() {
    var bar = $('[data-sticky-atc]');
    var anchor = $('.product-form');
    if (!bar || !anchor || !('IntersectionObserver' in window)) return;
    new IntersectionObserver(function (entries) {
      bar.hidden = entries[0].isIntersecting;
    }, { rootMargin: '-120px 0px 0px 0px' }).observe(anchor);

    var btn = $('[data-sticky-add]', bar);
    if (btn) {
      btn.addEventListener('click', function () {
        var form = $('form[data-type="add-to-cart-form"]');
        if (form) { form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true })); }
      });
    }
  })();

  /* -------------------------- filters + sorting ------------------------- */
  (function filters() {
    var form = $('[data-filters-form]');
    if (!form) return;
    form.addEventListener('change', function (event) {
      if (event.target.type === 'checkbox') form.submit();
    });
    var sort = $('[data-sort-select]');
    if (sort) sort.addEventListener('change', function () {
      var url = new URL(window.location.href);
      url.searchParams.set('sort_by', sort.value);
      window.location.href = url.toString();
    });
  })();

  /* ------------------------------ accordions ---------------------------- */
  (function accordion() {
    $$('[data-accordion]').forEach(function (group) {
      $$('details', group).forEach(function (item) {
        item.addEventListener('toggle', function () {
          if (!item.open) return;
          if (!group.hasAttribute('data-accordion-single')) return;
          $$('details', group).forEach(function (other) { if (other !== item) other.open = false; });
        });
      });
    });
  })();

  /* ------------------------------- reviews ------------------------------ */
  (function reviews() {
    var block = $('[data-reviews]');
    if (!block) return;
    var handle = block.getAttribute('data-handle');
    fetch('/apps/reviews/' + handle)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var list = $('[data-reviews-list]', block);
        if (!list || !data.reviews || !data.reviews.length) { if (list) list.innerHTML = '<p class="muted">No reviews yet — be the first to write one.</p>'; return; }
        list.innerHTML = '<div class="reviews__list">' + data.reviews.map(function (r) {
          return '<article class="review"><div class="review__head"><strong>' + r.title + '</strong>' +
            '<span class="rating__stars">' + Array(5).fill(0).map(function (_, i) {
              return '<span class="rating__star' + (i < r.rating ? ' is-on' : '') + '">★</span>';
            }).join('') + '</span></div>' +
            '<p class="muted">' + r.author + ' · ' + r.date + '</p><p class="review__body">' + r.body + '</p></article>';
        }).join('') + '</div>';
      })
      .catch(function () {
        var list = $('[data-reviews-list]', block);
        if (list) list.innerHTML = '<p class="muted">Reviews are loadable once the reviews app is connected.</p>';
      });
  })();

  /* ====================================================================== */
  /*  Motion layer — mirrors public/js/motion.js in the app        */
  /* ====================================================================== */
  (function motionLayer() {
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    var root = document.documentElement;
    root.classList.add('has-motion');

    var REVEALS = [
      { sel: '.section-head, .collection-hero', kind: 'up' },
      { sel: '.product-card', kind: 'card' },
      { sel: '.category-tile', kind: 'card' },
      { sel: '.testimonial', kind: 'card' },
      { sel: '.post-card', kind: 'card' },
      { sel: '.showcase__media, .showcase__body', kind: 'fade' },
      { sel: '.story__body, .story__media', kind: 'fade' },
      { sel: '.accordion__item', kind: 'fade' },
      { sel: '.product__info > *', kind: 'up' },
      { sel: '.order__card, .account__card', kind: 'up' },
      { sel: '.footer-block, .site-footer__brand', kind: 'up' }
    ];

    REVEALS.forEach(function (group) {
      $$(group.sel).forEach(function (el) {
        if (el.hasAttribute('data-reveal') || el.closest('.hero')) return;
        el.setAttribute('data-reveal', group.kind);
        var parent = el.parentElement;
        var siblings = parent ? Array.prototype.filter.call(parent.children, function (c) { return c.hasAttribute('data-reveal'); }) : [el];
        el.style.setProperty('--reveal-delay', Math.min(siblings.indexOf(el), 8) * 80 + 'ms');
      });
    });

    if ('IntersectionObserver' in window && !reduce) {
      var revealObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-revealed');
          revealObserver.unobserve(entry.target);
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });

      $$('[data-reveal]').forEach(function (el) {
        if (el.getBoundingClientRect().top < window.innerHeight * 0.92) el.classList.add('is-revealed');
        else revealObserver.observe(el);
      });
    } else {
      $$('[data-reveal]').forEach(function (el) { el.classList.add('is-revealed'); });
    }

    /* counters */
    function runCounter(el) {
      var target = parseFloat(el.getAttribute('data-count-to'));
      var decimals = parseInt(el.getAttribute('data-count-decimals') || '0', 10);
      var suffix = el.getAttribute('data-count-suffix') || '';
      function paint(value) {
        el.textContent = (decimals ? value.toFixed(decimals) : Math.round(value).toLocaleString()) + suffix;
      }
      if (reduce) { paint(target); return; }
      var started = null;
      function step(now) {
        if (!started) started = now;
        var p = Math.min(1, (now - started) / 1400);
        paint(target * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }
    var counters = $$('[data-count-to]');
    if (counters.length && 'IntersectionObserver' in window) {
      var countObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          runCounter(entry.target);
          countObserver.unobserve(entry.target);
        });
      }, { threshold: 0.4 });
      counters.forEach(function (el) { el.textContent = reduce ? el.textContent : '0'; countObserver.observe(el); });
    }

    /* scroll progress + navigation flow */
    var progress = $('[data-scroll-progress]');
    if (progress) {
      var tick = function () {
        var max = document.documentElement.scrollHeight - window.innerHeight;
        progress.style.transform = 'scaleX(' + Math.min(1, Math.max(0, max > 0 ? window.scrollY / max : 0)) + ')';
      };
      window.addEventListener('scroll', tick, { passive: true });
      window.addEventListener('resize', tick);
      tick();
    }
    if (!reduce) {
      document.addEventListener('click', function (event) {
        var link = event.target.closest('a[href]');
        if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
        var href = link.getAttribute('href');
        if (!href || href.charAt(0) === '#' || /^(mailto:|tel:|javascript:)/.test(href)) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        var url;
        try { url = new URL(href, window.location.href); } catch (e) { return; }
        if (url.origin !== window.location.origin) return;
        document.body.classList.add('is-leaving');
        if (progress) progress.classList.add('is-loading');
      });
      window.addEventListener('pageshow', function () {
        document.body.classList.remove('is-leaving');
        if (progress) progress.classList.remove('is-loading');
      });
    }

    /* fly to cart + badge bump */
    function cartAnchor() { return $('[data-cart-open]') || $('[data-cart-count]'); }
    function resolveImage(el) {
      if (!el) return null;
      if (el.tagName === 'IMG') return el;
      var card = el.closest && el.closest('.product-card, .showcase, .cart-line');
      if (card) {
        var cardImg = card.querySelector('.product-card__media img, img');
        if (cardImg) return cardImg;
      }
      var product = el.closest && el.closest('[data-product-root]');
      if (product) {
        var main = product.querySelector('.product__slide.is-active img, .product__stage img');
        if (main) return main;
      }
      return el.querySelector ? el.querySelector('img') : null;
    }
    function bumpBadge() {
      [cartAnchor(), $('[data-cart-count]')].forEach(function (el) {
        if (!el) return;
        el.classList.remove('is-bumped');
        void el.offsetWidth;
        el.classList.add('is-bumped');
        setTimeout(function () { el.classList.remove('is-bumped'); }, 700);
      });
    }
    function flyToCart(el) {
      var anchor = cartAnchor();
      var img = resolveImage(el);
      if (!anchor || !img || reduce) { bumpBadge(); return; }
      var from = img.getBoundingClientRect();
      var to = anchor.getBoundingClientRect();
      if (!from.width || !to.width) { bumpBadge(); return; }
      var clone = document.createElement('img');
      clone.src = img.currentSrc || img.src;
      clone.alt = '';
      clone.className = 'fly-token';
      clone.style.cssText = 'position:fixed;left:' + from.left + 'px;top:' + from.top + 'px;width:' + from.width +
        'px;height:' + from.height + 'px;z-index:400;pointer-events:none;';
      document.body.appendChild(clone);
      requestAnimationFrame(function () {
        var dx = (to.left + to.width / 2) - (from.left + from.width / 2);
        var dy = (to.top + to.height / 2) - (from.top + from.height / 2);
        clone.style.transition = 'transform .7s cubic-bezier(.5,-0.1,.6,1), opacity .7s ease-in, border-radius .7s ease';
        clone.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(.12) rotate(6deg)';
        clone.style.opacity = '.15';
        clone.style.borderRadius = '50%';
      });
      setTimeout(function () { clone.remove(); bumpBadge(); }, 720);
    }
    document.addEventListener('vennix:added', function (event) {
      var detail = event.detail || {};
      if (detail.button) {
        detail.button.classList.remove('is-added');
        void detail.button.offsetWidth;
        detail.button.classList.add('is-added');
        setTimeout(function () { detail.button.classList.remove('is-added'); }, 1800);
      }
      flyToCart(detail.form || detail.button);
    });

    /* pointer depth + magnetic buttons */
    if (fine && !reduce) {
      var hero = document.querySelector('.hero');
      if (hero) {
        hero.addEventListener('pointermove', function (e) {
          var r = hero.getBoundingClientRect();
          hero.style.setProperty('--pointer-x', ((e.clientX - r.left) / r.width * 100) + '%');
          hero.style.setProperty('--pointer-y', ((e.clientY - r.top) / r.height * 100) + '%');
        });
      }
      $$('.category-tile, .product-card__media, .showcase__media').forEach(function (card) {
        card.addEventListener('pointermove', function (e) {
          var r = card.getBoundingClientRect();
          card.style.setProperty('--tilt-x', ((-(e.clientY - r.top) / r.height + 0.5) * 4).toFixed(2) + 'deg');
          card.style.setProperty('--tilt-y', (((e.clientX - r.left) / r.width - 0.5) * 5).toFixed(2) + 'deg');
          card.classList.add('is-tilting');
        });
        card.addEventListener('pointerleave', function () {
          card.classList.remove('is-tilting');
          card.style.removeProperty('--tilt-x');
          card.style.removeProperty('--tilt-y');
        });
      });
      $$('.button--primary, .button--outline-light').forEach(function (btn) {
        btn.addEventListener('pointermove', function (e) {
          var r = btn.getBoundingClientRect();
          btn.style.setProperty('--magnet-x', (((e.clientX - r.left) / r.width - 0.5) * 6).toFixed(2) + 'px');
          btn.style.setProperty('--magnet-y', (((e.clientY - r.top) / r.height - 0.5) * 5).toFixed(2) + 'px');
        });
        btn.addEventListener('pointerleave', function () {
          btn.style.removeProperty('--magnet-x');
          btn.style.removeProperty('--magnet-y');
        });
      });
    }

    /* image blur-up */
    $$('img[loading="lazy"]').forEach(function (img) {
      if (img.complete) { img.classList.add('is-loaded'); return; }
      var done = function () { img.classList.add('is-loaded'); };
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    });

    /* price flash when the variant engine swaps the number */
    $$('[data-price-current]').forEach(function (el) {
      var last = el.textContent;
      new MutationObserver(function () {
        if (el.textContent === last) return;
        last = el.textContent;
        el.classList.remove('is-flashing');
        void el.offsetWidth;
        el.classList.add('is-flashing');
      }).observe(el, { childList: true, characterData: true, subtree: true });
    });

    window.vennixMotion = { flyToCart: flyToCart, bumpBadge: bumpBadge, reduceMotion: reduce };
  })();

  /* --------------------------- monogramming ----------------------------- */
  /*
   * The add-on is a line item property, so the charge itself comes from the
   * variant the merchant sets up; here we only keep the input honest — cap the
   * characters, show them as they will be stitched, and read them back into the
   * button price so nobody is surprised at checkout.
   */
  (function monogram() {
    var box = $('[data-monogram]');
    if (!box) return;
    var toggle = $('[data-monogram-toggle]', box);
    var body = $('[data-monogram-body]', box);
    var input = $('[data-monogram-input]', box);
    var preview = $('[data-monogram-preview]', box);
    var max = parseInt(box.getAttribute('data-max'), 10) || 3;
    var price = parseInt(box.getAttribute('data-price'), 10) || 0;
    var priceEl = $('[data-add-to-cart-price]');
    var mode = box.getAttribute('data-mode') || 'property';
    var monoVariant = box.getAttribute('data-monogram-variant') || '';
    var variantInput = document.querySelector('form[action*="/cart/add"] [name="id"]');

    function clean(value) {
      return String(value || '').toUpperCase().replace(/[^A-Z0-9.&'\- ]/g, '').replace(/\s{2,}/g, ' ').trim().slice(0, max);
    }

    function money(cents) {
      return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
    }

    function paint() {
      var text = input ? clean(input.value) : '';
      if (input && input.value !== text) input.value = text;
      var on = !!(toggle && toggle.checked);
      if (body) body.hidden = !on;
      if (toggle) toggle.setAttribute('aria-expanded', String(on));
      box.classList.toggle('is-active', on);
      if (preview) {
        preview.textContent = text || new Array(max + 1).join('·');
        preview.classList.toggle('is-empty', !text);
      }
      if (priceEl) {
        var base = parseInt(priceEl.getAttribute('data-base-cents') || '0', 10);
        if (!base) {
          base = Math.round(parseFloat(priceEl.textContent.replace(/[^0-9.]/g, '')) * 100) || 0;
          priceEl.setAttribute('data-base-cents', String(base));
        }
        priceEl.textContent = money(base + (on && text ? price : 0));
      }
      // charged mode: the cart must receive the variant that carries the fee
      if (mode === 'variant' && monoVariant && variantInput) {
        variantInput.value = on && text ? monoVariant : box.getAttribute('data-base-variant') || variantInput.value;
      }
    }

    if (toggle) toggle.addEventListener('change', function () { paint(); if (toggle.checked && input) input.focus(); });
    if (input) input.addEventListener('input', paint);
    paint();
  })();

  /* ---------------------------- size finder ------------------------------ */
  /*
   * Mirrors lib/fit.js: the same bands, the same cut adjustments, the same
   * refusal to promise a fit. Answers stay in localStorage so a returning
   * customer does not have to measure twice.
   */
  (function sizeFinder() {
    var panel = $('[data-size-finder]');
    if (!panel) return;
    var form = $('[data-size-finder-form]', panel);
    var result = $('[data-size-finder-result]', panel);
    var BANDS = [
      { size: 'XXS', height: [60, 65], weight: [90, 120] },
      { size: 'XS', height: [61, 66], weight: [105, 135] },
      { size: 'S', height: [63, 68], weight: [120, 150] },
      { size: 'M', height: [65, 70], weight: [140, 175] },
      { size: 'L', height: [67, 72], weight: [165, 200] },
      { size: 'XL', height: [69, 74], weight: [190, 230] },
      { size: 'XXL', height: [70, 76], weight: [220, 265] }
    ];
    var ORDER = BANDS.map(function (b) { return b.size; });
    var KEY = 'vennix_fit';

    function nearest(body) {
      return BANDS.map(function (band) {
        var hc = (band.height[0] + band.height[1]) / 2;
        var wc = (band.weight[0] + band.weight[1]) / 2;
        var hs = Math.max(1, (band.height[1] - band.height[0]) / 2);
        var ws = Math.max(1, (band.weight[1] - band.weight[0]) / 2);
        return { band: band, score: (Math.abs(body.weight - wc) / ws) * 1.6 + Math.abs(body.height - hc) / hs };
      }).sort(function (a, b) { return a.score - b.score; });
    }

    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { saved = null; }
    if (saved && form) {
      if (form.querySelector('[name="heightFt"]')) form.querySelector('[name="heightFt"]').value = saved.heightFt || 5;
      if (form.querySelector('[name="heightIn"]')) form.querySelector('[name="heightIn"]').value = saved.heightIn || 9;
      if (form.querySelector('[name="weight"]')) form.querySelector('[name="weight"]').value = saved.weight || 165;
      var pref = saved.preference && form.querySelector('[name="preference"][value="' + saved.preference + '"]');
      if (pref) pref.checked = true;
    }

    document.addEventListener('click', function (event) {
      if (event.target.closest('[data-size-finder-open]')) { openEl(panel); return; }
      if (event.target.closest('[data-size-finder-close]')) { closeEl(panel); return; }
      var apply = event.target.closest('[data-size-finder-apply]');
      if (apply) {
        var size = apply.getAttribute('data-size-finder-apply');
        var option = $('[data-option-select][data-option-value="' + size + '"]')
          || Array.prototype.filter.call($$('[data-option-select]'), function (b) { return b.textContent.trim() === size; })[0];
        if (option && !option.classList.contains('is-unavailable')) {
          option.click();
          closeEl(panel);
          toast('Size ' + size + ' selected', 'Change it any time before you check out.');
        } else {
          toast('That size is not available', 'Try the size guide for the full measurements.');
        }
      }
    });

    if (!form) return;
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var ft = parseInt((form.querySelector('[name="heightFt"]') || {}).value, 10) || 0;
      var inch = parseInt((form.querySelector('[name="heightIn"]') || {}).value, 10) || 0;
      var weight = parseInt((form.querySelector('[name="weight"]') || {}).value, 10) || 0;
      var height = ft * 12 + inch;
      var preference = (form.querySelector('[name="preference"]:checked') || {}).value || 'true';
      if (height < 48 || height > 90 || weight < 70 || weight > 450) {
        result.hidden = false;
        result.innerHTML = '<p class="size-finder__warn">Check those numbers — we size between 4\u20320\u2033 and 7\u20326\u2033, and 70\u2013450 lb.</p>';
        return;
      }
      try { localStorage.setItem(KEY, JSON.stringify({ heightFt: ft, heightIn: inch, weight: weight, preference: preference })); } catch (e) { /* ignore */ }

      var ranked = nearest({ height: height, weight: weight });
      var steps = preference === 'relaxed' ? 1 : preference === 'snug' ? -1 : 0;
      var base = ranked[0].band.size;
      var size = shift(base, steps);
      // never suggest a size this product does not make
      var options = $$('[data-option-select]').map(function (b) { return b.textContent.trim(); });
      if (options.length && options.indexOf(size) === -1) {
        var nearestIndex = ORDER.indexOf(size);
        size = options.slice().sort(function (a, b) {
          return Math.abs(ORDER.indexOf(a) - nearestIndex) - Math.abs(ORDER.indexOf(b) - nearestIndex);
        })[0] || base;
      }
      var confidence = ranked[1].score - ranked[0].score > 0.45 ? 'high' : 'medium';
      var suggestions = [base, size, shift(size, 1)].filter(function (v, i, a) { return v && a.indexOf(v) === i; });

      result.hidden = false;
      result.innerHTML = '<div class="size-finder__verdict size-finder__verdict--' + confidence + '">' +
        '<p class="size-finder__size">We suggest <strong>' + size + '</strong></p>' +
        '<ul class="size-finder__reasons">' +
          '<li>At ' + height + '\u2033 and ' + weight + ' lb you sit closest to our ' + base + ' band.</li>' +
          '<li>' + (preference === 'relaxed' ? 'You asked for room, so we moved up a size.' : preference === 'snug' ? 'You asked for a close fit, so we moved down a size.' : 'Sized true, with no adjustment for preference.') + '</li>' +
        '</ul>' +
        '<button class="button button--primary" type="button" data-size-finder-apply="' + size + '">Select ' + size + '</button>' +
        (suggestions.length > 1 ? '<p class="size-finder__also">Also worth trying: ' + suggestions.filter(function (v) { return v !== size; }).join(', ') + '</p>' : '') +
        '<p class="size-finder__hint">Cross-check against the size guide before you commit.</p>' +
      '</div>';
    });

    function shift(size, steps) {
      var index = ORDER.indexOf(size);
      if (index === -1 || !steps) return size;
      return ORDER[Math.max(0, Math.min(ORDER.length - 1, index + steps))];
    }
  })();

  /* ------------------------------ load more ------------------------------ */
  /*
   * Progressive enhancement for paginated collections: the numbered links stay
   * in the DOM for crawlers and no-JS visitors, and this appends the next page
   * in place for everyone else.
   */
  (function loadMore() {
    document.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-load-more]');
      if (!btn) return;
      var next = btn.getAttribute('data-next');
      var grid = document.querySelector('[data-collection-grid]');
      if (!next || !grid) return;
      btn.disabled = true;
      var label = btn.innerHTML;
      btn.innerHTML = 'Loading…';
      fetch(next)
        .then(function (r) { return r.text(); })
        .then(function (html) {
          var doc = new DOMParser().parseFromString(html, 'text/html');
          var incoming = doc.querySelectorAll('[data-collection-grid] > *');
          Array.prototype.forEach.call(incoming, function (node) { grid.appendChild(node); });
          var following = doc.querySelector('[data-load-more]');
          if (following && following.getAttribute('data-next')) {
            btn.setAttribute('data-next', following.getAttribute('data-next'));
            btn.innerHTML = label;
            btn.disabled = false;
          } else {
            btn.remove();
          }
          document.dispatchEvent(new CustomEvent('vennix:content-added', { detail: { container: grid } }));
        })
        .catch(function () {
          btn.innerHTML = label;
          btn.disabled = false;
          toast('Could not load more', 'Please try again in a moment.');
        });
    });
  })();

})();
