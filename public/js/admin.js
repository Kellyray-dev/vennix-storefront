/* ==========================================================================
   Vennix Athletic — back office client (point of sale + small niceties)
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function fmt(cents) {
    return '$' + (Math.round(cents || 0) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /* ------------------------------------------------------------ point of sale */
  var posGrid = $('.pos-grid');
  if (posGrid) {
    var cart = [];              // { variantId, title, price, qty, image }
    var cartEl = $('[data-pos-cart]');
    var linesInput = $('[data-pos-lines]');
    var submit = $('[data-pos-submit]');
    var TAX = 0.08875;          // NY studio rate

    function render() {
      if (!cart.length) {
        cartEl.innerHTML = '<p class="muted">No items yet.</p>';
      } else {
        cartEl.innerHTML = cart.map(function (line, i) {
          return '<div class="pos-line">' +
            '<span>' + line.title + '<br><em class="muted">' + line.color + ' · ' + line.size + ' · ' + fmt(line.price) + '</em></span>' +
            '<span class="pos-line__qty">' +
              '<button type="button" data-pos-dec="' + i + '" aria-label="Decrease">−</button> ' + line.qty + ' ' +
              '<button type="button" data-pos-inc="' + i + '" aria-label="Increase">+</button>' +
            '</span>' +
            '<strong>' + fmt(line.price * line.qty) + '</strong>' +
          '</div>';
        }).join('');
      }
      var subtotal = cart.reduce(function (s, l) { return s + l.price * l.qty; }, 0);
      var tax = Math.round(subtotal * TAX);
      var total = subtotal + tax;
      $('[data-pos-subtotal]').textContent = fmt(subtotal);
      $('[data-pos-tax]').textContent = fmt(tax);
      $('[data-pos-total]').textContent = fmt(total);
      $('[data-pos-button-total]').textContent = fmt(total);
      if (linesInput) linesInput.value = cart.map(function (l) { return l.variantId + ':' + l.qty; }).join(',');
      if (submit) submit.disabled = !cart.length;
    }

    posGrid.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-pos-add]');
      if (!btn) return;
      var variantId = btn.getAttribute('data-pos-variant');
      var existing = cart.filter(function (l) { return l.variantId === variantId; })[0];
      if (existing) { existing.qty += 1; }
      else {
        cart.push({
          variantId: variantId,
          title: btn.getAttribute('data-pos-title'),
          price: Number(btn.getAttribute('data-pos-price')),
          image: btn.getAttribute('data-pos-image'),
          color: 'Studio black',
          size: '—',
          qty: 1
        });
      }
      render();
    });

    if (cartEl) cartEl.addEventListener('click', function (e) {
      var inc = e.target.closest('[data-pos-inc]');
      var dec = e.target.closest('[data-pos-dec]');
      if (inc) { cart[Number(inc.getAttribute('data-pos-inc'))].qty += 1; render(); }
      if (dec) {
        var i = Number(dec.getAttribute('data-pos-dec'));
        cart[i].qty -= 1;
        if (cart[i].qty <= 0) cart.splice(i, 1);
        render();
      }
    });

    render();
  }

  /* keyboard shortcut: "/" focuses the admin search */
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) {
      var search = $('.admin__search input');
      if (search) { e.preventDefault(); search.focus(); }
    }
  });

  /* keep long admin forms from being lost accidentally */
  $$('.form-grid, .card form').forEach(function (form) {
    var dirty = false;
    form.addEventListener('input', function () { dirty = true; });
    form.addEventListener('submit', function () { dirty = false; });
  });

  /* auto-refresh the dashboard clock */
  var foot = $('.admin__foot span');
  if (foot && /Signed in as/.test(foot.textContent)) {
    setInterval(function () {
      var time = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
      foot.textContent = foot.textContent.replace(/·\s.*$/, '· ' + time);
    }, 60000);
  }
})();
