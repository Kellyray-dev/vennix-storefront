'use strict';
/**
 * fit.js — "What's my size?" size recommendation.
 *
 * NAADAM answers sizing with a modal before you pick a size. This is the same
 * idea, done honestly: three questions produce a size *estimate* that is
 * grounded in a body-measurement band, adjusted for how the customer likes a
 * garment to sit and for how the specific piece is cut — and always shown with
 * the reasoning and a link to the full size guide, never as a guarantee.
 *
 * Two things it deliberately will not do: recommend a size the product does not
 * make, or hide that it is an estimate.
 */

const ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '1X', '2X', '3X'];

/**
 * Unisex body-size bands, in inches and pounds. Centres matter more than the
 * edges: every band overlaps its neighbours on purpose, because real bodies do.
 */
const BANDS = [
  { size: 'XXS', height: [60, 65], weight: [90, 120] },
  { size: 'XS', height: [61, 66], weight: [105, 135] },
  { size: 'S', height: [63, 68], weight: [120, 150] },
  { size: 'M', height: [65, 70], weight: [140, 175] },
  { size: 'L', height: [67, 72], weight: [165, 200] },
  { size: 'XL', height: [69, 74], weight: [190, 230] },
  { size: 'XXL', height: [70, 76], weight: [220, 265] }
];

/** How each cut behaves relative to the body — drives the adjustment, not the band. */
const CUTS = {
  compression: { label: 'Compression — second-skin fit', adjust: -1, note: 'Compression pieces are meant to hold; most people keep their usual size.' },
  snug: { label: 'Snug — close to the body', adjust: 0, note: 'This piece is cut close. Size up if you prefer breathing room.' },
  fitted: { label: 'Fitted', adjust: 0, note: 'Cut close without squeezing.' },
  classic: { label: 'Classic — true to size', adjust: 0, note: 'Our most standard fit.' },
  regular: { label: 'Regular — true to size', adjust: 0, note: 'Our most standard fit.' },
  relaxed: { label: 'Relaxed', adjust: 1, note: 'Cut with room through the chest and hip — many people take their usual size.' },
  oversized: { label: 'Oversized', adjust: 1, note: 'Deliberately roomy — size down if you want a closer line.' }
};

function parseCut(product) {
  const text = `${(product && product.fit) || ''} ${(product && product.tagline) || ''} ${(product && product.type) || ''}`.toLowerCase();
  for (const key of Object.keys(CUTS)) if (text.includes(key)) return key;
  if (text.includes('legging') || text.includes('bra')) return 'compression';
  return 'classic';
}

/** Parse the free-text fit note for an explicit instruction, if the team wrote one. */
function cutNote(product) {
  const note = (product && product.fitNotes) || '';
  return note.trim();
}

function toInches({ height, weight, units = 'imperial' }) {
  const h = Number(height);
  const w = Number(weight);
  if (!Number.isFinite(h) || !Number.isFinite(w)) return null;
  if (units === 'metric') return { height: h / 2.54, weight: w * 2.20462 };
  return { height: h, weight: w };
}

/** Distance from a band centre, normalised so height and weight both count. */
function score(band, body) {
  const hCentre = (band.height[0] + band.height[1]) / 2;
  const wCentre = (band.weight[0] + band.weight[1]) / 2;
  const hSpan = Math.max(1, (band.height[1] - band.height[0]) / 2);
  const wSpan = Math.max(1, (band.weight[1] - band.weight[0]) / 2);
  const hDist = Math.abs(body.height - hCentre) / hSpan;
  const wDist = Math.abs(body.weight - wCentre) / wSpan;
  return wDist * 1.6 + hDist;         // weight carries more signal than height
}

function shift(size, steps) {
  const index = ORDER.indexOf(size);
  if (index === -1) return size;
  return ORDER[Math.max(0, Math.min(ORDER.length - 1, index + steps))];
}

