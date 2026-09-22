'use strict';
/**
 * settings.js — presentation/brand settings for the storefront.
 *
 * Loaded from config/storefront.json with environment overrides. This module
 * deliberately holds NO commerce state: products, prices, inventory, carts,
 * orders, discounts and customers live in Shopify and are read through
 * lib/shopify/ at runtime.
 */
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = process.env.STOREFRONT_CONFIG || path.join(__dirname, '..', 'config', 'storefront.json');

let cached = null;

function load() {
  if (cached) return cached;
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  // Env overrides for deployment-specific values.
  if (process.env.PUBLIC_SITE_DOMAIN) raw.domain = process.env.PUBLIC_SITE_DOMAIN;
  if (process.env.PUBLIC_SUPPORT_EMAIL) raw.supportEmail = process.env.PUBLIC_SUPPORT_EMAIL;
  // Customer accounts are Shopify-hosted: point at the store's own /account
  // unless the presentation config overrides it.
  if (!raw.accountUrl) {
    try {
      const { getConfig } = require('./shopify/config');
      raw.accountUrl = getConfig().accountUrl || '';
    } catch { raw.accountUrl = ''; }
  }
  cached = raw;
  return cached;
}

function get() { return load(); }

/** Colour swatch hex for a colour name, with a neutral fallback. */
function swatchHex(name) {
  const map = load().colorSwatches || {};
  return map[name] || '#B8B2A7';
}

module.exports = { get, swatchHex, CONFIG_PATH };
