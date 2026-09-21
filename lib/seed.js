'use strict';
/**
 * seed.js — the starting catalog and storefront content for Vennix.
 * Run `npm run reset` to rebuild data/db.json from this file.
 */
const crypto = require('crypto');
const store = require('./store');
const auth = require('./auth');
const commerce = require('./commerce');

const IMG = '/images';
const TODAY = new Date();

/* ------------------------------------------------------------------ helpers */
function daysAgo(n) { return new Date(TODAY.getTime() - n * 864e5).toISOString(); }
// demo order numbers follow the brand prefix configured in settings
function orderNumber(seq) { return `VEN-${1000 + seq}`; }

/**
 * Deterministic pseudo-stock so the catalog has realistic low-stock / sold-out
 * states. Keyed on the variant's stable identity (handle · colour · size) and
 * never on the SKU: a rebrand changes the SKU prefix, and renaming a brand must
 * not silently rewrite your inventory.
 */
function stockFor(seedStr, base = 24) {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) h = (h * 31 + seedStr.charCodeAt(i)) % 9973;
  const v = h % 100;
  // Sold-out states are never left to the hash: SOLD_OUT pins them explicitly,
  // so the catalog is deliberate rather than accidentally patchy. The hash only
  // produces the low-stock band (1–9 units) and the healthy range above it.
  if (v < 12) return 1 + (h % 3);
  if (v < 30) return 4 + (h % 6);
  return base + (h % 40);
}

/**
 * Sizes that are deliberately sold out in the demo data, so the storefront's
 * back-in-stock flow has something real to point at rather than depending on
 * whatever the stock hash happens to produce. Each sits on a product's default
 * colour, so the alert is reachable in one click from the product page.
 */
/**
 * Product codes for SKUs. Three letters off the front of the handle is not
 * enough — "everyday-pima-crew-tee" and "everyday-brushed-fleece-jogger" would
 * both become EVE, and duplicate SKUs make a Shopify import fail. Codes are
 * built from the handle's initials and de-duplicated, so they are stable and
 * unique. They are brand-neutral: a rebrand moves the prefix, not the code.
 */
const SKU_CODES = new Map();
function skuCode(handle) {
  // built on first use so it can read PRODUCT_DEFS regardless of file order
  if (!SKU_CODES.size) {
    const used = new Set();
    PRODUCT_DEFS.forEach(def => {
      const words = def.handle.split('-').filter(word => /[a-z]/.test(word) && word.length > 2);
      const base = (words.length > 1 ? words.map(word => word[0]).join('') : def.handle.replace(/[^a-z0-9]/gi, ''))
        .slice(0, 3).toUpperCase();
      let code = base;
      let n = 2;
      while (used.has(code)) code = `${base.slice(0, 2)}${n++}`;
      used.add(code);
      SKU_CODES.set(def.handle, code);
    });
  }
  return SKU_CODES.get(handle);
}

const SOLD_OUT = [
  'atlas-heavyweight-hoodie/fog/XS',
  'velocity-long-sleeve-base-layer/ink/XXL',
  'flow-high-rise-legging-28/charcoal/XS'
];

const APPAREL_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const BOTTOM_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

const COLORS = {
  bone: { name: 'Bone', hex: '#EDE7DC' },
  fog: { name: 'Fog Heather', hex: '#BFBCB4' },
  charcoal: { name: 'Charcoal', hex: '#3B3B3D' },
  ink: { name: 'Ink', hex: '#1B1B1D' },
  clay: { name: 'Clay', hex: '#A8603F' },
  moss: { name: 'Moss', hex: '#5A6350' },
  storm: { name: 'Storm', hex: '#59616B' },
  slate: { name: 'Slate Blue', hex: '#414B5A' },
  oat: { name: 'Oat', hex: '#D6C9B4' }
};