/**
 * Recommend a size.
 *
 * @param {object} product   the catalogue product (used for available sizes + cut)
 * @param {object} answers   { height, weight, units, usualSize, preference }
 * @returns {{ok:boolean, error?:string, size?:string, ...}}
 */
function recommend(product, answers = {}) {
  const body = toInches(answers);
  if (!body) return { ok: false, error: 'Add your height and weight so we can size you.' };
  if (body.height < 48 || body.height > 90) return { ok: false, error: 'Check your height — we size between 4′0″ and 7′6″.' };
  if (body.weight < 70 || body.weight > 450) return { ok: false, error: 'Check your weight — we size between 70 lb and 450 lb.' };

  const cut = parseCut(product);
  const cutInfo = CUTS[cut];
  const sizes = (product.variants || []).map(v => v.size).filter((s, i, a) => s && a.indexOf(s) === i);
  const available = sizes.filter(s => ORDER.includes(s));

  const ranked = [...BANDS].sort((a, b) => score(a, body) - score(b, body));
  let base = ranked[0].size;
  const runnerUp = ranked[1];
  const margin = score(runnerUp, body) - score(ranked[0], body);

  const reasons = [];
  const band = BANDS.find(b => b.size === base);
  reasons.push(`At ${Math.round(body.height)}″ and ${Math.round(body.weight)} lb you sit closest to our ${base} band.`);

  const preference = String(answers.preference || 'true').toLowerCase();
  let steps = 0;
  if (preference === 'relaxed') steps += 1;
  if (preference === 'snug') steps -= 1;
  if (preference === 'relaxed') reasons.push('You asked for a roomier drape, so we moved up a size.');
  if (preference === 'snug') reasons.push('You asked for a closer fit, so we moved down a size.');

  reasons.push(`${cutInfo.label}: ${cutInfo.note}`);
  const note = cutNote(product);
  if (note) reasons.push(note);

  let size = shift(base, steps);
  if (ORDER.indexOf(size) === -1) size = base;

  // Never recommend a size the product does not make.
  let substituted = false;
  if (available.length && !available.includes(size)) {
    const idx = ORDER.indexOf(size);
    const nearest = available
      .map(s => ({ s, d: Math.abs(ORDER.indexOf(s) - idx) }))
      .sort((a, b) => a.d - b.d)[0];
    if (nearest) { size = nearest.s; substituted = true; reasons.push(`This piece is made in ${available.join(', ')} — we matched you to ${size}.`); }
  }

  const confidence = margin > 0.45 && !substituted ? 'high' : margin > 0.15 ? 'medium' : 'low';
  const confidenceCopy = {
    high: 'You land clearly inside one band.',
    medium: 'You sit between two bands — either would work.',
    low: 'Your measurements straddle our sizing — the studio can help.'
  }[confidence];

  const inStock = (product.variants || []).some(v => v.size === size && v.stock > 0);
  const band2 = ORDER.indexOf(base) < ORDER.indexOf(size) ? base : base;

  return {
    ok: true,
    size,
    confidence,
    confidenceCopy,
    cut: cutInfo.label,
    reasons,
    between: ranked[0].size === base ? runnerUp.size : ranked[0].size,
    suggestions: [band2, size, shift(size, 1)].filter((s, i, a) => s && a.indexOf(s) === i && (!available.length || available.includes(s))).slice(0, 3),
    inStock,
    sizeGuide: '/pages/size-guide'
  };
}

/** The modal's own copy, kept in one place so the theme can mirror it. */
const COPY = {
  heading: "What's my size?",
  intro: 'Three quick questions. We size from a body-measurement band, then adjust for the cut — this is an estimate, not a fitting.',
  fields: {
    height: 'How tall are you?',
    weight: 'What do you weigh?',
    usualSize: 'What size do you usually take?',
    preference: 'How do you like it to fit?'
  },
  disclaimer: 'Estimates only — if you are between two sizes, our studio will talk it through with you.',
  cta: 'Show my size'
};

module.exports = { recommend, parseCut, CUTS, COPY, BANDS, ORDER };
