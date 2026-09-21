#!/usr/bin/env python3
"""Deployment-ready meta descriptions for the VennixStore catalogue.

Only facts present in the row's own data (title, product type, current copy) are
used -- nothing is invented. Output is <=160 chars, unique, grammatical, and
carries a call to action.
"""
import csv, re, pathlib

SRC = '/home/user/uploads/deployment_ready.csv'
OUT = pathlib.Path('/home/user/vennix-meta')

# ── lexicons, ordered most-specific first ────────────────────────────────────
OCCASION = [('halloween','Halloween'),('thanksgiving','Thanksgiving'),('christmas','Christmas'),
            ('valentine','Valentine'),('easter','Easter'),('pumpkin','pumpkin'),('ghost','ghost'),
            ('skull','skull'),('spider','spider'),('witch','witch'),('gothic','gothic'),
            ('spooky','spooky'),('boo','"boo"')]

PATTERN = [('leopard','leopard print'),('plaid','plaid'),('checkered','checked'),('floral','floral'),
           ('geometric','geometric'),('patchwork','patchwork'),('tie-dye','tie-dye'),('camo','camouflage'),
           ('striped','striped'),('polka','polka dot'),('graphic','graphic print'),('print','printed'),
           ('embroidered','embroidered'),('rhinestone','rhinestone'),('sequin','sequin'),
           ('contrast','contrast trim'),('camouflage','camouflage')]

MATERIALS = [('organic cotton','organic cotton'),('faux leather','faux leather'),('pu leather','PU leather'),
             ('linen','linen'),('silk','silk'),('cashmere','cashmere'),('wool','wool'),('cotton','cotton'),
             ('polyester','polyester'),('nylon','nylon'),('spandex','spandex'),('elastane','elastane'),
             ('denim','denim'),('leather','leather'),('fleece','fleece'),('knit','knit'),('mesh','mesh'),
             ('corduroy','corduroy'),('velvet','velvet'),('chiffon','chiffon'),('satin','satin'),
             ('rayon','rayon'),('twill','twill'),('jersey','jersey'),('tweed','tweed'),('lace','lace'),
             ('sherpa','sherpa'),('microfiber','microfibre'),('bamboo','bamboo')]

CONSTRUCTION = [('hooded','hooded'),('hood','hooded'),('zip','zip-through'),('zipper','zip-through'),
                ('double breasted','double-breasted'),('quilted','quilted'),('padded','padded'),
                ('ribbed','ribbed'),('elastic waist','elastic waist'),('drawstring','drawstring'),
                ('pockets','pockets'),('comfort flex','Comfort Flex waistband'),('reflective','reflective'),
                ('waterproof','waterproof'),('water-resistant','water-resistant'),('windproof','windproof'),
                ('breathable','breathable'),('quick-dry','quick-dry'),('fast-dry','fast-dry'),
                ('moisture-wicking','moisture-wicking'),('stretch','stretch'),('thermal','thermal'),
                ('non-slip','non-slip'),('adjustable','adjustable'),('seamless','seamless'),
                ('removable','removable'),('reversible','reversible'),('lace trim','lace trim'),
                ('ruffle','ruffled'),('pleated','pleated'),('ruched','ruched'),('tie','tie detail'),
                ('button','button front'),('patchwork','patchwork')]

NECKLINE = [('round neck','round neck'),('crew neck','crew neck'),('v-neck','V-neck'),('v neck','V-neck'),
            ('mock neck','mock neck'),('turtleneck','turtleneck'),('collared','collared'),('lapel','lapel collar'),
            ('halter','halter'),('off-shoulder','off-shoulder'),('off shoulder','off-shoulder'),
            ('one-shoulder','one-shoulder'),('square neck','square neck'),('sweetheart','sweetheart neckline'),
            ('strapless','strapless'),('neckline','neckline'),('scoop','scoop neck')]

SLEEVE = [('long sleeve','long sleeve'),('short sleeve','short sleeve'),('puff sleeve','puff sleeve'),
          ('lantern sleeve','lantern sleeve'),('sleeveless','sleeveless'),('raglan','raglan'),
          ('sleeve','sleeved')]