/* ----------------------------------------------------------------- catalogue */
const PRODUCT_DEFS = [
  {
    handle: 'atlas-heavyweight-hoodie',
    title: 'Atlas Heavyweight Hoodie',
    tagline: '480 GSM brushed-back fleece',
    category: 'men', type: 'Hoodie',
    price: 12800, compareAtPrice: 14800,
    collections: ['men', 'essentials', 'new-in', 'bestsellers'],
    tags: ['hoodie', 'fleece', 'heavyweight', 'bestseller', 'unisex-friendly'],
    badges: ['Bestseller'],
    colors: ['fog', 'charcoal', 'clay', 'bone'], sizes: APPAREL_SIZES,
    images: [
      { src: `${IMG}/p-atlas-hoodie.jpg`, alt: 'Atlas Heavyweight Hoodie flat lay in Fog Heather' },
      { src: `${IMG}/lookbook-1.jpg`, alt: 'Model wearing the Atlas Heavyweight Hoodie in a concrete studio' }
    ],
    description: `<p>The piece that started the studio. Cut from a dense 480&nbsp;gsm loop-back fleece that's been brushed for softness on the inside and pre-shrunk so it stays true to size.</p>
<p>Shoulders are set slightly forward for an easy drape, the hood is double-layer and holds its shape, and the ribbed cuffs and hem are knit with 5% elastane so they recover instead of stretching out.</p>`,
    features: ['480 gsm brushed-back cotton fleece', 'Double-layer hood with flat drawcords', 'Ribbed cuffs + hem with elastane recovery', 'Kangaroo pocket with hidden phone sleeve', 'Pre-shrunk — true to size'],
    materials: '78% organic cotton, 18% recycled polyester, 4% elastane',
    care: 'Machine wash cold with like colours. Tumble dry low. Do not bleach. Warm iron if needed.',
    fit: 'Relaxed. Model is 6\'1" / 185cm wearing a Medium.',
    fitNotes: 'If you are between sizes and want a closer fit, size down.',
    weight: 820,
    // the piece we get asked to monogram most — stitched at the left cuff
    personalization: { enabled: true, placement: 'Left cuff' },
    seo: { title: 'Atlas Heavyweight Hoodie — 480 gsm Fleece | Vennix', description: 'A dense, brushed-back 480 gsm hoodie built for shoulder-season layering. Free shipping over $50 and 30-day returns.' }
  },
  {
    handle: 'everyday-pima-crew-tee',
    title: 'Everyday Pima Crew Tee',
    tagline: 'Peruvian Pima, 190 gsm',
    category: 'men', type: 'T-Shirt',
    price: 4200, compareAtPrice: null,
    collections: ['men', 'essentials', 'new-in'],
    tags: ['t-shirt', 'pima', 'staple', 'everyday'],
    badges: ['New'],
    colors: ['bone', 'ink', 'fog', 'moss'], sizes: APPAREL_SIZES,
    images: [
      { src: `${IMG}/p-everyday-tee.jpg`, alt: 'Everyday Pima Crew Tee flat lay in Bone' }
    ],
    description: `<p>A tee you can buy five of. Long-staple Peruvian Pima cotton spun at 190&nbsp;gsm gives it a dry, substantial hand that holds its shape wash after wash.</p>
<p>The collar is ribbed and double-stitched, the body is cut straight through the waist, and side seams are taped to stop twisting.</p>`,
    features: ['Peruvian Pima cotton, 190 gsm', 'Ribbed collar with twin-needle stitching', 'Taped side seams resist twisting', 'Pre-shrunk and garment-washed', 'Bluesign® approved dyehouse'],
    materials: '100% Peruvian Pima cotton',
    care: 'Machine wash cold. Tumble dry low or hang dry. Do not bleach.',
    fit: 'Classic straight fit. Model is 6\'0" / 183cm wearing a Medium.',
    fitNotes: 'True to size. Size up one for a boxier look.',
    weight: 180,
    personalization: { enabled: true, placement: 'Right chest', maxChars: 4 },
    seo: { title: 'Everyday Pima Crew Tee — Peruvian Cotton | Vennix', description: 'A 190 gsm Peruvian Pima cotton tee with taped seams and a ribbed collar. Built to be worn daily.' }
  },
  {
    handle: 'velocity-long-sleeve-base-layer',
    title: 'Velocity Long-Sleeve Base Layer',
    tagline: 'Grid-back knit, 4-way stretch',
    category: 'men', type: 'Base Layer',
    price: 8800, compareAtPrice: 9800,
    collections: ['men', 'active', 'bestsellers'],
    tags: ['base-layer', 'training', 'moisture-wicking', 'running'],
    badges: ['Sale'],
    colors: ['ink', 'slate', 'bone'], sizes: APPAREL_SIZES,
    images: [
      { src: `${IMG}/p-velocity-ls.jpg`, alt: 'Velocity Long-Sleeve Base Layer flat lay in Ink' },
      { src: `${IMG}/lookbook-1.jpg`, alt: 'Model wearing Velocity base layer under a hooded layer' }
    ],
    description: `<p>Engineered for the shoulder seasons when the air is cold and the pace is quick. A grid-back knit moves moisture off the skin, traps warm air in the channels and dries in minutes.</p>
<p>Raglan sleeves remove shoulder seams under a pack, flatlock stitching prevents chafe, and the extended cuffs double as thumbholes on long runs.</p>`,
    features: ['Grid-back knit for moisture transport', 'Raglan sleeves with flatlock seams', 'Thumbhole cuffs and drop hem', 'Odour-resistant finish (no silver)', 'Reflective tonal logo at back neck'],
    materials: '88% recycled polyester, 12% elastane',
    care: 'Machine wash cold. Do not use fabric softener. Hang dry.',
    fit: 'Athletic. Sits close to the body. Model is 6\'1" / 185cm wearing a Medium.',
    fitNotes: 'Size up for a relaxed layer fit.',
    weight: 240,
    seo: { title: 'Velocity Long-Sleeve Base Layer — Grid-Back Knit | Vennix', description: 'A breathable grid-back base layer with thumbholes and flatlock seams for cold-weather training.' }
  },
  {
    handle: 'kinetic-7-inch-training-short',
    title: 'Kinetic 7" Training Short',
    tagline: 'Unlined, ripstop stretch',
    category: 'men', type: 'Shorts',
    price: 6800, compareAtPrice: null,
    collections: ['men', 'active', 'new-in'],
    tags: ['shorts', 'training', 'gym', 'ripstop'],
    badges: [],
    colors: ['charcoal', 'ink', 'moss'], sizes: APPAREL_SIZES,
    images: [
      { src: `${IMG}/p-kinetic-short.jpg`, alt: 'Kinetic 7 inch Training Short flat lay in Charcoal' }
    ],
    description: `<p>A do-everything training short with a 7&Prime; inseam that clears the knee. The shell is a matte ripstop with mechanical stretch, so it survives sprints, sled pushes and the wash.</p>
<p>A gusseted crotch and laser-cut vents at the back waist keep you moving. Zip pocket at the right hip for keys and cards; unlined so you can layer your own base.</p>`,
    features: ['7" inseam, unlined', 'Matte ripstop with mechanical stretch', 'Zip secure pocket + internal key loop', 'Laser-cut rear vents', 'Flat drawcord that stays tied'],
    materials: '94% recycled nylon, 6% elastane',
    care: 'Machine wash cold. Tumble dry low. Do not iron.',
    fit: 'Regular. Mid-rise, straight through the leg.',
    fitNotes: 'True to size. Size down for a shorter, closer fit.',
    weight: 210,
    seo: { title: 'Kinetic 7" Training Short — Ripstop Stretch | Vennix', description: 'A 7-inch unlined training short in matte ripstop stretch with a zip pocket and laser-cut vents.' }
  },
  {
    handle: 'everyday-brushed-fleece-jogger',
    title: 'Everyday Brushed Fleece Jogger',
    tagline: 'Tapered, 400 gsm fleece',
    category: 'men', type: 'Joggers',
    price: 10800, compareAtPrice: 12800,
    collections: ['men', 'essentials', 'bestsellers'],
    tags: ['joggers', 'fleece', 'loungewear', 'tapered'],
    badges: ['Sale'],
    colors: ['clay', 'charcoal', 'fog', 'ink'], sizes: BOTTOM_SIZES,
    images: [
      { src: `${IMG}/p-everyday-jogger.jpg`, alt: 'Everyday Brushed Fleece Jogger flat lay in Clay' },
      { src: `${IMG}/lookbook-1.jpg`, alt: 'Model wearing the Everyday Brushed Fleece Jogger' }
    ],
    description: `<p>The jogger that behaves like a trouser. A 400&nbsp;gsm brushed fleece body tapers through the calf into a 2&times;2 ribbed cuff, so it stacks cleanly over trainers without ballooning at the ankle.</p>
<p>Deep side pockets are lined in jersey, there's a hidden zip pocket at the back right, and the flat drawcord sits flush under a belt if you need to look presentable.</p>`,
    features: ['400 gsm brushed fleece', 'Tapered leg with 2×2 ribbed cuff', 'Lined pockets + hidden rear zip', 'Flat drawcord, flush waistband', 'Gusseted for full range of motion'],
    materials: '72% organic cotton, 24% recycled polyester, 4% elastane',
    care: 'Machine wash cold inside out. Tumble dry low.',
    fit: 'Tapered regular. Model is 6\'1" / 185cm wearing a Medium.',
    fitNotes: 'If you prefer a roomier leg, size up one.',
    weight: 620,
    personalization: { enabled: true, placement: 'Left hip' },
    seo: { title: 'Everyday Brushed Fleece Jogger — 400 gsm | Vennix', description: 'A tapered 400 gsm brushed fleece jogger with a clean ribbed cuff and hidden rear zip pocket.' }
  },
  {
    handle: 'summit-packable-windbreaker',
    title: 'Summit Packable Windbreaker',
    tagline: 'Packs into its own pocket',
    category: 'active', type: 'Jacket',
    price: 16800, compareAtPrice: null,
    collections: ['active', 'new-in', 'men', 'women'],
    tags: ['jacket', 'windbreaker', 'packable', 'running', 'water-resistant'],
    badges: ['New'],
    colors: ['clay', 'storm', 'ink'], sizes: APPAREL_SIZES,
    images: [
      { src: `${IMG}/p-summit-windbreaker.jpg`, alt: 'Summit Packable Windbreaker flat lay in Clay' }
    ],
    description: `<p>A 96&nbsp;gram shell that folds into its own chest pocket and disappears into a running belt. The ripstop face sheds light rain and blocks wind without the boil-in-the-bag feeling.</p>
<p>Underarm vents open the moment you pick up pace, the hood is elasticated and helmet-compatible, and the drop hem keeps spray off your back. Fully taped shoulder seams.</p>`,
    features: ['96 g — packs into chest pocket', '10k/10k ripstop with DWR finish', 'Elasticated hood with rear cinch', 'Underarm laser vents', 'Reflective trim at cuffs and back hem'],
    materials: '100% recycled nylon with PFC-free DWR',
    care: 'Machine wash cold on gentle. Do not bleach. Tumble dry low to reactivate DWR.',
    fit: 'Regular with room to layer. Model is 5\'10" / 178cm wearing a Small.',
    fitNotes: 'Size up if layering over a hoodie.',
    weight: 96,
    seo: { title: 'Summit Packable Windbreaker — 96g Ripstop Shell | Vennix', description: 'A 96 gram packable windbreaker with PFC-free DWR, laser vents and reflective trim.' }
  },
  {
    handle: 'flow-high-rise-legging-28',
    title: 'Flow High-Rise Legging 28"',
    tagline: 'Buttery compression, squat-proof',
    category: 'women', type: 'Leggings',
    price: 9800, compareAtPrice: 11800,
    collections: ['women', 'active', 'bestsellers'],
    tags: ['leggings', 'training', 'yoga', 'high-rise', 'squat-proof'],
    badges: ['Bestseller', 'Sale'],
    colors: ['charcoal', 'ink', 'moss'], sizes: ['XS', 'S', 'M', 'L', 'XL'],
    images: [
      { src: `${IMG}/lookbook-2.jpg`, alt: 'Model wearing Flow High-Rise Leggings during a morning stretch session' },
      { src: `${IMG}/p-velocity-ls.jpg`, alt: 'Flow legging in Ink shown with a Vennix base layer' }
    ],
    description: `<p>A 28&Prime; inseam legging with a wide, double-layer waistband that stays put through burpees and never rolls. The knit is opaque at full stretch — tested, not claimed.</p>
<p>Four-way compression with a brushed interior, bonded seams that sit flat against the skin, and a hidden waistband pocket sized for a phone or a key.</p>`,
    features: ['28" inseam, 4-way compression knit', 'Opaque at full stretch — squat tested', 'Double-layer contoured waistband', 'Bonded flat seams and gusset', 'Hidden waistband pocket'],
    materials: '76% recycled nylon, 24% elastane',
    care: 'Machine wash cold with like colours. Hang dry. No fabric softener.',
    fit: 'Compressive high-rise. Model is 5\'9" / 175cm wearing a Small.',
    fitNotes: 'Between sizes? Size up for a less compressive feel.',
    weight: 260,
    seo: { title: 'Flow High-Rise Legging 28" — Squat-Proof Compression | Vennix', description: 'A 28-inch high-rise legging in opaque four-way compression knit with bonded seams and a hidden pocket.' }
  },
  {
    handle: 'ribbed-seamless-sports-bra',
    title: 'Ribbed Seamless Sports Bra',
    tagline: 'Medium support, seamless knit',
    category: 'women', type: 'Sports Bra',
    price: 6200, compareAtPrice: null,
    collections: ['women', 'active', 'new-in'],
    tags: ['bra', 'seamless', 'yoga', 'medium-support'],
    badges: [],
    colors: ['ink', 'bone', 'clay'], sizes: ['XS', 'S', 'M', 'L', 'XL'],
    images: [
      { src: `${IMG}/lookbook-2.jpg`, alt: 'Model wearing the Ribbed Seamless Sports Bra' }
    ],
    description: `<p>Knitted in one piece on a circular loom, so there is not a single seam against your ribs. The rib structure gives medium support with a soft, second-skin feel and the band is double-knit to stay flat.</p>
<p>Removable cups are included and shaped (not folded), and the neckline is cut a little higher so you can wear it alone to class.</p>`,
    features: ['Seamless circular-knit construction', 'Medium support, medium impact', 'Double-knit band that stays flat', 'Includes one pair of shaped removable cups', 'Machine washable in a mesh bag'],
    materials: '62% recycled nylon, 30% polyester, 8% elastane',
    care: 'Machine wash cold in a mesh bag. Hang dry.',
    fit: 'Fitted. Model is 5\'9" / 175cm wearing a Small.',
    fitNotes: 'For high-impact training, size down for extra hold.',
    weight: 130,
    seo: { title: 'Ribbed Seamless Sports Bra — Medium Support | Vennix', description: 'A seamless circular-knit sports bra with medium support, a flat double-knit band and removable cups.' }
  }
];

