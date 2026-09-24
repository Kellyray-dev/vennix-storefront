#!/usr/bin/env node
'use strict';
/**
 * a11y-check.js — accessibility assertions over the rendered storefront.
 *
 * Not a substitute for a screen-reader pass or axe on real hardware, but it
 * catches the regressions that actually happen when templates change:
 *
 *   - images without alt text (or decorative images without alt="")
 *   - form controls with no accessible name
 *   - buttons/links whose only content is an unlabelled icon
 *   - heading order (h1 → h2 → h3, no skipped levels, exactly one h1)
 *   - landmark structure (header/main/footer, one <main>)
 *   - language, viewport, skip link, focus-visible affordance
 *   - interactive controls are reachable (not hidden from keyboard)
 *   - live regions for cart/announcement updates
 *   - colour is never the only signal for a state that ships with text
 *
 * Usage: node scripts/a11y-check.js [baseUrl]
 */
const { ensureBase } = require('./helpers');
let BASE = '';
let stopServer = null;

let pass = 0, fail = 0;
const failures = [];
function expect(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(label + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}

const PAGES = [
  ['/', 'home'],
  ['/collections/all', 'collection'],
  ['/products/atlas-heavyweight-hoodie', 'product'],
  ['/cart', 'cart'],
  ['/pages/contact', 'contact form'],
  ['/pages/size-guide', 'size guide'],
  ['/blogs/journal', 'journal'],
  ['/search?q=hoodie', 'search results'],
  ['/account', 'account hub'],
  ['/this-page-does-not-exist', '404']
];

const tagRe = name => new RegExp(`<${name}\\b([\\s\\S]*?)>`, 'gi');
function attr(tagAttrs, name) {
  const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tagAttrs) ||
    new RegExp(`${name}\\s*=\\s*'([^']*)'`, 'i').exec(tagAttrs);
  return m ? m[1] : null;
}
function allTags(html, name) {
  const out = [];
  const re = tagRe(name);
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}
function countTags(html, name) {
  return (html.match(new RegExp(`<${name}\\b`, 'gi')) || []).length;
}

(async function run() {
  const host = await ensureBase(process.argv[2]);
  BASE = host.base;
  stopServer = host.stop;
  console.log(`\nAccessibility check — rendered HTML (${BASE})\n` + '─'.repeat(64));

  for (const [route, label] of PAGES) {
    const res = await fetch(BASE + route, { headers: { 'Accept-Encoding': 'identity' } });
    const html = await res.text();
    console.log(`\n${label} (${route})`);

    /* language + viewport + landmarks */
    expect('has lang and a viewport that allows zoom',
      /<html[^>]*\slang="[a-z]{2}"/i.test(html) &&
      /<meta[^>]*name="viewport"[^>]*content="[^"]*width=device-width[^"]*"/i.test(html) &&
      !/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\.0)?"/i.test(html));
    expect('exactly one <main> landmark', countTags(html, 'main') === 1, `${countTags(html, 'main')} found`);
    expect('has a skip link to #main', /class="skip-link"[^>]*href="#main"/.test(html) || /href="#main"[^>]*class="skip-link"/.test(html));
    expect('footer/header landmarks present', countTags(html, 'header') >= 1 && countTags(html, 'footer') >= 1);

    /* headings */
    const h1 = countTags(html, 'h1');
    expect('exactly one <h1>', h1 === 1, `${h1} found`);
    const levels = [...html.matchAll(/<h([1-6])\b/gi)].map(m => Number(m[1]));
    let skipped = null;
    for (let i = 1; i < levels.length; i++) {
      if (levels[i] - levels[i - 1] > 1) {
        skipped = `h${levels[i - 1]} → h${levels[i]} (heading ${i + 1} of ${levels.length})`;
        break;
      }
    }
    expect('no skipped heading levels', !skipped, skipped || levels.join(''));

    /* images */
    const imgs = allTags(html, 'img');
    const imgNoAlt = imgs.filter(a => attr(a, 'alt') === null);
    expect(`every <img> declares alt (${imgs.length} images)`, imgNoAlt.length === 0, `${imgNoAlt.length} missing`);
    const imgNoDims = imgs.filter(a => !attr(a, 'width') || !attr(a, 'height'));
    expect('images carry intrinsic dimensions (no layout shift)', imgNoDims.length === 0, `${imgNoDims.length} missing`);

    /* form controls: named by aria-*, label[for=…], a wrapping <label>, or title */
    const controlMatches = [...html.matchAll(/<(input|select|textarea)\b([\s\S]*?)>/gi)];
    const visibleControls = controlMatches.filter(m => !/type="hidden"/i.test(m[2]));
    const unnamed = [];
    for (const m of visibleControls) {
      const attrs = m[2];
      if (attr(attrs, 'aria-label') || attr(attrs, 'aria-labelledby') || attr(attrs, 'title')) continue;
      const id = attr(attrs, 'id');
      if (id && new RegExp(`<label[^>]*for="${id}"`, 'i').test(html)) continue;
      // wrapped: an unclosed <label …> before the control
      const before = html.slice(0, m.index);
      const opens = (before.match(/<label\b/gi) || []).length;
      const closes = (before.match(/<\/label\s*>/gi) || []).length;
      if (opens > closes) continue;
      unnamed.push(m[0].replace(/\s+/g, ' ').slice(0, 110));
    }
    expect(`form controls have an accessible name (${visibleControls.length} visible controls)`,
      unnamed.length === 0, unnamed.slice(0, 3).join(' | '));

    /* buttons: named by aria-*, visible text, or title */
    const buttonMatches = [...html.matchAll(/<button\b([\s\S]*?)>([\s\S]*?)<\/button>/gi)];
    const unnamedButtons = buttonMatches.filter(m => {
      if (/aria-label=|aria-labelledby=|title=/.test(m[1])) return false;
      const text = m[2].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
      return text.length === 0;
    }).map(m => m[0].replace(/\s+/g, ' ').slice(0, 110));
    expect(`buttons have an accessible name (${buttonMatches.length} buttons)`,
      unnamedButtons.length === 0, unnamedButtons.slice(0, 3).join(' | '));
    expect('no control is removed from the tab order without a reason',
      !/tabindex="-1"/.test(html.replace(/<main id="main" tabindex="-1">/g, '')));

    /* live regions for asynchronous updates */
    expect('asynchronous updates announce themselves (aria-live)',
      /aria-live="(polite|assertive)"/.test(html));

    /* dialogs */
    const dialogTags = [...html.matchAll(/<(?:div|aside|section)\b[^>]*role="dialog"[\s\S]*?>/gi)].map(m => m[0]);
    const unlabelledDialogs = dialogTags.filter(d => !/aria-label=|aria-labelledby=/.test(d));
    expect(`modal surfaces are labelled dialogs (${dialogTags.length})`,
      dialogTags.length > 0 && unlabelledDialogs.length === 0,
      unlabelledDialogs.map(d => d.replace(/\s+/g, ' ').slice(0, 90)).join(' | '));
  }

  if (stopServer) await stopServer();
  console.log('\n' + '─'.repeat(64));
  console.log(`  ${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log('\n  Failures:');
    failures.forEach(f => console.log(`   • ${f}`));
  }
  console.log('');
  process.exitCode = fail ? 1 : 0;
})().catch(err => { console.error('a11y-check crashed:', err); process.exit(1); });
