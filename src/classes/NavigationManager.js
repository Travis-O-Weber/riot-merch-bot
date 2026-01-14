/**
 * Navigation Manager - Handles page navigation and search
 */
const { log, withRetry, captureScreenshot, captureFailure, sleep } = require('../util.js');

class NavigationManager {
  /**
   * @param {import('playwright').Page} page
   * @param {Object} SEL - Selectors object
   * @param {Object} config - Configuration
   */
  constructor(page, SEL, config) {
    this.page = page;
    this.SEL = SEL;
    this.config = config;
    this._cookieConsentHandled = false;
  }

  /**
   * Navigate to homepage
   */
  async goToHomepage() {
    log('INFO', `Navigating to ${this.config.URL}`);
    await this.page.goto(this.config.URL, {
      waitUntil: 'domcontentloaded',
      timeout: this.config.NAV_TIMEOUT_MS
    });
    await this._waitForPageLoad();

    // Handle cookie consent popup
    await this._handleCookieConsent();

    log('OK', 'Reached homepage');
  }

  /**
   * Handle cookie consent popups - idempotent (safe to call multiple times)
   * @param {Object} options
   * @param {boolean} options.force - Force check even if already handled
   * @returns {Promise<{handled: boolean, method: string|null, selectorsAttempted: string[]}>}
   */
  async handleCookieConsent(options = {}) {
    const { force = false } = options;
    const selectorsAttempted = [];
    const result = { handled: false, method: null, selectorsAttempted };

    if (this._cookieConsentHandled && !force) {
      log('DEBUG', 'Cookie consent already handled, skipping');
      return result;
    }

    log('DEBUG', 'Checking for cookie consent popup');

    const acceptSelectors = [
      { selector: '#onetrust-accept-btn-handler', name: 'OneTrust Accept' },
      { selector: '.onetrust-accept-btn-handler', name: 'OneTrust Class' },
      { selector: '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', name: 'CookieBot Accept All' },
      { selector: '#CybotCookiebotDialogBodyButtonAccept', name: 'CookieBot Accept' },
      { selector: 'button:has-text("Accept All Cookies")', name: 'Accept All Cookies button' },
      { selector: 'button:has-text("Accept All")', name: 'Accept All button' },
      { selector: 'button:has-text("Accept Cookies")', name: 'Accept Cookies button' },
      { selector: 'button:has-text("Accept")', name: 'Accept button' },
      { selector: 'button:has-text("Allow All")', name: 'Allow All button' },
      { selector: 'button:has-text("Allow Cookies")', name: 'Allow Cookies button' },
      { selector: 'button:has-text("Allow")', name: 'Allow button' },
      { selector: 'button:has-text("I Accept")', name: 'I Accept button' },
      { selector: 'button:has-text("I Agree")', name: 'I Agree button' },
      { selector: 'button:has-text("Agree")', name: 'Agree button' },
      { selector: 'button:has-text("Got it")', name: 'Got it button' },
      { selector: 'button:has-text("OK")', name: 'OK button' },
      { selector: 'button:has-text("Continue")', name: 'Continue button (cookie context)' },
      { selector: '#accept-cookies', name: '#accept-cookies ID' },
      { selector: '#cookie-accept', name: '#cookie-accept ID' },
      { selector: '.accept-cookies', name: '.accept-cookies class' },
      { selector: '.cookie-accept', name: '.cookie-accept class' },
      { selector: '[data-testid="cookie-accept"]', name: 'testid cookie-accept' },
      { selector: '[data-testid*="accept"][data-testid*="cookie"]', name: 'testid accept+cookie' },
      { selector: '[aria-label*="accept" i][aria-label*="cookie" i]', name: 'aria-label accept+cookie' },
      { selector: '[aria-label*="Accept cookies" i]', name: 'aria-label Accept cookies' },
      { selector: '[class*="cookie"][class*="accept"]', name: 'class cookie+accept' },
      { selector: '[class*="consent"][class*="accept"]', name: 'class consent+accept' },
      { selector: '[class*="cookie-banner"] button:has-text("Accept")', name: 'cookie-banner Accept' },
      { selector: '[class*="cookie-consent"] button:has-text("Accept")', name: 'cookie-consent Accept' },
      { selector: '[class*="gdpr"] button:has-text("Accept")', name: 'gdpr Accept' },
      { selector: '[role="dialog"] button:has-text("Accept")', name: 'dialog Accept' },
      { selector: '[role="alertdialog"] button:has-text("Accept")', name: 'alertdialog Accept' },
      { selector: '[class*="privacy"] button:has-text("Accept")', name: 'privacy Accept' },
      { selector: '.cc-accept', name: '.cc-accept (Cookie Consent lib)' },
      { selector: '.cc-allow', name: '.cc-allow (Cookie Consent lib)' },
      { selector: '#ccAccept', name: '#ccAccept ID' },
    ];

    for (const { selector, name } of acceptSelectors) {
      selectorsAttempted.push(name);
      try {
        const btn = this.page.locator(selector);
        const count = await btn.count();
        if (count > 0) {
          const element = btn.first();
          const isVisible = await element.isVisible().catch(() => false);
          if (isVisible) {
            await element.click();
            log('OK', `Cookie consent accepted via: ${name}`);
            this._cookieConsentHandled = true;
            result.handled = true;
            result.method = name;
            await sleep(1000);
            return result;
          }
        }
      } catch {
        // Try next
      }
    }

    const declineSelectors = [
      { selector: '#onetrust-reject-all-handler', name: 'OneTrust Reject' },
      { selector: 'button:has-text("Decline All")', name: 'Decline All button' },
      { selector: 'button:has-text("Decline")', name: 'Decline button' },
      { selector: 'button:has-text("Reject All")', name: 'Reject All button' },
      { selector: 'button:has-text("Reject")', name: 'Reject button' },
      { selector: 'button:has-text("Only Essential")', name: 'Only Essential button' },
      { selector: 'button:has-text("Necessary Only")', name: 'Necessary Only button' },
      { selector: 'button:has-text("Essential Only")', name: 'Essential Only button' },
      { selector: '.cc-deny', name: '.cc-deny (Cookie Consent lib)' },
    ];

    for (const { selector, name } of declineSelectors) {
      selectorsAttempted.push(name);
      try {
        const btn = this.page.locator(selector);
        const count = await btn.count();
        if (count > 0) {
          const element = btn.first();
          const isVisible = await element.isVisible().catch(() => false);
          if (isVisible) {
            await element.click();
            log('OK', `Cookie consent declined via: ${name}`);
            this._cookieConsentHandled = true;
            result.handled = true;
            result.method = name;
            await sleep(1000);
            return result;
          }
        }
      } catch {
        // Try next
      }
    }

    const bannerSelectors = [
      '[class*="cookie-banner"]',
      '[class*="cookie-consent"]',
      '[class*="cookie-notice"]',
      '[id*="cookie"]',
      '#onetrust-consent-sdk',
      '.CybotCookiebotDialog',
      '[class*="gdpr"]',
      '[role="dialog"][aria-label*="cookie" i]',
    ];

    let bannerVisible = false;
    for (const selector of bannerSelectors) {
      try {
        const banner = this.page.locator(selector);
        if (await banner.count() > 0 && await banner.first().isVisible()) {
          bannerVisible = true;
          log('WARN', `Cookie banner detected (${selector}) but no button found`);
          break;
        }
      } catch {
        // Continue
      }
    }

    if (bannerVisible) {
      log('WARN', `Cookie consent popup visible but no accept/decline button found`);
      log('DEBUG', `Selectors attempted: ${selectorsAttempted.join(', ')}`);
      await captureScreenshot(this.page, 'cookie-consent-no-button');
      result.selectorsAttempted = selectorsAttempted;
    } else {
      log('DEBUG', 'No cookie consent popup found or already dismissed');
      this._cookieConsentHandled = true;
    }

    return result;
  }