const REVIEW_DEFS = [
  // Realistic spread: not every product is reviewed, ratings are not all fives,
  // reviewers never repeat across products, and helpful votes stay plausible.
  // Products with no reviews are deliberately left out (velocity base layer,
  // summit windbreaker, kinetic short, gift card).
  { handle: 'atlas-heavyweight-hoodie', rating: 5, daysAgo: 9, helpful: 3, verified: true,
    title: 'Finally, a hoodie that feels expensive',
    body: 'The weight is the thing. It hangs properly and the cuffs have not bagged out after about ten washes.', author: 'Daniel R.' },
  { handle: 'atlas-heavyweight-hoodie', rating: 5, daysAgo: 34, helpful: 2, verified: true,
    title: 'Second one, sold the others',
    body: 'Bought fog in September and charcoal in October. That should tell you everything.', author: 'Priya M.' },
  { handle: 'atlas-heavyweight-hoodie', rating: 4, daysAgo: 61, helpful: 1, verified: true,
    title: 'Warm — almost too warm indoors',
    body: 'Layer it for walks and it is perfect. Sat through a lecture in it once and regretted it.', author: 'Sam O.' },
  { handle: 'atlas-heavyweight-hoodie', rating: 3, daysAgo: 88, helpful: 4, verified: true,
    title: 'Great fabric, boxy fit is not for me',
    body: 'No complaints about the quality at all — it is just a lot of fabric through the body. Sizing down helped but the shoulders then pulled. Kept it for lounging, would try the crew next time.', author: 'Marta K.' },

  { handle: 'flow-high-rise-legging-28', rating: 5, daysAgo: 16, helpful: 2, verified: true,
    title: 'Genuinely squat-proof',
    body: 'Tested it properly in the studio. No sheerness under load and the waistband does not roll down mid-set.', author: 'Hannah B.' },
  { handle: 'flow-high-rise-legging-28', rating: 4, daysAgo: 47, helpful: 0, verified: true,
    title: 'Snug for the first wear',
    body: 'Takes a session or two to settle. After that they have been my default pair for lifting.', author: 'Rachel V.' },

  { handle: 'everyday-brushed-fleece-jogger', rating: 5, daysAgo: 23, helpful: 1, verified: true,
    title: 'Wear them most days',
    body: 'The taper is right — comfortable without looking like pyjamas. Pockets sit high enough that things do not fall out.', author: 'Nadia S.' },
  { handle: 'everyday-brushed-fleece-jogger', rating: 5, daysAgo: 72, helpful: 0, verified: false,
    title: 'Bought in the Brooklyn studio',
    body: 'Tried them on in person and walked out wearing them. The fleece is noticeably denser than the high street version I had before.', author: 'Jo T.' },

  { handle: 'everyday-pima-crew-tee', rating: 5, daysAgo: 41, helpful: 1, verified: true,
    title: 'The collar survives',
    body: 'Every tee I own eventually goes at the collar. Two months of hard wear on this one and the ribbing is still tight.', author: 'Marcus T.' },
  { handle: 'everyday-pima-crew-tee', rating: 3, daysAgo: 103, helpful: 2, verified: true,
    title: 'Nice cloth, sizing runs long',
    body: 'The Pima is lovely and it is cooler than I expected. I am 5 foot 8 and the length sits below my hips, which is why it loses two stars. Exchanged for a small without any fuss though.', author: 'Chloe B.' },

  { handle: 'ribbed-seamless-sports-bra', rating: 4, daysAgo: 57, helpful: 1, verified: true,
    title: 'Good medium support, no chafing',
    body: 'Perfect for yoga and lifting. I would not take it on a long run — go up a support level for that.', author: 'Mei L.' }
];

const PENDING_REVIEWS = [
  { handle: 'summit-packable-windbreaker', rating: 5, daysAgo: 0.2, helpful: 0, verified: false,
    title: 'Packs smaller than I expected', body: 'Folded into its own pocket and it fit in the side of my running vest. Wore it over a base layer at 8°C and was comfortable the whole way.', author: 'Priya Raman' }
];


const POST_DEFS = [
  {
    handle: 'why-we-chose-480-gsm',
    title: 'Why we chose 480 gsm (and why most brands won\'t)',
    excerpt: 'Heavy fleece costs more, shrinks more and takes longer to knit. It is also the only way to make a hoodie that survives five winters.',
    image: `${IMG}/blog-1.jpg`,
    author: 'Iris Nakamura, Head of Product',
    readMinutes: 6,
    publishedAt: daysAgo(9),
    tags: ['Materials', 'Studio'],
    body: `<p>Fabric weight is the first place a product gets cheapened, because nobody can tell in a photo. 280&nbsp;gsm fleece photographs identically to 480&nbsp;gsm fleece. It is only after two months of washing that the difference becomes obvious — the light stuff pills, the cuffs stretch out, and the whole garment starts to look like a sleeping bag.</p>
<h3>Heavier yarn costs us 34% more</h3><p>Our mill in Portugal knits the Atlas body on a slower loom. Slower means fewer metres per hour, which means a higher per-unit price. We also brush the back after knitting, which adds a pass and a failure mode: brush too hard and you weaken the loop structure.</p>
<h3>Pre-shrunk, not post-regret</h3><p>Heavy cotton shrinks. We wash every panel before cutting, so what you order is what you own in a year. That step alone adds six days to production.</p>
<h3>What that buys you</h3><ul><li>A hood that still stands up after a season</li><li>Cuffs that recover instead of flaring</li><li>No pilling at the pocket edges</li></ul><p>We would rather make one hoodie properly than three that quietly fall apart. That is the entire brief.</p>`
  },
  {
    handle: 'capsule-01-design-notes',
    title: 'Capsule 01: the design notes',
    excerpt: 'Eight styles, one colour story, and a rule that every piece had to work with every other piece in the range.',
    image: `${IMG}/lookbook-2.jpg`,
    author: 'Design Studio',
    readMinutes: 4,
    publishedAt: daysAgo(21),
    tags: ['Design', 'Lookbook'],
    body: `<p>Capsule 01 started with a constraint: eight styles, and any two of them have to look intentional together. That ruled out the usual approach of designing hero pieces and filling the gaps with whatever was left over.</p>
<h3>The colour story</h3><p>Bone, Fog Heather, Charcoal, Ink, Clay, Moss. Three neutrals, two earths and one deep green. Every piece ships in at least three of them and the palette does not shift between categories — the legging charcoal is the hoodie charcoal.</p>
<h3>Fit language</h3><p>Tops sit relaxed through the body with a defined shoulder. Bottoms taper. Layers run true with room for a base layer underneath. Once that grammar is fixed, mixing pieces stops being a styling exercise and starts being obvious.</p>`
  },
  {
    handle: 'training-at-dawn',
    title: 'Training at dawn: a winter layering guide',
    excerpt: 'What to wear at 5°C when you leave the house in the dark and finish in daylight, from our coaching partners in Brooklyn.',
    image: `${IMG}/lookbook-1.jpg`,
    author: 'Vennix Run Club',
    readMinutes: 5,
    publishedAt: daysAgo(34),
    tags: ['Training', 'Guides'],
    body: `<p>The hardest part of a winter session is that conditions change while you are out. You leave at 4°C and come back at 9°C, and the layer you needed at the start is a liability at the end.</p>
<h3>The three-layer rule</h3><p>Base layer against the skin to move sweat. A shell or mid-layer for wind and light rain. Nothing insulating that you cannot remove or pack into a pocket. The Summit Packable exists because a 96&nbsp;gram shell you can fold into your waistband beats a jacket you leave at home.</p>
<h3>Hands and head first</h3><p>If your hands are cold you will cut the session short. Thumbhole cuffs buy you ten degrees of perceived warmth for almost no weight.</p>`
  }
];

