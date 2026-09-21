
/* ==========================================================================
   VENNIX — motion layer
   Reveal choreography, parallax, counters, fly-to-cart, pointer-depth,
   smooth accordions and navigation feedback. Progressive: if any piece is
   unsupported the markup stays perfectly usable, and everything collapses
   under prefers-reduced-motion.
   ========================================================================== */

(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var $ = function (sel, scope) { return (scope || doc).querySelector(sel); };
  var $$ = function (sel, scope) { return Array.prototype.slice.call((scope || doc).querySelectorAll(sel)); };

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var supportsObserver = 'IntersectionObserver' in window;

  root.classList.add('has-motion');
  if (reduceMotion) root.classList.add('prefers-reduced-motion');

  /* ------------------------------------------------------- reveal on scroll */
  // Auto-tags the things worth animating so no template has to opt in.
  var REVEAL_TARGETS = [
    { sel: '.sec-title, .sec-copy, .section-head', kind: 'up' },
    { sel: '.pcard', kind: 'card' },
    { sel: '.tile, .tile--wide', kind: 'card' },
    { sel: '.review', kind: 'card' },
    { sel: '.post-card', kind: 'card' },
    { sel: '.spotlight__media, .spotlight__body', kind: 'fade' },
    { sel: '.value-card', kind: 'card' },
    { sel: '.stat', kind: 'up' },
    { sel: '.band__inner, .founding__inner', kind: 'fade' },
    { sel: '.crumbs, .page-head', kind: 'fade' },
    { sel: '.filters, .pagination', kind: 'fade' },
    { sel: '.review-item', kind: 'up' },
    { sel: '.cart-page__row, .summary', kind: 'up' },
    { sel: '.footer__col', kind: 'up' },
    { sel: '.pdp-info > *', kind: 'up' },
    { sel: '.accordion__item', kind: 'fade' }
  ];

  function tagReveals() {
    REVEAL_TARGETS.forEach(function (group) {
      $$(group.sel).forEach(function (el, i) {
        if (el.hasAttribute('data-reveal') || el.closest('.hero') || el.closest('.quickview')) return;
        el.setAttribute('data-reveal', group.kind);
        // stagger within a row, reset the counter for each container
        var siblings = el.parentElement
          ? Array.prototype.filter.call(el.parentElement.children, function (c) { return c.hasAttribute('data-reveal'); })
          : [el];
        var index = siblings.indexOf(el);
        el.style.setProperty('--reveal-delay', Math.min(index, 6) * 70 + 'ms');
      });
    });
    // the collection grid is the one place a bigger stagger reads well
    $$('.pcard').forEach(function (card, i) {
      var grid = card.closest('.product-grid, .rail__track, .grid');
      if (!grid) return;
      var siblings = Array.prototype.slice.call(grid.querySelectorAll('.pcard'));
      card.style.setProperty('--reveal-delay', Math.min(siblings.indexOf(card), 8) * 80 + 'ms');
      void i;
    });
  }

  function revealNow(el) {
    el.classList.add('is-revealed');
  }

  if (supportsObserver && !reduceMotion) {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        revealNow(entry.target);
        revealObserver.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });

    tagReveals();
    $$('[data-reveal]').forEach(function (el) {
      // anything already in the first screen reveals immediately, without a jump
      var rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.92) { requestAnimationFrame(function () { revealNow(el); }); }
      else revealObserver.observe(el);
    });
  } else {
    $$('[data-reveal]').forEach(revealNow);
  }

  /* ------------------------------------------------------------- parallax */
  var parallaxEls = $$('[data-parallax]');
  if (parallaxEls.length && !reduceMotion) {
    var ticking = false;
    var applyParallax = function () {
      var vh = window.innerHeight;
      parallaxEls.forEach(function (el) {
        var rect = el.getBoundingClientRect();
        if (rect.bottom < -200 || rect.top > vh + 200) return;
        var strength = parseFloat(el.getAttribute('data-parallax')) || 0.12;
        var offset = (rect.top + rect.height / 2 - vh / 2) * strength;
        el.style.setProperty('--parallax-y', offset.toFixed(2) + 'px');
      });
      ticking = false;
    };
    var onScroll = function () { if (!ticking) { ticking = true; requestAnimationFrame(applyParallax); } };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    applyParallax();
  }

  /* ------------------------------------------------------------- counters */
  var counters = $$('[data-count-to]');
  if (counters.length) {
    var countObserver = supportsObserver ? new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        runCounter(entry.target);
        countObserver.unobserve(entry.target);
      });
    }, { threshold: 0.4 }) : null;

    counters.forEach(function (el) {
      var target = parseFloat(el.getAttribute('data-count-to'));
      el.textContent = reduceMotion ? formatCounter(target, el) : formatCounter(0, el);
      if (countObserver) countObserver.observe(el);
      else runCounter(el);
    });

    function formatCounter(value, el) {
      var decimals = parseInt(el.getAttribute('data-count-decimals') || '0', 10);
      var prefix = el.getAttribute('data-count-prefix') || '';
      var suffix = el.getAttribute('data-count-suffix') || '';
      var shown = decimals ? value.toFixed(decimals) : Math.round(value).toLocaleString('en-US');
      return prefix + shown + suffix;
    }

    function runCounter(el) {
      var target = parseFloat(el.getAttribute('data-count-to'));
      if (reduceMotion) { el.textContent = formatCounter(target, el); return; }
      var duration = parseInt(el.getAttribute('data-count-duration') || '1400', 10);
      var started = null;
      function step(now) {
        if (!started) started = now;
        var p = Math.min(1, (now - started) / duration);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = formatCounter(target * eased, el);
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }
  }

  /* ------------------------------------------------- scroll progress + nav  */
  var progress = $('[data-scroll-progress]');
  if (progress) {
    var progressTick = function () {
      var max = doc.documentElement.scrollHeight - window.innerHeight;
      var ratio = max > 0 ? window.scrollY / max : 0;
      progress.style.transform = 'scaleX(' + Math.min(1, Math.max(0, ratio)) + ')';
    };
    window.addEventListener('scroll', progressTick, { passive: true });
    window.addEventListener('resize', progressTick);
    progressTick();
  }

  // fade the page out on internal navigation so route changes feel deliberate
  if (!reduceMotion) {
    doc.addEventListener('click', function (event) {
      var link = event.target.closest('a[href]');
      if (!link) return;
      var href = link.getAttribute('href');
      if (!href || link.target === '_blank' || link.hasAttribute('download')) return;
      if (href.charAt(0) === '#' || /^(mailto:|tel:|javascript:)/.test(href)) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      var url;
      try { url = new URL(href, window.location.href); } catch (e) { return; }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      doc.body.classList.add('is-leaving');
      if (progress) progress.classList.add('is-loading');
    });
    window.addEventListener('pageshow', function () {
      doc.body.classList.remove('is-leaving');
      if (progress) progress.classList.remove('is-loading');
    });
  }

  /* ----------------------------------------------------- fly-to-cart + pop */
  function cartAnchor() {
    return $('[data-cart-drawer]') ? $('[data-cart-open]') : $('.icon-btn--cart');
  }

  // Finds the product image that belongs to whatever was clicked, so the fly
  // animation always starts from the right place — card art, spotlight or the
  // PDP gallery.
  function resolveImage(el) {
    // callers can hand us an event detail that is a string or undefined; the
    // animation is a nicety, so it bails rather than throwing into the console
    if (!el || typeof el !== 'object' || !el.tagName) return null;
    if (el.tagName === 'IMG') return el;
    var card = el.closest && el.closest('.pcard, .spotlight, .quickview, .cart-page__row');
    if (card) {
      var cardImg = card.querySelector('.pcard__media img, .spotlight__media img, img');
      if (cardImg) return cardImg;
    }
    var pdp = el.closest && el.closest('.pdp, .product, .gallery');
    if (pdp) {
      var galleryImg = pdp.querySelector('.gallery__stage img.is-active, .gallery__stage img, img');
      if (galleryImg) return galleryImg;
    }
    return $('img', el) || null;
  }

  function flyToCart(fromEl) {
    var anchor = cartAnchor();
    var img = resolveImage(fromEl);
    if (!anchor || !img || reduceMotion) { bounceBadge(); return; }
    var from = img.getBoundingClientRect();
    if (!from.width) { bounceBadge(); return; }
    var to = anchor.getBoundingClientRect();

    var clone = doc.createElement('img');
    clone.src = img.currentSrc || img.src;
    clone.alt = '';
    clone.className = 'fly-token';
    clone.style.cssText = 'position:fixed;left:' + from.left + 'px;top:' + from.top + 'px;width:' + from.width + 'px;height:' + from.height + 'px;z-index:400;pointer-events:none;';
    doc.body.appendChild(clone);

    requestAnimationFrame(function () {
      var dx = (to.left + to.width / 2) - (from.left + from.width / 2);
      var dy = (to.top + to.height / 2) - (from.top + from.height / 2);
      clone.style.transition = 'transform .7s cubic-bezier(.5,-0.1,.6,1), opacity .7s ease-in, width .7s ease, height .7s ease, border-radius .7s ease';
      clone.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(.12) rotate(6deg)';
      clone.style.opacity = '0.15';
      clone.style.borderRadius = '50%';
    });
    setTimeout(function () {
      clone.remove();
      bounceBadge();
    }, 720);
  }

  function bounceBadge() {
    var badge = $('[data-cart-count]');
    var anchor = cartAnchor();
    [badge, anchor].forEach(function (el) {
      if (!el) return;
      el.classList.remove('is-bumped');
      void el.offsetWidth;
      el.classList.add('is-bumped');
      setTimeout(function () { el.classList.remove('is-bumped'); }, 700);
    });
  }

  doc.addEventListener('vennix:cart', function (event) {
    if ((event.detail || {}).delta > 0) bounceBadge();
  });

  doc.addEventListener('vennix:added', function (event) {
    var detail = event.detail || {};
    var button = detail.button;
    if (button) {
      button.classList.remove('is-added');
      void button.offsetWidth;
      button.classList.add('is-added');
      setTimeout(function () { button.classList.remove('is-added'); }, 1800);
    }
    var source = detail.source || button;
    flyToCart(source || (button && button.closest('.pcard, .spotlight, form')) );
  });

  /* --------------------------------------------------- button success morph */
  // Adds a tick badge to any button that opts in and then succeeds.
  doc.addEventListener('click', function (event) {
    var btn = event.target.closest('[data-success-morph]');
    if (!btn) return;
    btn.classList.add('is-busy');
  });

  /* ------------------------------------------------------- pointer depth FX */
  if (finePointer && !reduceMotion) {
    // hero pointer light
    var hero = $('.hero');
    if (hero) {
      hero.addEventListener('pointermove', function (e) {
        var rect = hero.getBoundingClientRect();
        hero.style.setProperty('--pointer-x', ((e.clientX - rect.left) / rect.width * 100).toFixed(2) + '%');
        hero.style.setProperty('--pointer-y', ((e.clientY - rect.top) / rect.height * 100).toFixed(2) + '%');
      });
    }

    // gentle tilt on media tiles
    $$('.tile, .spotlight__media, .journal__item, .post-card__media, .pcard__media').forEach(function (card) {
      card.addEventListener('pointermove', function (e) {
        var rect = card.getBoundingClientRect();
        var px = (e.clientX - rect.left) / rect.width - 0.5;
        var py = (e.clientY - rect.top) / rect.height - 0.5;
        card.style.setProperty('--tilt-x', (-py * 4).toFixed(2) + 'deg');
        card.style.setProperty('--tilt-y', (px * 5).toFixed(2) + 'deg');
        card.classList.add('is-tilting');
      });
      card.addEventListener('pointerleave', function () {
        card.classList.remove('is-tilting');
        card.style.removeProperty('--tilt-x');
        card.style.removeProperty('--tilt-y');
      });
    });

    // magnetic buttons — small, restrained, only on primaries
    $$('.btn--primary, .btn--light').forEach(function (btn) {
      btn.addEventListener('pointermove', function (e) {
        var rect = btn.getBoundingClientRect();
        var px = (e.clientX - rect.left) / rect.width - 0.5;
        var py = (e.clientY - rect.top) / rect.height - 0.5;
        btn.style.setProperty('--magnet-x', (px * 6).toFixed(2) + 'px');
        btn.style.setProperty('--magnet-y', (py * 5).toFixed(2) + 'px');
      });
      btn.addEventListener('pointerleave', function () {
        btn.style.removeProperty('--magnet-x');
        btn.style.removeProperty('--magnet-y');
      });
    });
  }

  /* --------------------------------------------------------- image blur-up */
  var lazyImages = $$('img[loading="lazy"], img[data-blur-up]');
  lazyImages.forEach(function (img) {
    if (img.complete) { img.classList.add('is-loaded'); return; }
    var done = function () { img.classList.add('is-loaded'); };
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
  });

  /* ------------------------------------------------- smooth details toggles */
  $$('details.accordion__item, details.review-form-wrap, details.faq-item').forEach(function (details) {
    var summary = $('summary', details);
    var panel = details.querySelector('summary ~ *');
    if (!summary || !panel || reduceMotion) return;

    panel.style.overflow = 'hidden';
    summary.addEventListener('click', function (event) {
      event.preventDefault();
      if (details.dataset.animating === '1') return;
      details.dataset.animating = '1';
      var start = panel.getBoundingClientRect().height;

      if (details.open) {
        panel.style.height = start + 'px';
        requestAnimationFrame(function () {
          panel.style.transition = 'height .28s cubic-bezier(.4,0,.2,1), opacity .2s ease';
          panel.style.height = '0px';
          panel.style.opacity = '0';
        });
        setTimeout(function () {
          details.open = false;
          panel.style.cssText = '';
          details.dataset.animating = '0';
        }, 300);
      } else {
        details.open = true;
        var end = panel.getBoundingClientRect().height;
        panel.style.height = '0px';
        panel.style.opacity = '0';
        requestAnimationFrame(function () {
          panel.style.transition = 'height .3s cubic-bezier(.4,0,.2,1), opacity .25s ease';
          panel.style.height = end + 'px';
          panel.style.opacity = '1';
        });
        setTimeout(function () {
          panel.style.cssText = '';
          details.dataset.animating = '0';
        }, 330);
      }
    });
  });

  /* ------------------------------------------------------ sticky product bar */
  var stickyBar = $('[data-sticky-atc]');
  if (stickyBar) {
    var trigger = $('[data-add-form]');
    if (trigger && supportsObserver) {
      var stickyObserver = new IntersectionObserver(function (entries) {
        var visible = entries[0].isIntersecting;
        stickyBar.classList.toggle('is-visible', !visible);
        stickyBar.hidden = visible && !stickyBar.classList.contains('is-pinned');
      }, { rootMargin: '-90px 0px 0px 0px' });
      stickyObserver.observe(trigger);
    }
    stickyBar.hidden = false;
    stickyBar.classList.add('is-armed');
  }

  /* ------------------------------------------- live "just viewed / sold" tick */
  var ticker = $('[data-live-ticker]');
  if (ticker) {
    var events = JSON.parse(ticker.getAttribute('data-live-ticker') || '[]');
    if (events.length) {
      var index = 0;
      var show = function () {
        ticker.textContent = events[index % events.length];
        ticker.classList.remove('is-in');
        void ticker.offsetWidth;
        ticker.classList.add('is-in');
        index += 1;
      };
      show();
      setInterval(show, 6500);
    }
  }

  /* --------------------------------------------------------- public API ---- */
  // Small surface so themes/scripts can reuse the same motion primitives.
  window.vennixMotion = {
    reduceMotion: reduceMotion,
    flyToCart: function (el) { flyToCart(el); },
    bounceBadge: bounceBadge,
    reveal: function (scope) { $$('[data-reveal]', scope || doc).forEach(revealNow); }
  };

  /* --------------------------------------------------- late-arriving content */
  // "Load more" appends product cards long after the first pass. Tag and observe
  // them so they animate in with everything else instead of popping into place.
  var lateObserver = (supportsObserver && !reduceMotion)
    ? new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          revealNow(entry.target);
          lateObserver.unobserve(entry.target);
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 })
    : null;

  doc.addEventListener('vennix:content-added', function (e) {
    var host = (e.detail && e.detail.container) || doc;
    var nodes = $$('.pcard, .tile, .post-card, .review', host);
    nodes.forEach(function (el, i) {
      if (el.hasAttribute('data-reveal')) return;
      el.setAttribute('data-reveal', 'card');
      el.style.setProperty('--reveal-delay', Math.min(i, 8) * 70 + 'ms');
      if (lateObserver) lateObserver.observe(el);
      else revealNow(el);
    });
    // anything else that arrived (headers, rails) just reveals in place
    $$('[data-rail]', host).forEach(function (el) { el.classList.add('is-revealed'); });
  });

  /* ----------------------------------------------------------- price flash */
  // When the variant engine swaps a price, flash it so the change is noticed.
  $$('[data-price-now], [data-price]').forEach(function (el) {
    var last = el.textContent;
    new MutationObserver(function () {
      if (el.textContent === last) return;
      last = el.textContent;
      el.classList.remove('is-flashing');
      void el.offsetWidth;
      el.classList.add('is-flashing');
    }).observe(el, { childList: true, characterData: true, subtree: true });
  });
})();
