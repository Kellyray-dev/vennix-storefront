'use strict';
/**
 * operations.js — the GraphQL documents the storefront sends to the
 * Storefront API (pinned API version in config). Normalizing happens in
 * normalize.js; these documents are the contract with Shopify.
 *
 * Notes:
 *  - Money is always requested as MoneyV2 ({ amount, currencyCode }).
 *  - Product options are derived from variant selectedOptions in normalize.js
 *    (avoids the ProductOption.values deprecation churn).
 *  - Metafields carry the VENNIX PDP content hooks (tagline, features,
 *    materials, care, fit, fit notes, monogram config, reviews) the same way
 *    the OS 2.0 theme reads them.
 */

const MONEY = 'money: MoneyV2 { amount currencyCode }';

const IMAGE_FIELDS = `
  url
  altText
  width
  height
`;

const VARIANT_FIELDS = `
  id
  title
  sku
  availableForSale
  quantityAvailable
  price { amount currencyCode }
  compareAtPrice { amount currencyCode }
  selectedOptions { name value }
  image { ${IMAGE_FIELDS} }
`;

/** Metafield identifiers the storefront reads for each product. */
const PRODUCT_METAFIELD_KEYS = [
  { namespace: 'custom', key: 'tagline' },
  { namespace: 'custom', key: 'features' },
  { namespace: 'custom', key: 'materials' },
  { namespace: 'custom', key: 'care' },
  { namespace: 'custom', key: 'fit' },
  { namespace: 'custom', key: 'fit_notes' },
  { namespace: 'custom', key: 'weight_grams' },
  { namespace: 'custom', key: 'monogram' },
  { namespace: 'custom', key: 'reviews' }
];

const PRODUCT_FIELDS = `
  id
  handle
  title
  vendor
  productType
  tags
  publishedAt
  createdAt
  updatedAt
  descriptionHtml
  isGiftCard
  seo { title description }
  featuredImage { ${IMAGE_FIELDS} }
  # 2026-07: Product.media no longer takes a types argument (only after, before,
  # first, last, reverse, sortKey). The MediaImage fragment filters naturally:
  # video and 3D-model nodes come back empty and normalize.js skips them.
  media(first: 20) { nodes { ... on MediaImage { image { ${IMAGE_FIELDS} } } } }
  variants(first: 100) { nodes { ${VARIANT_FIELDS} } }
  metafields(identifiers: [${PRODUCT_METAFIELD_KEYS.map(k => `{ namespace: "${k.namespace}", key: "${k.key}" }`).join(', ')}]) {
    key
    value
    type
  }
`;

const COLLECTION_FIELDS = `
  id
  handle
  title
  description
  image { ${IMAGE_FIELDS} }
  seo { title description }
`;

/**
 * Cart fields, pinned to Storefront API 2026-07.
 *
 * 2026-07 deprecated `cart.discountAllocations`: cart-level discounts are read
 * from `cart.discountApplications` and per-line impact from
 * `lines[].discountAllocations(lineLevelOnly: false)` (lineLevelOnly defaults
 * to true, which would hide order-level discounts).
 *
 * `discountApplications` is a plain list (`[BaseCartDiscountApplication!]!`),
 * not a connection — it takes no `first` argument and has no `nodes` wrapper.
 * Only fields that live on the `BaseCartDiscountApplication` /
 * `CartDiscountAllocation` interfaces are selected, so no inline fragments
 * (and no type-name drift) are involved.
 *
 * `viewKey` is new in 2026-07 and is accepted by cartLinesUpdate /
 * cartLinesRemove as an alternative to the line `id`.
 */
const CART_FIELDS = `
  id
  checkoutUrl
  totalQuantity
  note
  attributes { key value }
  buyerIdentity { email }
  discountCodes { code applicable }
  discountApplications {
    __typename
    allocationMethod
    targetType
    totalAllocatedAmount { amount currencyCode }
  }
  lines(first: 100) {
    nodes {
      id
      viewKey
      quantity
      attributes { key value }
      cost { totalAmount { amount currencyCode } }
      discountAllocations(lineLevelOnly: false) {
        __typename
        targetType
        discountedAmount { amount currencyCode }
      }
      merchandise {
        __typename
        ... on ProductVariant {
          ${VARIANT_FIELDS}
          product {
            id
            handle
            title
            vendor
            productType
            isGiftCard
            featuredImage { ${IMAGE_FIELDS} }
          }
        }
      }
    }
  }
  cost {
    subtotalAmount { amount currencyCode }
    totalAmount { amount currencyCode }
    # totalTaxAmount is deprecated in 2026-07 (there is no replacement field on
    # CartCost yet) and is only used to label an estimate in the cart summary;
    # the normalizer falls back to hiding the row if Shopify stops returning it.
    totalTaxAmount { amount currencyCode }
    checkoutChargeAmount { amount currencyCode }
  }
`;