const PAGE_DEFS = [
  {
    handle: 'about', title: 'About Vennix', nav: false, template: 'about',
    seo: { title: 'About Vennix — A studio in Brooklyn', description: 'Vennix makes a small, deliberate range of training and everyday essentials. Designed in Brooklyn, made in Portugal and Vietnam.' },
    body: `<h2>We make a small range, deliberately.</h2>
<p>Vennix was founded in 2019 by two people who were tired of choosing between gym clothes that performed and clothes that looked like they belonged in the rest of your life. We build one capsule at a time: eight to twelve styles, made properly, in a fixed palette.</p>
<h3>What that means in practice</h3>
<ul>
<li><strong>Small runs.</strong> We produce in 300-unit batches so we can fix problems instead of reproducing them.</li>
<li><strong>Named mills.</strong> Portugal for fleece and knits, Vietnam for technical shells. Every mill is audited annually and listed on the care label.</li>
<li><strong>Real testing.</strong> 30 wearers in Brooklyn, Chicago and Portland test each style for 60 days before it is released.</li>
<li><strong>Repairs, not replacements.</strong> Send it back and we fix it. Free for the first two years.</li>
</ul>
<h3>The studio</h3>
<p>44 Wythe Avenue, Brooklyn — open Thursday to Sunday, 11am to 6pm. Run club leaves at 6:30am on Tuesdays.</p>`
  },
  {
    handle: 'sustainability', title: 'Sustainability', nav: false, template: 'text',
    seo: { title: 'Sustainability & Materials | Vennix', description: 'How Vennix builds responsibly: GOTS-certified cotton, recycled nylon shells, small-batch runs, plastic-free shipping and a free repair programme.' },
    body: `<h2>Fewer, better, for longer.</h2>
<p>The most sustainable garment is the one you keep wearing. That belief shapes every decision we make — from the mills we name to the packaging we refuse to use.</p>
<h3>Materials</h3>
<ul>
<li><strong>GOTS-certified organic cotton</strong> in every fleece and jersey style. No conventional cotton, ever.</li>
<li><strong>Recycled nylon and polyester</strong> (GRS-certified) in shells and linings — 62% recycled content across the technical range.</li>
<li><strong>Traceable merino</strong> from a single non-mulesed flock in Victoria, Australia.</li>
<li><strong>Low-impact dyes</strong> in a closed-loop water system at our Portuguese mill — 84% of water recaptured.</li>
</ul>
<h3>Making</h3>
<p>We produce in 300-unit batches across two audited partners (Portugal for knits and fleece, Vietnam for shells). Both are visited twice a year, publish wage floors above the local living wage, and hold SA8000 and WRAP Gold certification.</p>
<h3>Shipping and packaging</h3>
<p>Orders ship plastic-free in FSC-certified mailers or recycled cardboard, and every delivery is carbon-offset through a verified reforestation programme in the Catskills. Returns labels are paper, not plastic.</p>
<h3>Repairs, resale, recycling</h3>
<p>Free repairs for two years on every piece. Send anything worn out back to the studio and we will repair it, resell it through Vennix Revive, or shred it into insulation — you get 15% off your next order either way.</p>
<h3>Where we are honest</h3>
<p>We are not carbon-neutral as a business yet, and we do not claim to be. Our 2026 target is a 40% reduction in absolute emissions against a 2023 baseline, audited externally and published on this page every January.</p>`
  },
  {
    handle: 'faq', title: 'Help & FAQ', nav: false, template: 'faq',
    seo: { title: 'Help & FAQ | Vennix', description: 'Shipping, returns, sizing, care instructions and warranty information for Vennix orders.' },
    body: `<p>Answers to the questions our support team gets most. Still stuck? <a href="/contact">Write to us</a> — a human replies within one business day.</p>`
  },
  {
    handle: 'shipping-returns', title: 'Shipping & Returns', nav: true, template: 'text',
    seo: { title: 'Shipping & Returns | Vennix', description: 'Free standard shipping over $50, 30-day returns, and free exchanges on all Vennix orders in the US.' },
    body: `<h3>Shipping</h3>
<ul>
<li><strong>Standard — $6.95</strong>, free on orders over $50. 4–6 business days, tracked.</li>
<li><strong>Express — $14.95.</strong> 2–3 business days when ordered before 2pm ET.</li>
<li><strong>Overnight — $24.95.</strong> Next business day on orders placed before 2pm ET.</li>
<li><strong>Studio pickup — free.</strong> 44 Wythe Avenue, Brooklyn. Ready in two hours.</li>
<li><strong>International.</strong> Canada and UK ship with DDP (duties prepaid). Other regions are calculated at checkout.</li>
</ul>
<h3>Returns and exchanges</h3>
<p>You have 30 days from delivery. Items must be unworn with tags attached — try them on indoors, keep the hangtag on until you are sure. Start a return from your <a href="/account/orders">order history</a> and we email a prepaid label the same day.</p>
<ul><li>Refunds land on the original payment method within 3–5 business days of us receiving the parcel.</li><li>Exchanges ship the day your return is scanned by the carrier, so you are not waiting twice.</li><li>Final sale and personal-care items are not returnable — noted on the product page.</li></ul>
<h3>Warranty</h3>
<p>Every Vennix piece carries a two-year defect warranty and free repair service. Seams, zips, elastics and prints are covered. Normal wear is not a defect, but we will still fix it for a small fee rather than have you replace it.</p>`
  },
  {
    handle: 'size-guide', title: 'Size Guide', nav: false, template: 'size',
    seo: { title: 'Size Guide | Vennix', description: 'Measurements for Vennix tops, bottoms and accessories, plus fit guidance from our product team.' },
    body: `<p>Measure over light clothing, keep the tape level and snug but not tight. If you fall between two sizes, size up for layers and size down for compression pieces.</p>`
  },
  {
    handle: 'privacy', title: 'Privacy Policy', nav: false, template: 'text',
    seo: { title: 'Privacy Policy | Vennix', description: 'How Vennix collects, uses and protects your personal information.' },
    body: `<p>Last updated ${new Date(TODAY.getFullYear(), 0, 12).toDateString()}.</p>
<h3>What we collect</h3><p>Order details, contact information, and — if you create an account — a hashed password we cannot read. Payment details are tokenised; we never store full card numbers.</p>
<h3>How we use it</h3><p>To fulfil orders, provide support, prevent fraud, and (only with your consent) send marketing emails. We do not sell personal data.</p>
<h3>Your rights</h3><p>You can request an export or deletion of your data at any time by writing to privacy@vennixstore.com. We respond within 30 days.</p>
<h3>Cookies</h3><p>We use a single first-party session cookie to keep your cart and login. Analytics are aggregated and cookieless.</p>`
  },
  {
    handle: 'terms', title: 'Terms of Service', nav: false, template: 'text',
    seo: { title: 'Terms of Service | Vennix', description: 'The terms that govern purchases and use of vennixstore.com.' },
    body: `<h3>Orders</h3><p>An order is a request to buy. It is accepted when we send the confirmation email. If an item is out of stock we will contact you and refund it in full.</p>
<h3>Pricing</h3><p>All prices are in USD and exclude sales tax, which is calculated at checkout based on your shipping address. We reserve the right to correct obvious pricing errors before shipping.</p>
<h3>Warranty and liability</h3><p>Our liability is limited to the value of the goods purchased. Nothing here limits your statutory rights.</p>
<h3>Governing law</h3><p>These terms are governed by the laws of the State of New York.</p>`
  },
  {
    handle: 'accessibility', title: 'Accessibility', nav: false, template: 'text',
    seo: { title: 'Accessibility Statement | Vennix', description: 'Our commitment to WCAG 2.2 AA conformance across the Vennix storefront.' },
    body: `<p>We build to <strong>WCAG 2.2 level AA</strong>. That means full keyboard operation, visible focus states, 4.5:1 text contrast, reduced-motion support and screen-reader-labelled controls for the cart drawer, menus and checkout.</p>
<p>Found a barrier? Email access@vennixstore.com with the page and what happened — we treat accessibility bugs as production bugs and aim to fix them within five business days.</p>`
  },
  {
    handle: 'contact', title: 'Contact', nav: true, template: 'contact',
    seo: { title: 'Contact Vennix', description: 'Reach the Vennix support team — we reply within one business day, Mon–Fri 9am–5pm EST.' },
    body: `<p>Average reply time: <strong>one business day</strong>, Mon–Fri 9am–5pm EST. For order questions include your order number, which starts with VEN-.</p>`
  }
];

