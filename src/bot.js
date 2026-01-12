#!/usr/bin/env node
/**
 * Riot Merch Bot - Entry Point
 *
 * Self-healing web automation bot for Riot Games merchandise store
 * Supports multi-account purchasing with sign-in/sign-out flow
 * Finds products by fuzzy matching, handles pagination, and completes checkout
 *
 * Usage:
 *   npm start           - Run bot with current .env configuration
 *   npm run dry         - Run in DRY_RUN mode (navigation only)
 *
 * Configuration:
 *   Edit .env file to set:
 *   - Products and quantities
 *   - Riot accounts (RIOT_USER_1, RIOT_PASS_1, etc.)
 *   - Checkout/shipping information
 *   - Mode settings (DRY_RUN, CHECKOUT_ENABLED, FULL_SEND)
 *
 * Multi-Account Mode:
 *   When Riot accounts are configured, the bot will:
 *   1. Sign in to each account
 *   2. Find and add products to cart
 *   3. Complete checkout (if enabled)
 *   4. Sign out
 *   5. Move to the next account
 */

const config = require('./config.js');
const RiotMerchBot = require('./classes/RiotMerchBot.js');
const { log, captureScreenshot, saveAccountResults } = require('./util.js');

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  log('ERROR', `Uncaught exception: ${err.message}`);
  log('ERROR', err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  log('ERROR', `Unhandled rejection: ${reason}`);
  process.exit(1);
});

// Graceful shutdown handler
let bot = null;
process.on('SIGINT', async () => {
  log('INFO', '\nReceived SIGINT - shutting down gracefully...');
  if (bot && bot.page) {
    try {
      await captureScreenshot(bot.page, 'shutdown');
    } catch {
      // Ignore screenshot errors during shutdown
    }
    // Save any account results if multi-account mode
    if (bot.account) {
      const results = bot.account.getResults();
      if (results.length > 0) {
        saveAccountResults(results);
      }
    }
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  log('INFO', '\nReceived SIGTERM - shutting down gracefully...');
  process.exit(0);
});

/**
 * Validate configuration
 * @returns {boolean}
 */
function validateConfig() {
  let valid = true;

  // Check for products
  if (config.PRODUCTS.length === 0) {
    log('ERROR', 'No products configured in .env file');
    log('INFO', 'Add PRODUCT1="Product Name" to your .env file');
    valid = false;
  }

  // Log multi-account info
  const accountCount = config.RIOT_ACCOUNTS?.length || 0;
  if (accountCount > 0) {
    const maxAccounts = config.MAX_ACCOUNTS || 0;
    const effectiveCount = maxAccounts > 0 ? Math.min(accountCount, maxAccounts) : accountCount;
    log('INFO', `Multi-account mode: ${effectiveCount} account(s) will be used`);

    // Warn if checkout is disabled but accounts are configured
    if (accountCount > 0 && !config.CHECKOUT_ENABLED) {
      log('WARN', 'Accounts configured but CHECKOUT_ENABLED=0 - checkout will be skipped');
    }

    // Warn if FULL_SEND is enabled
    if (config.FULL_SEND) {
      log('WARN', '*** FULL_SEND=1 - Orders WILL be placed! ***');
    }
  } else {
    log('INFO', 'Single session mode (no Riot accounts configured)');
  }

  // Check for dangerous configuration
  if (config.FULL_SEND && config.CHECKOUT_ENABLED) {
    log('WARN', '===========================================');
    log('WARN', '  WARNING: FULL_SEND MODE IS ENABLED!');
    log('WARN', '  Orders will be placed automatically.');
    log('WARN', '  Set FULL_SEND=0 to stop before payment.');
    log('WARN', '===========================================');
  }

  return valid;
}

/**
 * Main function
 */
async function main() {
  log('INFO', '');
  log('INFO', '  ____  _       _     __  __               _       ____        _   ');
  log('INFO', ' |  _ \\(_) ___ | |_  |  \\/  | ___ _ __ ___| |__   | __ )  ___ | |_ ');
  log('INFO', ' | |_) | |/ _ \\| __| | |\\/| |/ _ \\ \'__/ __| \'_ \\  |  _ \\ / _ \\| __|');
  log('INFO', ' |  _ <| | (_) | |_  | |  | |  __/ | | (__| | | | | |_) | (_) | |_ ');
  log('INFO', ' |_| \\_\\_|\\___/ \\__| |_|  |_|\\___|_|  \\___|_| |_| |____/ \\___/ \\__|');
  log('INFO', '');

  // Validate configuration
  if (!validateConfig()) {
    process.exit(1);
  }

  // Create and run bot
  bot = new RiotMerchBot(config);

  try {
    await bot.run();
    log('INFO', 'Bot completed successfully');
  } catch (err) {
    log('ERROR', `Bot failed: ${err.message}`);
    process.exit(1);
  }
}

// Run main
main();
