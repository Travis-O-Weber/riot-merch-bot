/**
 * Riot Merch Bot - Main Orchestrator
 * Self-healing web automation bot for Riot Games merchandise store
 * Supports CONNECT mode: connects to your existing Chrome browser (you sign in manually)
 */
const { log, captureScreenshot, sleep } = require('../util.js');
const { getSelectors } = require('../selectors.js');
const { connectToExistingChrome, launchBraveOrFallback, isBrowserAlive, closeBrowser } = require('../brave.js');
const NavigationManager = require('./NavigationManager.js');
const ProductHandler = require('./ProductHandler.js');
const CartManager = require('./CartManager.js');
const CheckoutManager = require('./CheckoutManager.js');
const AccountManager = require('./AccountManager.js');

class RiotMerchBot {
  /**
   * @param {Object} config - Configuration object
   */
  constructor(config) {
    this.config = config;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.SEL = null;
    this.isConnectedMode = false; // Track if we connected to existing browser

    // Managers (initialized after browser launch)
    this.navigation = null;
    this.cart = null;
    this.product = null;
    this.checkout = null;
    this.account = null;
  }

  /**
   * Main entry point - run the bot
   * CONNECT MODE: Connects to your existing Chrome (you sign in manually first)
   * Multi-account mode: Iterates through all configured accounts
   */
  async run() {
    log('INFO', '===========================================');
    log('INFO', '     RIOT MERCH BOT - STARTING');
    log('INFO', '===========================================');
    this._logConfig();

    try {
      // Initialize - either connect to existing Chrome or launch new browser
      await this.initialize();

      // Take initial screenshot
      await captureScreenshot(this.page, 'initial-state');

      // Get current page state
      const currentUrl = this.page.url();
      log('INFO', `Current page: ${currentUrl}`);

      // If we're connected to existing browser, check if we need to navigate
      if (this.isConnectedMode) {
        if (!currentUrl.includes('merch.riotgames.com')) {
          log('INFO', 'Navigating to Riot Merch...');
          await this.navigation.goToHomepage();
        } else {
          log('OK', 'Already on Riot Merch site');
          // Still handle cookies if needed
          await this.navigation._handleCookieConsent();
        }
      } else {
        // Launched new browser - navigate to homepage
        await this.navigation.goToHomepage();
      }

      await captureScreenshot(this.page, 'homepage');

      // Check DRY_RUN mode
      if (this.config.DRY_RUN) {
        log('INFO', '=== DRY RUN MODE - Stopping after navigation ===');
        await this._logPageInfo();
        return;
      }

      // Check if multi-account mode is configured
      const accountCount = this.account.getAccountCount();
      if (accountCount > 0) {
        log('INFO', `=== MULTI-ACCOUNT MODE: ${accountCount} account(s) configured ===`);
        await this._runMultiAccountFlow();
      } else {
        // Single session mode (no accounts configured or CONNECT_EXISTING with manual sign-in)
        await this._runSingleAccountFlow();
      }

    } catch (err) {
      log('ERROR', `Bot failed: ${err.message}`);
      if (this.page && await isBrowserAlive(this.page)) {
        await captureScreenshot(this.page, 'fatal-error');
      }
      throw err;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Run single account flow (original behavior)
   * Used when no accounts are configured
   */
  async _runSingleAccountFlow() {
    // Verify signed-in state (required for all modes)
    if (this.isConnectedMode) {
      // CONNECT_EXISTING mode: Must be signed in before running
      // Never waits for manual input - stops safely with clear error
      const signInCheck = await this.account.verifySignedInOrFail();

      if (!signInCheck.success) {
        log('ERROR', 'Bot cannot proceed without signed-in state');
        log('INFO', 'Exiting safely. Please sign in and run the bot again.');
        return;
      }

      log('OK', '=== USER IS SIGNED IN (CONNECT MODE) ===');
      log('INFO', 'Proceeding with product flow...');
      await this._runProductFlow();
    } else {
      // Launched browser mode: check sign-in state
      const isSignedIn = await this.account.isSignedIn();

      if (isSignedIn) {
        log('OK', '=== USER IS SIGNED IN ===');
        log('INFO', 'Proceeding with product flow...');
        await this._runProductFlow();
      } else {
        log('ERROR', '=== USER IS NOT SIGNED IN ===');
        log('ERROR', 'Not signed in and not in CONNECT_EXISTING mode');
        log('INFO', 'To use the bot, set CONNECT_EXISTING=1 and sign in manually first');
        await captureScreenshot(this.page, 'error-not-signed-in');
      }
    }
  }

  /**
   * Run multi-account flow
   * Iterates through all configured accounts: verify → flow → sign out → continue
   */
  async _runMultiAccountFlow() {
    const accountCount = this.account.getAccountCount();
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < accountCount; i++) {
      const account = this.account.getAccount(i);
      if (!account || !account.username || !account.password) {
        log('DEBUG', `Skipping blank account at index ${i}`);
        continue;
      }

      this.account.setCurrentAccountIndex(i);
      const maskedUser = this.account.getMaskedUsername();

      log('INFO', '');
      log('INFO', '===========================================');
      log('INFO', `  ACCOUNT ${i + 1}/${accountCount}: ${maskedUser}`);
      log('INFO', '===========================================');

      // Check browser health before each account
      if (!await this._ensureBrowserHealthy(i)) {
        log('ERROR', `Browser unhealthy - cannot process account ${i + 1}`);
        this.account.recordAccountResult('error', 'Browser unhealthy');
        failCount++;
        continue;
      }

      // Handle sign-in for this account
      const signedIn = await this._handleAccountSignIn(i, account);

      if (!signedIn) {
        log('WARN', `Account ${i + 1}: Could not sign in - skipping`);
        this.account.recordAccountResult('error', 'Sign-in failed');
        failCount++;
        continue;
      }

      // Run product flow for this account
      try {
        await this._runProductFlow();
        this.account.recordAccountResult('success', 'Flow completed');
        successCount++;
      } catch (err) {
        log('ERROR', `Account ${i + 1} flow failed: ${err.message}`);
        this.account.recordAccountResult('error', err.message);
        failCount++;
        await this._safeScreenshot(`error-flow-acc${i + 1}`);
      }

      // Always sign out after processing (sign out is already in _runProductFlow)
      // Additional sign out attempt if needed
      const stillSignedIn = await this.account.isSignedIn();
      if (stillSignedIn) {
        log('INFO', 'Ensuring sign out is complete...');
        await this.account.signOut();
        await sleep(2000);
      }

      // Navigate back to homepage for next account
      if (i < accountCount - 1) {
        log('INFO', 'Preparing for next account...');
        await this.navigation.goToHomepage();
        await sleep(1000);
      }
    }

    // Log summary
    log('INFO', '');
    log('INFO', '===========================================');
    log('INFO', '     MULTI-ACCOUNT SUMMARY');
    log('INFO', '===========================================');
    log('INFO', `  Accounts processed: ${successCount + failCount}`);
    log('INFO', `  Successful: ${successCount}`);
    log('INFO', `  Failed: ${failCount}`);
    log('INFO', '===========================================');

    // Log individual account results
    const results = this.account.getResults();
    if (results.length > 0) {
      log('INFO', '');
      log('INFO', 'Account Results:');
      for (const r of results) {
        const statusIcon = r.status === 'success' ? '✓' : '✗';
        log('INFO', `  [${statusIcon}] Account ${r.index + 1} (${r.username}): ${r.status} - ${r.message}`);
      }
    }
  }

  /**
   * Handle sign-in for a specific account
   * @param {number} accountIndex
   * @param {{username: string, password: string}} account
   * @returns {Promise<boolean>}
   */
  async _handleAccountSignIn(accountIndex, account) {
    // For the first account in CONNECT_EXISTING mode, verify existing sign-in
    if (accountIndex === 0 && this.isConnectedMode) {
      const signInCheck = await this.account.verifySignedInOrFail();
      if (signInCheck.success) {
        log('OK', 'Using existing signed-in session for first account');
        return true;
      }
      log('WARN', 'Not signed in - will attempt programmatic sign-in');
    }

    // Check if already signed in
    const alreadySignedIn = await this.account.isSignedIn();
    if (alreadySignedIn) {
      // Verify it's the right account or sign out first
      log('INFO', 'Already signed in - signing out first');
      await this.account.signOut();
      await sleep(2000);
      await this.navigation.goToHomepage();
      await sleep(1000);
    }

    // Attempt programmatic sign-in
    log('INFO', `Attempting sign-in for account ${accountIndex + 1}...`);
    const signedIn = await this.account.signIn(account.username, account.password);

    if (!signedIn) {
      log('WARN', `Sign-in failed for account ${accountIndex + 1}`);
      log('INFO', 'Note: Automated Riot sign-in may be blocked by bot detection');
      await captureScreenshot(this.page, `error-signin-acc${accountIndex + 1}`);
      return false;
    }

    log('OK', `Account ${accountIndex + 1}: Successfully signed in`);
    return true;
  }

  /**
   * Ensure browser is healthy, reinitialize if needed
   * @param {number} accountIndex - Current account index for logging
   * @returns {Promise<boolean>}
   */
  async _ensureBrowserHealthy(accountIndex) {
    const isAlive = await isBrowserAlive(this.page);

    if (isAlive) {
      return true;
    }

    log('WARN', `Browser unhealthy at account ${accountIndex + 1} - attempting reinitialize`);

    try {
      // Close existing browser/context
      await closeBrowser(this.browser, this.context, this.isConnectedMode);

      // Reinitialize
      await this.initialize();

      // Navigate to homepage
      await this.navigation.goToHomepage();

      log('OK', 'Browser reinitialized successfully');
      return true;
    } catch (err) {
      log('ERROR', `Failed to reinitialize browser: ${err.message}`);
      return false;
    }
  }

  /**
   * Run the product flow: Find product → Add to cart → Checkout → Sign out
   */
  async _runProductFlow() {
    let success = false;

    try {
      // Step 1: Clear any existing cart items
      log('INFO', 'Clearing any existing cart items...');
      await this.cart.clearCart();

      // Step 2: Process products (find and add to cart)
      log('INFO', '=== FINDING AND ADDING PRODUCTS ===');
      const productResult = await this.product.processAllProducts();
      log('INFO', `Total products added to cart: ${productResult.totalAdded}`);

      // Log individual product results
      for (const r of productResult.results) {
        if (r.status === 'limit_reached') {
          log('INFO', `  [LIMIT] ${r.product}: ${r.message}`);
        } else if (r.status === 'out_of_stock') {
          log('INFO', `  [OUT OF STOCK] ${r.product}`);
        } else if (r.status === 'error' || r.status === 'not_found') {
          log('INFO', `  [FAILED] ${r.product}: ${r.message}`);
        }
      }

      if (productResult.totalAdded === 0) {
        log('WARN', 'No products were added to cart');
        // Check if it's due to limits or stock issues (move to next account scenario)
        const hasLimitOrStock = productResult.results.some(r => 
          r.status === 'limit_reached' || r.status === 'out_of_stock'
        );
        if (hasLimitOrStock) {
          log('INFO', 'Products unavailable due to limits or stock - would move to next account in multi-account mode');
        }
        await captureScreenshot(this.page, 'no-products-added');
      } else {
        // Step 3: Handle checkout
        await this._handleCheckout(productResult.totalAdded);
        success = true;
      }

    } catch (err) {
      log('ERROR', `Product flow failed: ${err.message}`);
      await this._safeScreenshot('error-product-flow');
    }

    // Step 4: ALWAYS sign out at the end
    log('INFO', '');
    log('INFO', '=== SIGNING OUT ===');
    await this._performSignOut();

    if (success) {
      log('OK', '===========================================');
      log('OK', '     BOT COMPLETED SUCCESSFULLY');
      log('OK', '===========================================');
    }
  }

  /**
   * Perform sign out with multiple strategies
   */
  async _performSignOut() {
    try {
      const isSignedIn = await this.account.isSignedIn();
      if (!isSignedIn) {
        log('INFO', 'Already signed out');
        return;
      }

      log('INFO', 'Attempting to sign out...');
      const signedOut = await this.account.signOut();

      if (signedOut) {
        log('OK', 'Successfully signed out');
        await this._safeScreenshot('signedout-final');
        return;
      }

      // Try direct logout URL
      log('INFO', 'Trying direct logout URL...');
      try {
        await this.page.goto('https://auth.riotgames.com/logout', {
          waitUntil: 'domcontentloaded',
          timeout: 15000
        });
        await sleep(3000);

        await this.page.goto(this.config.URL, { waitUntil: 'domcontentloaded' });
        await sleep(2000);

        const stillSignedIn = await this.account.isSignedIn();
        if (!stillSignedIn) {
          log('OK', 'Signed out via logout URL');
          await this._safeScreenshot('signedout-via-url');
        } else {
          log('WARN', 'Sign out may have failed - please verify manually');
          await this._safeScreenshot('signout-may-have-failed');
        }
      } catch (err) {
        log('WARN', `Logout URL failed: ${err.message}`);
      }
    } catch (err) {
      log('ERROR', `Sign out error: ${err.message}`);
    }
  }

  /**
   * Take screenshot safely
   * @param {string} name
   */
  async _safeScreenshot(name) {
    if (this.page && await isBrowserAlive(this.page)) {
      await captureScreenshot(this.page, name);
    } else {
      log('DEBUG', `Skipping screenshot "${name}" - browser not available`);
    }
  }

  /**
   * Initialize browser and all managers
   */
  async initialize() {
    log('INFO', 'Initializing bot...');

    // Check if we should connect to existing browser
    if (this.config.CONNECT_EXISTING) {
      log('INFO', 'CONNECT MODE: Connecting to your existing Chrome browser...');
      const { browser, context, page } = await connectToExistingChrome(this.config);
      this.browser = browser;
      this.context = context;
      this.page = page;
      this.isConnectedMode = true;
    } else {
      // Launch new browser
      const { browser, context, page } = await launchBraveOrFallback(this.config, false);
      this.browser = browser;
      this.context = context;
      this.page = page;
      this.isConnectedMode = false;
    }

    // Set default timeout
    this.page.setDefaultTimeout(this.config.ACTION_TIMEOUT_MS);

    // Initialize selectors
    this.SEL = getSelectors(this.page);

    // Initialize managers
    this.navigation = new NavigationManager(this.page, this.SEL, this.config);
    this.cart = new CartManager(this.page, this.SEL, this.config);
    this.product = new ProductHandler(this.page, this.SEL, this.config, this.navigation, this.cart);
    this.checkout = new CheckoutManager(this.page, this.SEL, this.config, this.cart);
    this.account = new AccountManager(this.page, this.SEL, this.config);

    log('OK', 'Bot initialized');
  }

  /**
   * Handle checkout flow
   * @param {number} totalAdded - Number of products added
   */
  async _handleCheckout(totalAdded) {
    if (totalAdded === 0) {
      log('WARN', 'Skipping checkout - no products in cart');
      return;
    }

    if (!this.config.CHECKOUT_ENABLED) {
      log('INFO', 'Checkout disabled - stopping at cart');
      await this.cart.openCart();
      await captureScreenshot(this.page, 'cart-final');
      return;
    }

    log('INFO', '=== STARTING CHECKOUT FLOW ===');
    const checkoutSuccess = await this.checkout.performCheckout();

    if (checkoutSuccess) {
      log('OK', '===========================================');
      log('OK', '     CHECKOUT COMPLETED');
      log('OK', '===========================================');
      await captureScreenshot(this.page, 'checkout-complete');
    } else {
      log('ERROR', 'Checkout did not complete successfully');
      await captureScreenshot(this.page, 'checkout-failed');
    }
  }

  /**
   * Cleanup - disconnect from browser (don't close it in connect mode)
   */
  async cleanup() {
    if (this.isConnectedMode) {
      log('INFO', 'Disconnecting from browser (your browser stays open)...');
      await closeBrowser(this.browser, this.context, true);
      log('OK', 'Disconnected');
    } else if (this.config.KEEP_OPEN && this.page && await isBrowserAlive(this.page)) {
      log('INFO', 'KEEP_OPEN enabled - browser will stay open');
      log('INFO', 'Press Ctrl+C to exit');
      await new Promise(() => {});
    } else {
      log('INFO', 'Closing browser...');
      await closeBrowser(this.browser, this.context, false);
      log('OK', 'Browser closed');
    }
  }

  /**
   * Log current configuration
   */
  _logConfig() {
    log('INFO', '--- Configuration ---');
    log('INFO', `URL: ${this.config.URL}`);
    log('INFO', `DRY_RUN: ${this.config.DRY_RUN}`);
    log('INFO', `CHECKOUT_ENABLED: ${this.config.CHECKOUT_ENABLED}`);
    log('INFO', `FULL_SEND: ${this.config.FULL_SEND}`);
    log('INFO', `Products to find: ${this.config.PRODUCTS.length}`);
    for (const product of this.config.PRODUCTS) {
      log('INFO', `  - "${product.names[0]}" x${product.quantity}`);
    }
    if (this.config.DISCOUNT_CODE) {
      log('INFO', `Discount code: ${this.config.DISCOUNT_CODE}`);
    }
    log('INFO', '');
    if (this.config.CONNECT_EXISTING) {
      log('INFO', 'MODE: CONNECT TO EXISTING CHROME');
      log('INFO', '  - Bot will connect to your open Chrome browser');
      log('INFO', '  - Sign in manually BEFORE running the bot');
      log('INFO', '  - Bot will sign out automatically at end');
    } else {
      log('INFO', 'MODE: LAUNCH NEW BROWSER');
    }
    log('INFO', '---------------------');
  }

  /**
   * Log current page info for debugging
   */
  async _logPageInfo() {
    const info = await this.navigation.getPageInfo();
    log('DEBUG', `Current URL: ${info.url}`);
    log('DEBUG', `Page Title: ${info.title}`);
  }
}

module.exports = RiotMerchBot;