const FAQ_DEFS = [
  { q: 'When will my order ship?', a: 'Orders placed before 2pm ET ship the same business day from our Brooklyn warehouse. You will get a tracking link by email the moment the label scans.', group: 'Shipping' },
  { q: 'How do returns work?', a: 'You have 30 days from delivery. Start a return from your account order history and we email a prepaid label the same day. Refunds hit your original payment method within 3–5 business days of arrival.', group: 'Shipping' },
  { q: 'Do you ship internationally?', a: 'Yes. Canada and the UK ship duties-prepaid (DDP). Elsewhere, duties and taxes are shown at checkout so there are no surprise fees at the door.', group: 'Shipping' },
  { q: 'What if I am between sizes?', a: 'Size up for layers, size down for compression pieces like the Flow Legging. Every product page carries a fit note from the product team, and exchanges are always free.', group: 'Sizing' },
  { q: 'How should I wash technical pieces?', a: 'Cold wash with like colours, no fabric softener (it clogs the wicking channels), and hang dry where you can. Details are on the care label inside every garment.', group: 'Sizing' },
  { q: 'What payment methods do you take?', a: 'All major cards, Shop Pay, Apple Pay, Google Pay and Vennix gift cards. We also offer 4 interest-free payments through Shop Pay Installments on orders over $50.', group: 'Payment' },
  { q: 'Is my payment information safe?', a: 'Yes. Card details are tokenised by our payment provider and never touch our servers. We are PCI-DSS SAQ-A compliant and every connection is TLS 1.3.', group: 'Payment' },
  { q: 'Do you really repair garments?', a: 'We do. Two years of free repairs on seams, zips and elastics. Email repairs@vennixstore.com with a photo and your order number.', group: 'Product' },
  { q: 'How do I track my order?', a: 'Use the tracking link in your shipping email, or enter your order number and email on our track order page. No account needed.', group: 'Product' }
];

const SIZE_CHARTS = {
  tops: {
    label: 'Tops, jackets & hoodies',
    columns: ['Size', 'Chest (in)', 'Chest (cm)', 'Body length (in)', 'Sleeve (in)'],
    rows: [['XS', '34–36', '86–91', '26.5', '32'], ['S', '36–38', '91–97', '27.5', '33'], ['M', '38–40', '97–102', '28.5', '34'], ['L', '40–42.5', '102–108', '29.5', '35'], ['XL', '42.5–45', '108–114', '30.5', '36'], ['XXL', '45–48', '114–122', '31.5', '37']]
  },
  bottoms: {
    label: 'Joggers, shorts & leggings',
    columns: ['Size', 'Waist (in)', 'Waist (cm)', 'Hip (in)', 'Inseam (in)'],
    rows: [['XS', '26–28', '66–71', '34–36', '27'], ['S', '28–30', '71–76', '36–38', '28'], ['M', '30–32', '76–81', '38–40', '29'], ['L', '32–34.5', '81–88', '40–42', '30'], ['XL', '34.5–37', '88–94', '42–44', '31'], ['XXL', '37–40', '94–102', '44–46', '32']]
  }
};

/* ------------------------------------------------------------------- seeding */
function seedProducts() {
  const now = Date.now();
  return PRODUCT_DEFS.map((def, i) => {
    const variants = [];
    def.colors.forEach(color => {
      const c = COLORS[color];
      def.sizes.forEach((size, si) => {
        const slug = def.handle.replace(/[^a-z0-9]/gi, '').slice(0, 12).toLowerCase();
        const sku = `VEN-${skuCode(def.handle)}-${color.slice(0, 2).toUpperCase()}-${size}`;
        variants.push({
          id: `var_${slug}_${color}_${size}`.toLowerCase(),
          sku,
          color: c.name,
          colorHex: c.hex,
          colorKey: color,
          size,
          price: def.price,
          compareAtPrice: def.compareAtPrice,
          stock: SOLD_OUT.includes(`${def.handle}/${color}/${size}`) ? 0 : stockFor(`${def.handle}/${color}/${size}`, 26),
          weight: def.weight,
          image: def.images[0].src,
          position: si
        });
      });
    });
    const totalStock = variants.reduce((sum, v) => sum + v.stock, 0);
    return {
      id: `prd_${String(i + 1).padStart(4, '0')}`,
      handle: def.handle,
      title: def.title,
      tagline: def.tagline,
      category: def.category,
      type: def.type,
      vendor: 'Vennix',
      status: 'active',
      publishedAt: daysAgo(60 - i * 5),
      updatedAt: new Date(now).toISOString(),
      createdAt: daysAgo(60 - i * 5),
      price: def.price,
      compareAtPrice: def.compareAtPrice,
      currency: 'USD',
      collections: def.collections,
      tags: def.tags,
      badges: def.badges,
      descriptionHtml: def.description,
      features: def.features,
      materials: def.materials,
      care: def.care,
      fit: def.fit,
      fitNotes: def.fitNotes,
      shippingWeight: def.weight,
      images: def.images,
      options: [
        { name: 'Colour', position: 1, values: def.colors.map(c => ({ name: COLORS[c].name, hex: COLORS[c].hex, key: c })) },
        { name: 'Size', position: 2, values: def.sizes.map(s => ({ name: s })) }
      ],
      variants,
      inventoryQuantity: totalStock,
      inventoryPolicy: 'deny',
      trackInventory: true,
      rating: def.rating,
      seo: def.seo,
      // opt-in add-on; products without a block offer no personalisation at all
      personalization: def.personalization || null,
      taxCode: 'TX-APPAREL'
    };
  });
}