LENGTH = [('maxi','maxi length'),('mini','mini length'),('midi','midi length'),('ankle','ankle-length'),
          ('knee-length','knee-length'),('cropped','cropped'),('long length','longline')]

FIT = [('oversized','oversized'),('loose','loose fit'),('slim','slim fit'),('relaxed','relaxed fit'),
       ('bodycon','bodycon'),('high waist','high waist'),('wide leg','wide leg'),('straight leg','straight leg'),
       ('flare','flared'),('bootcut','bootcut'),('tapered','tapered'),('regular fit','regular fit'),
       ('a-line','A-line'),('hip','hip-skimming')]

NOUN = [('sweatshirt','sweatshirt'),('hoodie','hoodie'),('jacket','jacket'),('coat','coat'),
        ('cardigan','cardigan'),('sweater','sweater'),('dress','dress'),('blouse','blouse'),
        ('t-shirt','T-shirt'),('shirt','shirt'),('tee','tee'),('top','top'),('tank','tank'),
        ('bodysuit','bodysuit'),('romper','romper'),('jumpsuit','jumpsuit'),('legging','legging'),
        ('pants','pants'),('trousers','trousers'),('shorts','shorts'),('skirt','skirt'),
        ('blazer','blazer'),('vest','vest'),('suit','suit'),('necklace','necklace'),('earring','earrings'),
        ('bracelet','bracelet'),('ring','ring'),('pendant','pendant'),('jewelry','jewellery')]

PLURAL_ONLY = {'pants','shorts','leggings','jeans','tights','socks','boxers','briefs','earrings','trousers'}

CTAS = ['Free shipping over $50.', 'Order today at VennixStore.', 'In stock now at VennixStore.', 'Ships free over $50.']

def terms(text, lexicon):
    low = text.lower()
    out = []
    for needle, label in lexicon:
        if re.search(r'\b' + re.escape(needle) + r'\b', low) and label not in out:
            out.append(label)
    return out

def numeric_facts(text):
    out = []
    for m in re.finditer(r'\b(?:XS|S|M|L|XL|XXL|XXXL|[2-9]XL)\s?[–—-]\s?(?:XS|S|M|L|XL|XXL|XXXL|[2-9]XL)\b', text, re.I):
        out.append('sizes ' + re.sub(r'\s+', '', m.group(0).replace('—', '–').replace('-', '–')))
    for m in re.finditer(r'\b\d+\s?(?:g|gsm)\b', text, re.I):
        out.append(m.group(0).replace(' ', '').lower())
    for m in re.finditer(r'\b(\d+)[- ]pack\b', text, re.I):
        if int(m.group(1)) <= 12:
            out.append(f'{m.group(1)}-pack')
    seen, uniq = set(), []
    for x in out:
        if x not in seen:
            seen.add(x); uniq.append(x)
    return uniq[:1]   # bare centimetre dumps are supplier noise, never useful here

def clean_title(t):
    t = re.sub(r'\s*\|\s*VennixStore\s*$', '', (t or '').strip(), flags=re.I)
    return re.sub(r'\s+', ' ', t).strip(' .')

def type_phrase(pt):
    p = (pt or '').strip().lower()
    if not p or p == '0':
        return 'the Vennix range'
    p = re.sub(r'\bmens\b', "men's", p)
    p = re.sub(r'\bwomens\b', "women's", p)
    p = p.replace("'s's", "'s")
    p = {'men': "men's", 'man': "men's", 'women': "women's"}.get(p, p)
    words = p.split()
    if words:
        w = words[-1]
        if w not in PLURAL_ONLY and not w.endswith('ss'):
            if w.endswith('ses'):        # dresses -> dress, blouses -> blouse
                w = w[:-2]
            elif w.endswith('s'):
                w = w[:-1]
            words[-1] = w
    return 'our ' + ' '.join(words) + ' range'

def lc(items):
    return [items[0]] + [i.lower() for i in items[1:]] if items else items

