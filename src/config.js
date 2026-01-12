/**
 * Configuration management for Riot Merch Bot
 */
const { getString, getNumber, getBoolean } = require('./env.js');

// Determine if FULL_SEND mode is active
const FULL_SEND = getBoolean('FULL_SEND', false);

/**
 * Parse Riot accounts from environment variables
 * Supports two formats:
 * 1. Numbered: RIOT_USER_1, RIOT_PASS_1, RIOT_USER_2, RIOT_PASS_2, etc.
 * 2. JSON: RIOT_ACCOUNTS=[{"username":"user1","password":"pass1"}]
 * @returns {Array<{username: string, password: string}>}
 */
function parseRiotAccounts() {
  const accounts = [];

  // Try JSON format first
  const jsonAccounts = getString('RIOT_ACCOUNTS', '');
  if (jsonAccounts) {
    try {
      const parsed = JSON.parse(jsonAccounts);
      if (Array.isArray(parsed)) {
        for (const acc of parsed) {
          if (acc.username && acc.password) {
            accounts.push({
              username: acc.username,
              password: acc.password
            });
          }
        }
      }
    } catch (err) {
      // JSON parse failed, continue to numbered format
    }
  }

  // If no JSON accounts, try numbered format
  if (accounts.length === 0) {
    for (let i = 1; i <= 20; i++) { // Support up to 20 accounts
      const username = getString(`RIOT_USER_${i}`, '');
      const password = getString(`RIOT_PASS_${i}`, '');
      if (username && password) {
        accounts.push({ username, password });
      }
    }
  }

  return accounts;
}

const config = {
  // ----- Target URL -----
  URL: 'https://merch.riotgames.com',

  // ----- Mode Settings -----
  DRY_RUN: getBoolean('DRY_RUN', true),
  CHECKOUT_ENABLED: getBoolean('CHECKOUT_ENABLED', false),
  FULL_SEND: FULL_SEND,
  KEEP_OPEN: getBoolean('KEEP_OPEN', true),
  HEADLESS: getBoolean('HEADLESS', false),

  // ----- Timeout Settings (adjusted for FULL_SEND mode) -----
  NAV_TIMEOUT_MS: FULL_SEND ? 10000 : getNumber('NAV_TIMEOUT_MS', 45000),
  ACTION_TIMEOUT_MS: FULL_SEND ? 5000 : getNumber('ACTION_TIMEOUT_MS', 30000),
  MAX_RETRIES: FULL_SEND ? 2 : getNumber('MAX_RETRIES', 3),

  // ----- Search Settings -----
  FUZZY_THRESHOLD: getNumber('FUZZY_THRESHOLD', 0.5),

  // ----- Browser Settings -----
  // Connect to existing Chrome (user signs in manually first)
  // Launch Chrome with: chrome.exe --remote-debugging-port=9222
  CONNECT_EXISTING: getBoolean('CONNECT_EXISTING', false),
  CDP_ENDPOINT: getString('CDP_ENDPOINT', 'http://127.0.0.1:9222'),

  BRAVE_PATH: getString('BRAVE_PATH', 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
  USER_DATA_DIR: getString('USER_DATA_DIR', ''),
  PROFILE_DIR: getString('PROFILE_DIR', 'Default'),
  MULTI_ACCOUNT_FRESH_CONTEXT: getBoolean('MULTI_ACCOUNT_FRESH_CONTEXT', true),

  // ----- Riot Accounts (for multi-account support) -----
  RIOT_ACCOUNTS: parseRiotAccounts(),
  MAX_ACCOUNTS: getNumber('MAX_ACCOUNTS', 0), // 0 = no limit

  // ----- Products (dynamically loaded) -----
  PRODUCTS: (function() {
    const products = [];
    for (let i = 1; i <= 5; i++) {
      const nameKey = `PRODUCT${i}`;
      const qtyKey = `QTY${i}`;
      const nameValue = getString(nameKey, '');
      if (nameValue) {
        products.push({
          // Split by pipe for synonym support
          names: nameValue.split('|').map(n => n.trim()).filter(n => n),
          quantity: Math.max(1, getNumber(qtyKey, 1))
        });
      }
    }
    return products;
  })(),

  // ----- Discount Code -----
  DISCOUNT_CODE: getString('DISCOUNT_CODE', ''),

  // ----- Checkout Information -----
  CHECKOUT: {
    email: getString('EMAIL', ''),
    firstName: getString('FIRST_NAME', ''),
    lastName: getString('LAST_NAME', ''),
    phone: getString('PHONE', ''),
    address1: getString('ADDRESS1', ''),
    address2: getString('ADDRESS2', ''),
    city: getString('CITY', ''),
    state: getString('STATE', ''),
    zip: getString('ZIP', ''),
    country: getString('COUNTRY', 'United States')
  },

  // ----- Payment Information -----
  PAYMENT: {
    cardNumber: getString('CARD_NUMBER', ''),
    cardExpMonth: getString('CARD_EXP_MONTH', ''),
    cardExpYear: getString('CARD_EXP_YEAR', ''),
    cardCvv: getString('CARD_CVV', '')
  }
};

module.exports = config;