function seed() {
  const db = store.reset();
  db.settings = {
    brandName: 'Vennix',
    legalName: 'Vennix',
    tagline: 'Modern clothing & active essentials.',
    supportEmail: 'support@vennixstore.com',
    supportPhone: '',
    address: { line1: '44 Wythe Avenue', city: 'Brooklyn', province: 'NY', zip: '11249', country: 'United States' },
    currency: 'USD',
    currencySymbol: '$',
    domain: 'vennixstore.com',
    freeShippingThreshold: 5000,
    taxIncluded: false,
    defaultTaxRate: 0.06625,
    lowStockThreshold: 5,
    announcements: [
      'Free standard shipping on US orders over $50',
      'Capsule 01 — 8 styles, one palette. Now in stock.',
      'Free exchanges and 2-year repairs on every piece'
    ],
    socials: {
      // only the networks the brand actually runs, in display order
      tiktok: 'https://www.tiktok.com/@vennixstore',
      pinterest: 'https://www.pinterest.com/vennixstore',
      linkedin: 'https://www.linkedin.com/company/vennixstore'
    },
    payments: { provider: 'Card Payments', shopPay: true, applePay: true, googlePay: true, giftCards: true, installments: true, testMode: true },
    trustBadges: [
      { icon: 'truck', title: 'Free shipping over $50', body: 'Tracked, 4–6 business days' },
      { icon: 'refresh', title: '30-day returns', body: 'Prepaid label, free exchanges' },
      { icon: 'lock', title: 'Secure checkout', body: 'PCI-DSS, tokenised cards' },
      { icon: 'leaf', title: 'Made responsibly', body: 'Audited mills, repair service' }
    ],
    // Admin credentials. Prefer environment variables; fall back to a random
    // one-time password on first seed (printed to stdout) so a deployment
    // never ships with the demo password `vennix123` accidentally enabled.
    admin: {
      email: process.env.ADMIN_EMAIL || 'admin@vennixstore.com',
      name: 'Iris Nakamura'
    },
    // order numbers and SKUs carry the brand, so they follow a rebrand too
    orderPrefix: 'VEN',
    // Monogramming defaults. A product opts in with its own `personalization`
    // block; anything it does not override is inherited from here.
    personalization: {
      enabled: true,
      label: 'Monogramming',
      price: 2000,
      maxChars: 3,
      minChars: 1,
      placement: 'Left cuff',
      note: 'Monogrammed pieces are personalised for you and cannot be returned.'
    },
    features: { wishlist: true, reviews: true, journal: true, giftNote: true, sizeGuide: true, recentlyViewed: true },
    seo: { title: 'Vennix — Modern clothing & active essentials', description: 'Modern clothing and active essentials, chosen for how they move and how they last. Free shipping over $50, 30-day returns, two-year repairs.' }
  };
  // --- admin credentials ---------------------------------------------------
  // Env-provided admin password wins (e.g. ADMIN_PASSWORD on PaaS). If we are
  // in a production-like environment and no ADMIN_PASSWORD was supplied,
  // generate a one-time password and log it once so the deployer can sign in.
  // In dev we fall back to the documented demo password.
  const envPassword = process.env.ADMIN_PASSWORD;
  const isProdEnv = process.env.NODE_ENV === 'production';
  let adminPassword = envPassword;
  let generatedPassword = null;
  if (!adminPassword && isProdEnv) {
    generatedPassword = crypto.randomBytes(6).toString('base64url');
    adminPassword = generatedPassword;
  }
  if (!adminPassword) adminPassword = 'vennix123';

  const adminCreds = auth.hashPassword(adminPassword);
  db.settings.admin.passwordHash = adminCreds.hash;
  db.settings.admin.salt = adminCreds.salt;

  if (generatedPassword) {
    console.log('');
    console.log('  ⚠️  ADMIN FIRST-RUN PASSWORD (save this — it will not be shown again)');
    console.log(`      Email:    ${db.settings.admin.email}`);
    console.log(`      Password: ${generatedPassword}`);
    console.log('');
  } else if (envPassword) {
    console.log(`[seed] admin credentials loaded from ADMIN_EMAIL / ADMIN_PASSWORD (${db.settings.admin.email})`);
  }

  db.products = seedProducts();

  /* ------------------------------- gift cards ------------------------------- */
  db.products.push({
    id: 'prd_gift01',
    handle: 'gift-card',
    title: 'Vennix Gift Card',
    tagline: 'Delivered by email within minutes',
    category: 'gift', type: 'Gift Card', vendor: 'Vennix',
    status: 'active', publishedAt: daysAgo(58), createdAt: daysAgo(58), updatedAt: new Date().toISOString(),
    price: 10000, compareAtPrice: null, currency: 'USD',
    collections: [], tags: ['gift-card', 'digital', 'gift'], badges: [],
    digital: true, giftCard: true,
    descriptionHtml: `<p>A Vennix gift card, delivered by email within minutes of checkout. No expiry, no fees, and it works on everything in the range — including sale pieces.</p><p>Add a recipient name and a note at checkout and we will include it in the email. Physical letterpress cards are available in the Brooklyn studio.</p>`,
    features: ['Delivered by email within minutes', 'No expiry date and no fees', 'Valid online and in the Brooklyn studio', 'Redeemable against sale items', 'Balance check at checkout'],
    materials: 'Digital delivery', care: 'Treat it like cash — codes cannot be replaced once redeemed.',
    fit: 'Any size, any colour, always in stock.', fitNotes: '',
    shippingWeight: 0,
    images: [{ src: `${IMG}/gift-card.svg`, alt: 'Vennix digital gift card' }],
    options: [
      { name: 'Colour', position: 1, values: [{ name: 'Studio Black', hex: '#191614', key: 'ink' }] },
      { name: 'Size', position: 2, values: [{ name: '$50.00' }, { name: '$100.00' }, { name: '$200.00' }] }
    ],
    variants: [
      { id: 'var_gift_5000', sku: 'VEN-GIFT-50', color: 'Studio Black', colorHex: '#191614', colorKey: 'ink', size: '$50.00', price: 5000, compareAtPrice: null, stock: 999, weight: 0, image: `${IMG}/gift-card.svg`, position: 0 },
      { id: 'var_gift_10000', sku: 'VEN-GIFT-100', color: 'Studio Black', colorHex: '#191614', colorKey: 'ink', size: '$100.00', price: 10000, compareAtPrice: null, stock: 999, weight: 0, image: `${IMG}/gift-card.svg`, position: 1 },
      { id: 'var_gift_20000', sku: 'VEN-GIFT-200', color: 'Studio Black', colorHex: '#191614', colorKey: 'ink', size: '$200.00', price: 20000, compareAtPrice: null, stock: 999, weight: 0, image: `${IMG}/gift-card.svg`, position: 2 }
    ],
    inventoryQuantity: 999, inventoryPolicy: 'continue', trackInventory: false,
    seo: { title: 'Vennix Gift Card — Digital Delivery | Vennix', description: 'A digital Vennix gift card delivered by email within minutes. No expiry, valid on everything including sale.' },
    taxCode: 'TX-GIFTCARD'
  });

  db.collections = [
    { id: 'col_01', handle: 'all', title: 'All Products', description: 'The full Vennix range — Capsule 01 and the pieces that started it.', image: `${IMG}/blog-1.jpg`, productHandles: db.products.map(p => p.handle), featured: false, sortOrder: 'manual', seo: { title: 'All Products | Vennix', description: 'Shop every piece in the Vennix range.' } },
    { id: 'col_02', handle: 'women', title: "Women's", description: 'Leggings, bras and layers cut for training days and everything after.', image: `${IMG}/lookbook-2.jpg`, productHandles: ['flow-high-rise-legging-28', 'ribbed-seamless-sports-bra', 'summit-packable-windbreaker'], featured: true, sortOrder: 'manual', seo: { title: "Women's Training & Everyday | Vennix", description: 'Shop women\'s leggings, sports bras, layers and accessories from Vennix.' } },
    { id: 'col_03', handle: 'men', title: "Men's", description: 'Heavyweight fleece, technical layers and bottoms built to be lived in.', image: `${IMG}/p-atlas-hoodie.jpg`, productHandles: ['atlas-heavyweight-hoodie', 'everyday-pima-crew-tee', 'velocity-long-sleeve-base-layer', 'kinetic-7-inch-training-short', 'everyday-brushed-fleece-jogger', 'summit-packable-windbreaker'], featured: true, sortOrder: 'manual', seo: { title: "Men's Training & Everyday | Vennix", description: 'Shop men\'s hoodies, tees, joggers and technical layers from Vennix.' } },
    { id: 'col_04', handle: 'active', title: 'Active', description: 'Technical pieces tested at pace — wicking knits, packable shells, compression.', image: `${IMG}/lookbook-2.jpg`, productHandles: ['velocity-long-sleeve-base-layer', 'kinetic-7-inch-training-short', 'summit-packable-windbreaker', 'flow-high-rise-legging-28', 'ribbed-seamless-sports-bra'], featured: true, sortOrder: 'manual', seo: { title: 'Active & Performance | Vennix', description: 'Technical training pieces: base layers, shorts, shells, leggings and bras.' } },
    { id: 'col_05', handle: 'essentials', title: 'Everyday Essentials', description: 'The pieces you reach for without thinking. Heavyweights, in a fixed palette.', image: `${IMG}/p-everyday-tee.jpg`, productHandles: ['atlas-heavyweight-hoodie', 'everyday-pima-crew-tee', 'everyday-brushed-fleece-jogger'], featured: true, sortOrder: 'manual', seo: { title: 'Everyday Essentials | Vennix', description: 'Heavyweight hoodies, Pima tees and brushed fleece joggers — the everyday layer of the range.' } },
    { id: 'col_06', handle: 'new-in', title: 'New In', description: 'The newest additions to Capsule 01, straight off the loom.', image: `${IMG}/p-summit-windbreaker.jpg`, productHandles: ['atlas-heavyweight-hoodie', 'everyday-pima-crew-tee', 'kinetic-7-inch-training-short', 'summit-packable-windbreaker', 'ribbed-seamless-sports-bra'], featured: true, sortOrder: 'manual', seo: { title: 'New In | Vennix', description: 'The newest Vennix pieces.' } },
    { id: 'col_07', handle: 'bestsellers', title: 'Bestsellers', description: 'What our customers keep coming back for.', image: `${IMG}/p-atlas-hoodie.jpg`, productHandles: ['atlas-heavyweight-hoodie', 'flow-high-rise-legging-28', 'everyday-brushed-fleece-jogger', 'velocity-long-sleeve-base-layer'], featured: false, sortOrder: 'manual', seo: { title: 'Bestsellers | Vennix', description: 'The most-loved Vennix pieces, ranked by units sold.' } }
  ];

  db.discounts = [
    { id: 'dsc_01', code: 'WELCOME10', type: 'percent', value: 10, minSubtotal: 0, usageLimit: null, used: 0, active: true, description: '10% off your first order', startsAt: daysAgo(90), endsAt: null },
    { id: 'dsc_02', code: 'FREESHIP', type: 'shipping', value: 0, minSubtotal: 5000, usageLimit: null, used: 0, active: true, description: 'Free shipping on orders over $50', startsAt: daysAgo(90), endsAt: null },
    { id: 'dsc_03', code: 'CAPSULE20', type: 'percent', value: 20, minSubtotal: 15000, usageLimit: 500, used: 128, active: true, description: '20% off orders over $150', startsAt: daysAgo(20), endsAt: new Date(TODAY.getTime() + 25 * 864e5).toISOString() },
    { id: 'dsc_04', code: 'STUDIO25', type: 'fixed', value: 2500, minSubtotal: 12000, usageLimit: 200, used: 200, active: true, description: '$25 off orders over $120 (sold out)', startsAt: daysAgo(60), endsAt: daysAgo(2) }
  ];

  const custDefs = [
    { first: 'Hannah', last: 'Bergstrom', email: 'hannah.b@example.com', city: 'Brooklyn', province: 'NY', zip: '11211', orders: 4, since: 210, tags: ['vip', 'run-club'] },
    { first: 'Marcus', last: 'Turay', email: 'marcus.t@example.com', city: 'Jersey City', province: 'NJ', zip: '07302', orders: 3, since: 160, tags: ['rewards'] },
    { first: 'Aiyana', last: 'Jackson', email: 'aiyana.j@example.com', city: 'Chicago', province: 'IL', zip: '60622', orders: 2, since: 120, tags: [] },
    { first: 'Owen', last: 'Halvorsen', email: 'owen.h@example.com', city: 'Portland', province: 'OR', zip: '97209', orders: 1, since: 60, tags: ['first-order'] },
    { first: 'Mei', last: 'Lin', email: 'mei.l@example.com', city: 'San Francisco', province: 'CA', zip: '94110', orders: 2, since: 90, tags: ['rewards'] },
    { first: 'Daniel', last: 'Okafor', email: 'daniel.o@example.com', city: 'Austin', province: 'TX', zip: '78702', orders: 1, since: 30, tags: [] }
  ];

  db.customers = custDefs.map((c, i) => {
    const pw = auth.hashPassword('password123');
    return {
      id: `cus_${String(i + 1).padStart(4, '0')}`,
      email: c.email.toLowerCase(),
      firstName: c.first, lastName: c.last,
      phone: `+1 (${200 + i}) 555-01${String(i).padStart(2, '0')}`,
      passwordHash: pw.hash, salt: pw.salt,
      acceptsMarketing: i % 3 !== 2,
      tags: c.tags,
      note: '',
      addresses: [{ id: `adr_${i + 1}`, label: 'Home', firstName: c.first, lastName: c.last, line1: `${118 + i * 7} ${['Wythe Ave', 'Grand St', 'Bloomingdale Rd', 'NW Quimby St', 'Valencia St', 'E 6th St'][i]}`, line2: i % 2 ? 'Apt 4B' : '', city: c.city, province: c.province, zip: c.zip, country: 'United States', phone: `+1 (${200 + i}) 555-01${String(i).padStart(2, '0')}`, isDefault: true }],
      createdAt: daysAgo(c.since),
      marketingSource: 'organic',
      ordersCount: c.orders,
      totalSpent: 0
    };
  });

  /* ---------------------------- orders & reviews ---------------------------- */
  const products = db.products;
  const byHandle = h => products.find(p => p.handle === h);
  const orderPlan = [
    { customer: 0, days: 1, status: 'paid', items: [['flow-high-rise-legging-28', 'Charcoal', 'S', 1], ['ribbed-seamless-sports-bra', 'Ink', 'S', 1]], shipping: 'express', discount: 'WELCOME10' },
    { customer: 1, days: 2, status: 'fulfilled', items: [['atlas-heavyweight-hoodie', 'Fog Heather', 'L', 1]], shipping: 'standard', discount: null },
    { customer: 3, days: 4, status: 'fulfilled', items: [['velocity-long-sleeve-base-layer', 'Ink', 'M', 2]], shipping: 'standard', discount: 'FREESHIP' },
    { customer: 4, days: 6, status: 'paid', items: [['summit-packable-windbreaker', 'Clay', 'S', 1], ['flow-high-rise-legging-28', 'Ink', 'XS', 1]], shipping: 'standard', discount: null },
    { customer: 2, days: 9, status: 'fulfilled', items: [['everyday-brushed-fleece-jogger', 'Clay', 'M', 1], ['everyday-pima-crew-tee', 'Bone', 'M', 2]], shipping: 'standard', discount: 'CAPSULE20' },
    { customer: 5, days: 12, status: 'refunded', items: [['kinetic-7-inch-training-short', 'Charcoal', 'S', 1]], shipping: 'standard', discount: null, refunded: true },
    { customer: 0, days: 20, status: 'fulfilled', items: [['atlas-heavyweight-hoodie', 'Clay', 'M', 1], ['everyday-brushed-fleece-jogger', 'Charcoal', 'M', 1]], shipping: 'overnight', discount: null },
    { customer: 4, days: 34, status: 'fulfilled', items: [['everyday-pima-crew-tee', 'Ink', 'S', 3]], shipping: 'standard', discount: 'WELCOME10' }
  ];

  let seq = 0;
  const orders = orderPlan.map((plan, i) => {
    seq += 1;
    const customer = db.customers[plan.customer];
    const items = plan.items.map(([handle, color, size, qty]) => {
      const product = byHandle(handle);
      const variant = product.variants.find(v => v.color === color && v.size === size) || product.variants[0];
      return {
        id: `${variant.id}-${i}`, productId: product.id, handle: product.handle, title: product.title,
        variantId: variant.id, color: variant.color, size: variant.size, sku: variant.sku,
        price: variant.price, compareAtPrice: variant.compareAtPrice, quantity: qty,
        image: product.images[0].src, weight: variant.weight
      };
    });
    const subtotal = items.reduce((s, it) => s + it.price * it.quantity, 0);
    const discount = plan.discount ? commerce.evaluateDiscount(db.discounts.find(d => d.code === plan.discount), subtotal) : null;
    const discountAmount = discount && discount.valid ? discount.amount : 0;
    const shipFree = discount && discount.valid && discount.freeshipping;
    const shippingCost = shipFree ? 0 : commerce.shippingCost(plan.shipping, subtotal - discountAmount);
    const tax = commerce.taxFor({ province: customer.addresses[0].province, country: 'United States' }, subtotal - discountAmount);
    const total = subtotal - discountAmount + shippingCost + tax.amount;
    const placedAt = daysAgo(plan.days);
    return {
      id: `ord_${String(seq).padStart(4, '0')}`,
      number: orderNumber(seq),
      sequence: seq,
      email: customer.email,
      customerId: customer.id,
      customerName: `${customer.firstName} ${customer.lastName}`,
      items,
      subtotal, discount: discount && discount.valid ? { code: discount.code, amount: discount.amount, label: discount.label, freeShipping: !!discount.freeshipping } : null,
      discountAmount,
      shipping: { method: plan.shipping, label: commerce.SHIPPING_METHODS.find(m => m.id === plan.shipping).label, amount: shippingCost },
      tax: { name: tax.name, rate: tax.rate, amount: tax.amount },
      total,
      currency: 'USD',
      status: plan.status,
      financialStatus: plan.status === 'refunded' ? 'refunded' : 'paid',
      fulfillmentStatus: plan.status === 'fulfilled' ? 'fulfilled' : 'unfulfilled',
      fulfillment: plan.status === 'fulfilled' ? { carrier: 'UPS', tracking: `1Z${Math.random().toString().slice(2, 12)}`, fulfilledAt: daysAgo(plan.days - 1) } : null,
      shippingAddress: customer.addresses[0],
      billingAddress: customer.addresses[0],
      payment: { brand: ['visa', 'mastercard', 'amex'][i % 3], last4: String(4000 + i * 137).slice(-4), authCode: `AUTH${Math.random().toString(36).slice(2, 7).toUpperCase()}`, mode: 'sandbox' },
      timeline: [
        { at: placedAt, label: 'Order placed', note: 'Confirmation email sent' },
        { at: placedAt, label: 'Payment captured', note: `Authorised via ${db.settings.payments.provider}` },
        ...(plan.status !== 'paid' ? [{ at: daysAgo(plan.days - 1), label: plan.status === 'refunded' ? 'Refunded' : 'Fulfilled', note: plan.status === 'refunded' ? 'Returned — refund issued to original card' : 'Shipped from Brooklyn studio' }] : [])
      ],
      note: '',
      tags: plan.status === 'refunded' ? ['return'] : [],
      source: 'Online Store',
      createdAt: placedAt,
      updatedAt: placedAt
    };
  });

  db.orders = orders;
  db.customers.forEach(c => {
    const own = orders.filter(o => o.customerId === c.id && o.status !== 'refunded');
    c.ordersCount = own.length;
    c.totalSpent = own.reduce((s, o) => s + o.total, 0);
  });

  let rseq = 0;
  const seedReview = (def, status) => {
    rseq += 1;
    const product = byHandle(def.handle);
    return {
      id: `rev_${String(rseq).padStart(4, '0')}`,
      productId: product.id, productHandle: def.handle, productTitle: product.title,
      rating: def.rating, title: def.title, body: def.body, author: def.author,
      email: `${def.author.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '')}@example.com`,
      verified: def.verified, status,
      helpful: def.helpful || 0,
      createdAt: daysAgo(def.daysAgo),
      // reviewer locale makes the storefront feel lived-in; never a real address
      location: def.location || null,
      reply: null
    };
  };

  db.reviews = REVIEW_DEFS.map(def => seedReview(def, 'published'));
  db.reviews = db.reviews.concat(PENDING_REVIEWS.map(def => seedReview(def, 'pending')));
  // helpful votes can never exceed the number of people who own the product
  db.reviews.forEach((r, i) => { r.helpful = Math.min(r.helpful, 4 - (i % 2)); });

  // Product ratings come straight from published reviews — no invented totals.
  // Products without reviews report zero so the UI can invite a first review.
  db.products.forEach(p => {
    const revs = db.reviews.filter(r => r.productHandle === p.handle && r.status === 'published');
    if (!revs.length) { p.rating = { avg: 0, count: 0, distribution: [0, 0, 0, 0, 0] }; return; }
    const avg = revs.reduce((sum, r) => sum + r.rating, 0) / revs.length;
    p.rating = {
      avg: Math.round(avg * 10) / 10,
      count: revs.length,
      distribution: [5, 4, 3, 2, 1].map(n => revs.filter(r => r.rating === n).length)
    };
  });

  db.pages = PAGE_DEFS.map((p, i) => ({ id: `pag_${String(i + 1).padStart(3, '0')}`, ...p, updatedAt: daysAgo(30) }));
  db.posts = POST_DEFS.map((p, i) => ({ id: `pst_${String(i + 1).padStart(3, '0')}`, ...p, author: p.author, status: 'published' }));
  // Back-in-stock requests. Empty on a fresh seed on purpose: they are created
  // by customers, never manufactured for the demo.
  db.backInStock = [];

  db.subscribers = [
    { id: 'sub_0001', email: 'jordan.k@example.com', source: 'footer', status: 'subscribed', createdAt: daysAgo(3) },
    { id: 'sub_0002', email: 'ellie.p@example.com', source: 'popup', status: 'subscribed', createdAt: daysAgo(11) },
    { id: 'sub_0003', email: 'rafa.d@example.com', source: 'footer', status: 'subscribed', createdAt: daysAgo(19) },
    { id: 'sub_0004', email: 'gone@example.com', source: 'footer', status: 'unsubscribed', createdAt: daysAgo(40) }
  ];
  db.messages = [
    { id: 'msg_0001', name: 'Claire Deveraux', email: 'claire.d@example.com', topic: 'Order status', orderNumber: 'VEN-1002', message: 'Hi — I ordered the Atlas hoodie on Tuesday and the tracking has not updated. Is everything on schedule?', status: 'open', createdAt: daysAgo(0.4) },
    { id: 'msg_0002', name: 'Ben Ashford', email: 'ben.a@example.com', topic: 'Sizing', orderNumber: '', message: 'Between a Large and XL in the fleece jogger at 6\'2". Which would you recommend?', status: 'resolved', createdAt: daysAgo(6), reply: 'For a taller frame we suggest the XL — it keeps the tapered leg without pulling the rise. — Iris' }
  ];
  db.carts = [
    { id: 'crt_seed01', items: [{ id: 'li_1', productId: byHandle('atlas-heavyweight-hoodie').id, variantId: byHandle('atlas-heavyweight-hoodie').variants[0].id, quantity: 1, price: 12800 }], email: 'abandoned@example.com', status: 'active', createdAt: daysAgo(0.8), updatedAt: daysAgo(0.6), subtotal: 12800 }
  ];

  db.sessions = [];
  db.activity = [
    { id: 'act_0001', actor: 'system', action: 'store.seeded', detail: `Capsule 01 — ${db.products.length} products, ${db.collections.length} collections`, at: new Date().toISOString() },
    { id: 'act_0002', actor: 'admin@vennixstore.com', action: 'order.fulfilled', detail: `Order ${orderNumber(2)} fulfilled via UPS`, at: daysAgo(1) },
    { id: 'act_0003', actor: 'admin@vennixstore.com', action: 'product.updated', detail: 'Atlas Heavyweight Hoodie — price and stock updated', at: daysAgo(2) }
  ];
  db.inventoryLog = [
    { id: 'inv_0001', sku: 'VEN-AHH-FO-M', delta: -1, reason: 'Order VEN-1002', at: daysAgo(2) },
    { id: 'inv_0002', sku: 'VEN-AHH-FO-M', delta: 40, reason: 'Restock — Portugal batch 07', at: daysAgo(16) }
  ];
  db.emails = [];
  db.meta.seededAt = new Date().toISOString();
  db.meta.sizeCharts = SIZE_CHARTS;
  db.meta.faqs = FAQ_DEFS;
  db.meta.states = commerce.STATES;
  db.meta.shippingMethods = commerce.SHIPPING_METHODS;
  db.meta.taxRates = commerce.TAX_RATES;

  store.saveNow();
  return db;
}

