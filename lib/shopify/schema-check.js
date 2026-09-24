'use strict';
/**
 * schema-check.js — prove the hand-written GraphQL documents in operations.js
 * still match the schema of the store we are talking to.
 *
 * The documents are pinned to one API version, and a version bump can quietly
 * rename a field, drop an argument, or tighten nullability ("Field 'x' doesn't
 * accept argument 'y'", "Nullability mismatch on variable $note"). Shopify only
 * tells us at query-validation time — which is a shopper-visible failure. This
 * introspects the live schema and checks every field, argument and argument
 * type the storefront sends, so drift is caught by `npm run verify:live`
 * instead.
 *
 * It is deliberately tiny: one introspection query over the handful of types we
 * touch, and tables of what we expect. `runSchemaCheck` takes the `gql`
 * function as an argument so it can be unit-tested without a store.
 */

/** Types the storefront selects from. */
const TYPES = ['QueryRoot', 'Mutation', 'Product', 'ProductVariant', 'Cart', 'CartLine', 'CartCost', 'Blog', 'Article', 'Page', 'Shop'];

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

/**
 * Mutation arguments we pass, with the type our documents declare.
 *
 * A nullable variable cannot be used where the schema wants a non-null
 * argument — that is a hard error ("Nullability mismatch") before the mutation
 * runs. The opposite (a non-null variable for a nullable argument) is safe.
 */
const MUTATION_ARGS = [
  ['Mutation', 'cartCreate', { input: 'CartInput!' }],
  ['Mutation', 'cartLinesAdd', { cartId: 'ID!', lines: '[CartLineInput!]!' }],
  ['Mutation', 'cartLinesUpdate', { cartId: 'ID!', lines: '[CartLineUpdateInput!]!' }],
  ['Mutation', 'cartLinesRemove', { cartId: 'ID!', lineIds: '[ID!]', viewKeys: '[String!]' }],
  ['Mutation', 'cartDiscountCodesUpdate', { cartId: 'ID!', discountCodes: '[String!]!' }],
  ['Mutation', 'cartNoteUpdate', { cartId: 'ID!', note: 'String!' }]
];

/**
 * Fields we use that Shopify has deprecated. They are reported as warnings —
 * the code already copes when they disappear.
 */
const DEPRECATED_BUT_USED = [['CartCost', 'totalTaxAmount'], ['Article', 'author']];

/** The nested ofType shape we read off every argument type. */
const TYPE_SHAPE = `kind name ofType { kind name ofType { kind name ofType { kind name } } }`;

/*
 * The shape is interpolated directly into every __type block. (An earlier
 * version embedded a literal "${TYPE_SHAPE}" placeholder and substituted it
 * afterwards with String.replace — which only replaces the FIRST match, so 10
 * of the 11 blocks kept the placeholder and the live parser rejected the
 * document: Expected NAME, actual: VAR_SIGN ("$").)
 */
const INTROSPECTION_QUERY = `query VennixSchemaCheck {
${TYPES.map(t => `  ${t}: __type(name: "${t}") {
    name
    fields(includeDeprecated: true) {
      name
      isDeprecated
      args { name type { ${TYPE_SHAPE} } }
    }
  }`).join('\n')}
}`;

function introspectionQuery() {
  return INTROSPECTION_QUERY;
}

/** Flatten an introspected type into GraphQL syntax, e.g. "[String!]!". */
function typeString(type) {
  if (!type) return '';
  if (type.kind === 'NON_NULL') return `${typeString(type.ofType)}!`;
  if (type.kind === 'LIST') return `[${typeString(type.ofType)}]`;
  return type.name || '';
}

/**
 * Can a variable declared as `ours` be passed to an argument of type `theirs`?
 * Identical types always work; a non-null variable is also fine for a nullable
 * argument. Anything else is a nullability mismatch.
 */
function assignable(ours, theirs) {
  const norm = s => String(s || '').replace(/\s+/g, '');
  const a = norm(ours);
  const b = norm(theirs);
  if (a === b) return true;
  if (a.endsWith('!') && a.slice(0, -1) === b) return true; // stricter is safe
  return false;
}

/**
 * Compare our declared mutation argument types against the live schema.
 * @returns {string[]} human-readable mismatches
 */
function checkNullability(argTypes, table = MUTATION_ARGS) {
  const problems = [];
  for (const [type, field, args] of table) {
    const schemaArgs = argTypes[type] && argTypes[type][field];
    if (!schemaArgs) continue; // unknown mutation: nothing to assert
    for (const [name, declared] of Object.entries(args)) {
      if (!(name in schemaArgs)) continue; // missing args are caught elsewhere
      const actual = schemaArgs[name];
      if (!assignable(declared, actual)) {
        problems.push(`${type}.${field}(${name}) — schema wants ${actual}, document declares ${declared}`);
      }
    }
  }
  return problems;
}

/**
 * @param {Function} gql  the Storefront client's `gql(query, variables)`
 * @returns {Promise<{ok: boolean, types: Object, argTypes: Object, deprecated: Object,
 *                    missingFields: string[], missingArgs: string[], nullability: string[], error: string}>}
 */
async function runSchemaCheck(gql) {
  const result = {
    ok: false, types: {}, argTypes: {}, deprecated: {},
    missingFields: [], missingArgs: [], nullability: [], error: ''
  };

  let data;
  try {
    data = await gql(introspectionQuery(), {});
  } catch (err) {
    result.error = String((err && err.message) || err || 'introspection failed');
    return result;
  }

  for (const t of TYPES) {
    const type = data && data[t];
    if (!type || !Array.isArray(type.fields)) continue;
    const name = type.name || t;
    result.types[name] = {};
    result.argTypes[name] = {};
    result.deprecated[name] = {};
    for (const f of type.fields) {
      result.types[name][f.name] = (f.args || []).map(a => a.name);
      result.argTypes[name][f.name] = Object.fromEntries(
        (f.args || []).map(a => [a.name, typeString(a.type)])
      );
      if (f.isDeprecated) result.deprecated[name][f.name] = true;
    }
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

  result.nullability = checkNullability(result.argTypes);

  result.ok = result.missingFields.length === 0
    && result.missingArgs.length === 0
    && result.nullability.length === 0;
  return result;
}

/** Deprecated fields we still use that have been removed entirely. */
function deprecatedStillPresent(types) {
  return DEPRECATED_BUT_USED
    .filter(([type, field]) => types[type] && !(field in types[type]))
    .map(([type, field]) => `${type}.${field}`);
}

/** Deprecated fields we still use that are present but flagged deprecated. */
function deprecatedInUse(deprecatedMap) {
  return DEPRECATED_BUT_USED
    .filter(([type, field]) => deprecatedMap[type] && deprecatedMap[type][field])
    .map(([type, field]) => `${type}.${field}`);
}

module.exports = {
  TYPES, EXPECTED, MUTATION_ARGS, DEPRECATED_BUT_USED,
  INTROSPECTION_QUERY: introspectionQuery(),
  typeString, assignable, checkNullability, runSchemaCheck,
  deprecatedStillPresent, deprecatedInUse
};