/* --------------------------------- queries -------------------------------- */

const SHOP = `query Shop {
  shop {
    name
    description
    primaryDomain { url }
    paymentSettings { currencyCode acceptedCardBrands }
  }
}`;

const PRODUCTS = `query Products($first: Int!, $after: String) {
  products(first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ${PRODUCT_FIELDS} }
  }
}`;

const PRODUCT_BY_HANDLE = `query ProductByHandle($handle: String!) {
  product(handle: $handle) { ${PRODUCT_FIELDS} }
}`;

const COLLECTIONS = `query Collections($first: Int!) {
  collections(first: $first) {
    nodes { ${COLLECTION_FIELDS} }
  }
}`;

/** Light: ordered membership handles only — full product data comes from PRODUCTS. */
const COLLECTION_PRODUCT_HANDLES = `query CollectionProducts($handle: String!, $first: Int!) {
  collection(handle: $handle) {
    ${COLLECTION_FIELDS}
    products(first: $first) { nodes { handle } }
  }
}`;

const SEARCH = `query Search($query: String!, $first: Int!) {
  search(query: $query, types: [PRODUCT], first: $first) {
    nodes {
      __typename
      ... on Product { ${PRODUCT_FIELDS} }
    }
  }
}`;

const RECOMMENDATIONS = `query Recommendations($productId: ID!) {
  productRecommendations(productId: $productId) { ${PRODUCT_FIELDS} }
}`;

const PAGES = `query Pages($first: Int!) {
  pages(first: $first) {
    nodes { id handle title body seo { title description } createdAt updatedAt }
  }
}`;

// 2026-07: Article has no `body` field — the content is `contentHtml` (HTML)
// or `content` (stripped to one line). `author` is deprecated in favour of
// `authorV2`. normalise.js maps these back to the storefront's own `body` /
// `author` names so the journal templates are untouched.
const BLOG = `query Blog($handle: String!, $first: Int!) {
  blog(handle: $handle) {
    title
    articles(first: $first) {
      nodes {
        id handle title excerpt contentHtml
        image { ${IMAGE_FIELDS} }
        authorV2 { name }
        tags
        publishedAt
      }
    }
  }
}`;

const GET_CART = `query GetCart($id: ID!) {
  cart(id: $id) { ${CART_FIELDS} }
}`;

/* -------------------------------- mutations ------------------------------- */

const CART_LINE_INPUT = 'merchandiseId: ID!, quantity: Int!, attributes: [AttributeInput!]';

const CART_CREATE = `mutation CartCreate($input: CartInput!) {
  cartCreate(input: $input) { cart { ${CART_FIELDS} } userErrors { field message } }
}`;

const CART_LINES_ADD = `mutation CartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
  cartLinesAdd(cartId: $cartId, lines: $lines) { cart { ${CART_FIELDS} } userErrors { field message } }
}`;

const CART_LINES_UPDATE = `mutation CartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
  cartLinesUpdate(cartId: $cartId, lines: $lines) { cart { ${CART_FIELDS} } userErrors { field message } }
}`;

// viewKeys is new in 2026-07 and mutually exclusive with lineIds per line.
const CART_LINES_REMOVE = `mutation CartLinesRemove($cartId: ID!, $lineIds: [ID!], $viewKeys: [String!]) {
  cartLinesRemove(cartId: $cartId, lineIds: $lineIds, viewKeys: $viewKeys) { cart { ${CART_FIELDS} } userErrors { field message } }
}`;

const CART_DISCOUNT_CODES_UPDATE = `mutation CartDiscountCodesUpdate($cartId: ID!, $discountCodes: [String!]) {
  cartDiscountCodesUpdate(cartId: $cartId, discountCodes: $discountCodes) { cart { ${CART_FIELDS} } userErrors { field message } }
}`;

const CART_NOTE_UPDATE = `mutation CartNoteUpdate($cartId: ID!, $note: String) {
  cartNoteUpdate(cartId: $cartId, note: $note) { cart { ${CART_FIELDS} } userErrors { field message } }
}`;

module.exports = {
  PRODUCT_METAFIELD_KEYS,
  SHOP, PRODUCTS, PRODUCT_BY_HANDLE,
  COLLECTIONS, COLLECTION_PRODUCT_HANDLES,
  SEARCH, RECOMMENDATIONS, PAGES, BLOG,
  GET_CART,
  CART_CREATE, CART_LINES_ADD, CART_LINES_UPDATE, CART_LINES_REMOVE,
  CART_DISCOUNT_CODES_UPDATE, CART_NOTE_UPDATE,
  CART_LINE_INPUT
};