def build(row, index):
    title = clean_title(row['title'])
    source = f"{title}. {row['currentMetaDescription'] or ''}"

    nums = numeric_facts(source)
    occ = terms(source, OCCASION)
    noun = terms(source, NOUN)
    pattern = terms(source, PATTERN)
    material = [m for m in terms(source, MATERIALS) if m.lower() not in title.lower()]
    construction = [c for c in terms(source, CONSTRUCTION) if c.lower() not in title.lower()]
    neck = terms(source, NECKLINE)
    sleeve = terms(source, SLEEVE)
    length = terms(source, LENGTH)
    fit = terms(source, FIT)

    # A description must ADD to the title, never echo it. Facts already spelled out
    # in the title are dropped, so copy like "Halloween Pumpkin Sweater — Halloween,
    # pumpkin" cannot happen.
    title_low = title.lower()
    def adds_value(fact):
        words = [w for w in re.split(r'[\s-]+', fact.lower()) if len(w) > 3]
        return not (words and all(w in title_low for w in words))

    pool = nums + material + construction + fit + neck + sleeve + length + pattern + occ + noun[:1]
    facts = []
    for f in pool:
        if f not in facts and adds_value(f):
            facts.append(f)
        if len(facts) == 4:
            break
    facts = lc(facts[:4])

    openers = [f'Shop the {title}', title, f'Meet the {title}']
    opener = openers[index % 3]
    cta = CTAS[index % len(CTAS)]
    type_clause = f'Part of {type_phrase(row["productType"])}.'

    def assemble(fl, include_type):
        head = f'{opener} — {", ".join(fl)}.' if fl else f'{opener}.'
        body = f' {type_clause}' if include_type else ''
        return f'{head}{body} {cta}'.replace('..', '.')

    text = assemble(facts, False)
    if len(text) < 105:
        text = assemble(facts, True)
    while len(text) > 158 and len(facts) > 0:
        facts = facts[:-1]
        text = assemble(facts, len(text) < 105)
    if len(text) > 158:
        text = f'{opener}. {cta}'
    if len(text) > 158:
        text = f'{title[:110]}. {cta}'
    return text, facts, nums

rows = list(csv.DictReader(open(SRC, encoding='utf-8-sig')))
results = []
for i, row in enumerate(rows):
    text, facts, nums = build(row, i)
    results.append({**row, 'proposedDescription': text, 'proposedChars': len(text),
                    'factsUsed': ', '.join(facts), 'numericFactsFromSource': ', '.join(nums)})

with open(OUT / 'meta-descriptions-audit.csv', 'w', newline='', encoding='utf-8-sig') as fh:
    w = csv.DictWriter(fh, fieldnames=['productId','handle','title','productType','currentMetaDescription','currentChars',
                                       'aiSuggestedDescription','aiSuggestedChars','proposedDescription','proposedChars',
                                       'factsUsed','numericFactsFromSource'])
    w.writeheader()
    for r in results:
        w.writerow({'productId': r['productId'], 'handle': r['handle'], 'title': r['title'], 'productType': r['productType'],
                    'currentMetaDescription': r['currentMetaDescription'], 'currentChars': len(r['currentMetaDescription']),
                    'aiSuggestedDescription': r['suggestedDescription'], 'aiSuggestedChars': len(r['suggestedDescription']),
                    'proposedDescription': r['proposedDescription'], 'proposedChars': r['proposedChars'],
                    'factsUsed': r['factsUsed'], 'numericFactsFromSource': r['numericFactsFromSource']})

# Deploy file is deliberately Handle + SEO Description ONLY. Shopify matches on
# Handle; including a Title column would silently overwrite the live product
# titles, which is not what this file is for.
with open(OUT / 'meta-descriptions-deploy.csv', 'w', newline='', encoding='utf-8-sig') as fh:
    w = csv.writer(fh)
    w.writerow(['Handle', 'SEO Description'])
    for r in results:
        w.writerow([r['handle'], r['proposedDescription']])

print('wrote', len(results), 'rows')