  /**
   * Handle cookie consent popups - backward compatible alias
   * @private
   */
  async _handleCookieConsent() {
    return this.handleCookieConsent();
  }

  /**
   * Reset cookie consent state (for page navigation)
   */
  resetCookieConsentState() {
    this._cookieConsentHandled = false;
  }

  /**
   * Search for a product using search box
   * @param {string} query - Search query
   * @returns {Promise<boolean>} - Whether search was successful
   */
  async searchForProduct(query) {
    log('INFO', `Searching for: ${query}`);

    // First try to find and open search
    const searchOpened = await this._openSearch();
    if (!searchOpened) {
      log('WARN', 'Could not open search');
      return false;
    }

    // Find search input
    const searchInput = await this._findSearchInput();
    if (!searchInput) {
      log('WARN', 'Search input not found');
      return false;
    }

    try {
      // Clear and type search query
      await searchInput.clear();
      await searchInput.fill(query);
      await sleep(300);

      // Submit search
      await this._submitSearch(searchInput);
      await this._waitForPageLoad();

      log('OK', `Search submitted for: ${query}`);
      return true;
    } catch (err) {
      log('ERROR', `Search failed: ${err.message}`);
      await captureScreenshot(this.page, 'search-error');
      return false;
    }
  }

  /**
   * Navigate to shop/all products page
   * @returns {Promise<boolean>}
   */
  async goToShop() {
    log('INFO', 'Navigating to shop page');

    const strategies = [
      () => this.SEL.navShop(),
      () => this.SEL.navShopFallback1(),
      () => this.SEL.navShopFallback2(),
      () => this.SEL.navAllProducts(),
    ];

    for (const strategy of strategies) {
      try {
        const link = strategy();
        if (await link.count() > 0 && await link.first().isVisible()) {
          await link.first().click();
          await this._waitForPageLoad();
          log('OK', 'Navigated to shop');
          return true;
        }
      } catch {
        // Try next strategy
      }
    }

    log('WARN', 'Could not find shop link');
    return false;
  }

