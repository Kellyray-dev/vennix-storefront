'use strict';
/**
 * schema-check.js — prove the hand-written GraphQL documents in operations.js
 * still match the schema of the store we are talking to.
 *
 * The documents are pinned to one API version, and a version bump can quietly
 * rename a field or drop an argument ("Field 'media' doesn't accept argument
 * 'types'"). Shopify only tells us at query-validation time — which is a
 * shopper-visible failure. This introspects the live schema and checks every
 * field and argument the storefront sends, so drift is caught by
 * `npm run verify:live` instead.
 *
 * It is deliberately tiny: one introspection query over the handful of types we
 * touch, and a table of what we expect. `runSchemaCheck` takes the `gql`
 * function as an argument so it can be unit-tested without a store.
 */

/** Types the storefront selects from. */
const TYPES = ['QueryRoot', 'Product', 'ProductVariant', 'Cart', 'CartLine', 'CartCost', 'Blog', 'Article', 'Page', 'Shop'];

/**
 * [type, field, arguments our documents pass]
 *
 * Keep this in step with lib/shopify/operations.js: if you add an argument to a
 * document, add it here, and a store that rejects it will fail the live
 * verification instead of failing at runtime.
 */
const EXPECTED = [
  // queries
  ['QueryRoot', 'products', ['first', 'after']],
  ['QueryRoot', 'product', ['handle']],
  ['QueryRoot', 'collections', ['first']],
  ['QueryRoot', 'collection', ['handle']],
  ['QueryRoot', 'search', ['query', 'first', 'types']],
  ['QueryRoot', 'productRecommendations', ['productId']],
  ['QueryRoot', 'pages', ['first']],
  ['QueryRoot', 'blog', ['handle']],
  // product
  ['Product', 'media', ['first']],
  ['Product', 'variants', ['first']],
  ['Product', 'metafields', ['identifiers']],
  ['Product', 'seo', []],
  ['Product', 'featuredImage', []],
  ['ProductVariant', 'image', []],
  ['ProductVariant', 'selectedOptions', []],
  // cart
  ['Cart', 'lines', ['first']],
  ['Cart', 'discountApplications', []],
  ['Cart', 'discountCodes', []],
  ['Cart', 'attributes', []],
  ['CartLine', 'discountAllocations', ['lineLevelOnly']],
  ['CartLine', 'cost', []],
  ['CartCost', 'subtotalAmount', []],
  ['CartCost', 'totalAmount', []],
  ['CartCost', 'checkoutChargeAmount', []],
  // content (journal + pages)
  ['Blog', 'articles', ['first']],
  ['Article', 'contentHtml', []],
  ['Article', 'excerpt', []],
  ['Article', 'authorV2', []],
  ['Article', 'image', []],
  ['Article', 'tags', []],
  ['Page', 'body', []],
  // shop
  ['Shop', 'paymentSettings', []],
  ['Shop', 'primaryDomain', []]
];

const INTROSPECTION_QUERY = `query VennixSchemaCheck {
${TYPES.map(t => `  ${t}: __type(name: "${t}") { name fields { name args { name } } }`).join('\n')}
}`;

/**
 * @param {Function} gql  the Storefront client's `gql(query, variables)`
 * @returns {Promise<{ok: boolean, types: Object, missingFields: string[], missingArgs: string[], error: string}>}
 */
async function runSchemaCheck(gql) {
  const result = { ok: false, types: {}, missingFields: [], missingArgs: [], error: '' };

  let data;
  try {
    data = await gql(INTROSPECTION_QUERY, {});
  } catch (err) {
    result.error = String((err && err.message) || err || 'introspection failed');
    return result;
  }

  for (const t of TYPES) {
    const type = data && data[t];
    if (!type || !Array.isArray(type.fields)) continue;
    result.types[type.name || t] = Object.fromEntries(
      type.fields.map(f => [f.name, (f.args || []).map(a => a.name)])
    );
  }
  if (!Object.keys(result.types).length) {
    result.error = 'introspection returned no usable types';
    return result;
  }

  for (const [type, field, args] of EXPECTED) {
    const fields = result.types[type];
    if (!fields) continue; // unknown type: nothing to assert against
    if (!(field in fields)) { result.missingFields.push(`${type}.${field}`); continue; }
    for (const arg of args) {
      if (!fields[field].includes(arg)) result.missingArgs.push(`${type}.${field}(${arg})`);
    }
  }

  result.ok = result.missingFields.length === 0 && result.missingArgs.length === 0;
  return result;
}

/** Fields we use but that Shopify has deprecated — report before they vanish. */
const DEPRECATED_BUT_USED = [['CartCost', 'totalTaxAmount']];

function deprecatedStillPresent(types) {
  return DEPRECATED_BUT_USED
    .filter(([type, field]) => types[type] && !(field in types[type]))
    .map(([type, field]) => `${type}.${field}`);
}

module.exports = { TYPES, EXPECTED, INTROSPECTION_QUERY, runSchemaCheck, deprecatedStillPresent };