/**
 * Apply ADMIN_EMAIL / ADMIN_PASSWORD env vars on every boot so rotating the
 * environment on an existing deployment actually rotates the credentials,
 * rather than only taking effect on the first empty-DB seed. In production
 * without ADMIN_PASSWORD we only generate a one-time password when the stored
 * credential is still the demo password or missing — never on every boot, so
 * a password printed by `npm run reset` remains valid until the operator
 * explicitly rotates it.
 */
function applyEnvAdmin() {
  const db = store.getDb();
  if (!db.settings) db.settings = {};
  if (!db.settings.admin) db.settings.admin = {};

  const envEmail = process.env.ADMIN_EMAIL;
  if (envEmail && envEmail !== db.settings.admin.email) {
    db.settings.admin.email = envEmail;
    console.log(`[seed] admin email updated from ADMIN_EMAIL: ${envEmail}`);
  }

  const envPassword = process.env.ADMIN_PASSWORD;
  if (envPassword) {
    const pw = auth.hashPassword(envPassword);
    db.settings.admin.passwordHash = pw.hash;
    db.settings.admin.salt = pw.salt;
    console.log(`[seed] admin password updated from ADMIN_PASSWORD (${db.settings.admin.email})`);
  } else if (process.env.NODE_ENV === 'production') {
    const curHash = db.settings.admin.passwordHash;
    const curSalt = db.settings.admin.salt;
    const isMissing = !curHash || !curSalt;
    let isDemo = false;
    try {
      isDemo = !isMissing && auth.verifyPassword('vennix123', curSalt, curHash);
    } catch { isDemo = false; }
    if (isMissing || isDemo) {
      const generated = crypto.randomBytes(6).toString('base64url');
      const pw = auth.hashPassword(generated);
      db.settings.admin.passwordHash = pw.hash;
      db.settings.admin.salt = pw.salt;
      console.log('');
      console.log('  ⚠️  ADMIN FIRST-RUN PASSWORD (production, ADMIN_PASSWORD not set — save this)');
      console.log(`      Email:    ${db.settings.admin.email}`);
      console.log(`      Password: ${generated}`);
      console.log('      Set ADMIN_PASSWORD in your environment for a stable credential.');
      console.log('');
    }
  }
  store.save();
}

function ensureSeeded() {
  store.load();
  const db = store.getDb();
  if (!db.products || !db.products.length) {
    console.log('[seed] empty store detected — seeding Capsule 01');
    seed();
  } else {
    applyEnvAdmin();
  }
  return store.getDb();
}

module.exports = { seed, ensureSeeded, PRODUCT_DEFS, PAGE_DEFS, FAQ_DEFS, REVIEW_DEFS, SIZE_CHARTS };