  /**
   * Open search interface
   * @returns {Promise<boolean>}
   */
  async _openSearch() {
    // Check if search input is already visible
    const inputStrategies = [
      () => this.SEL.searchInput(),
      () => this.SEL.searchInputFallback1(),
      () => this.SEL.searchInputFallback2(),
    ];

    for (const strategy of inputStrategies) {
      try {
        const input = strategy();
        if (await input.count() > 0 && await input.first().isVisible()) {
          return true; // Search already open
        }
      } catch {
        // Continue
      }
    }

    // Try to click search trigger
    const triggerStrategies = [
      () => this.SEL.searchTrigger(),
      () => this.SEL.searchTriggerFallback1(),
      () => this.SEL.searchTriggerFallback2(),
      () => this.SEL.searchTriggerFallback3(),
    ];

    for (const strategy of triggerStrategies) {
      try {
        const trigger = strategy();
        if (await trigger.count() > 0) {
          const element = trigger.first();
          if (await element.isVisible()) {
            await element.click();
            await sleep(500);
            return true;
          }
        }
      } catch {
        // Try next
      }
    }

    return false;
  }

  /**
   * Find search input
   * @returns {Promise<import('playwright').Locator|null>}
   */
  async _findSearchInput() {
    const strategies = [
      () => this.SEL.searchInput(),
      () => this.SEL.searchInputFallback1(),
      () => this.SEL.searchInputFallback2(),
      () => this.SEL.searchInputFallback3(),
      () => this.SEL.searchInputFallback4(),
      () => this.SEL.searchInputFallback5(),
    ];

    for (const strategy of strategies) {
      try {
        const input = strategy();
        if (await input.count() > 0) {
          const element = input.first();
          if (await element.isVisible()) {
            return element;
          }
        }
      } catch {
        // Try next
      }
    }

    return null;
  }

  /**
   * Submit search
   * @param {import('playwright').Locator} searchInput
   */
  async _submitSearch(searchInput) {
    // Try Enter key first
    try {
      await searchInput.press('Enter');
      await sleep(500);
      return;
    } catch {
      // Continue
    }

    // Try search button
    const buttonStrategies = [
      () => this.SEL.searchButton(),
      () => this.SEL.searchButtonFallback1(),
      () => this.SEL.searchButtonFallback2(),
      () => this.SEL.searchButtonFallback3(),
    ];

    for (const strategy of buttonStrategies) {
      try {
        const button = strategy();
        if (await button.count() > 0 && await button.first().isVisible()) {
          await button.first().click();
          return;
        }
      } catch {
        // Try next
      }
    }
  }

  /**
   * Wait for page load to complete
   */
  async _waitForPageLoad() {
    try {
      // Wait for network to be idle
      await this.page.waitForLoadState('networkidle', { timeout: 10000 });
    } catch {
      // Continue if timeout
    }

    // Wait for any loaders to disappear
    try {
      await this.page.waitForFunction(
        () => {
          const loaders = document.querySelectorAll('.loading, .spinner, .loader, [class*="loading"]:not(body)');
          return loaders.length === 0 || Array.from(loaders).every(l => l.offsetParent === null);
        },
        { timeout: 5000 }
      );
    } catch {
      // Continue
    }

    await sleep(500);
  }

  /**
   * Get current page info for debugging
   */
  async getPageInfo() {
    return {
      url: this.page.url(),
      title: await this.page.title()
    };
  }
}

module.exports = NavigationManager;
