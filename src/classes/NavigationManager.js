/**
 * Navigation Manager - Handles page navigation and search
 */
const { log, withRetry, captureScreenshot, sleep } = require('../util.js');

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
   * Handle cookie consent popups
   */
  async _handleCookieConsent() {
    log('DEBUG', 'Checking for cookie consent popup');

    const acceptSelectors = [
      // Common accept button patterns
      'button:has-text("Accept")',
      'button:has-text("Accept All")',
      'button:has-text("Accept Cookies")',
      'button:has-text("Allow")',
      'button:has-text("Allow All")',
      'button:has-text("I Accept")',
      'button:has-text("Got it")',
      'button:has-text("OK")',
      'button:has-text("Agree")',
      // ID/class patterns
      '#accept-cookies',
      '#cookie-accept',
      '.accept-cookies',
      '.cookie-accept',
      '[data-testid*="accept"]',
      '[data-testid*="cookie"]',
      // Aria patterns
      '[aria-label*="accept" i][aria-label*="cookie" i]',
      '[aria-label*="accept" i]',
      // OneTrust (common cookie consent provider)
      '#onetrust-accept-btn-handler',
      '.onetrust-accept-btn',
      // CookieBot
      '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
      // Generic consent
      '[class*="cookie"][class*="accept"]',
      '[class*="consent"][class*="accept"]',
      '[class*="cookie"] button:has-text("Accept")',
      '[class*="consent"] button:has-text("Accept")',
      '[role="dialog"] button:has-text("Accept")',
      '[role="alertdialog"] button:has-text("Accept")',
    ];

    for (const selector of acceptSelectors) {
      try {
        const btn = this.page.locator(selector);
        if (await btn.count() > 0) {
          const element = btn.first();
          if (await element.isVisible()) {
            await element.click();
            log('OK', `Cookie consent accepted via: ${selector.substring(0, 40)}`);
            await sleep(1000);
            return;
          }
        }
      } catch {
        // Try next
      }
    }

    // Also try decline/reject (in case user prefers that)
    const declineSelectors = [
      'button:has-text("Decline")',
      'button:has-text("Reject")',
      'button:has-text("Reject All")',
      'button:has-text("Only Essential")',
      'button:has-text("Necessary Only")',
      '#onetrust-reject-all-handler',
    ];

    for (const selector of declineSelectors) {
      try {
        const btn = this.page.locator(selector);
        if (await btn.count() > 0) {
          const element = btn.first();
          if (await element.isVisible()) {
            await element.click();
            log('OK', `Cookie consent declined via: ${selector.substring(0, 40)}`);
            await sleep(1000);
            return;
          }
        }
      } catch {
        // Try next
      }
    }

    log('DEBUG', 'No cookie consent popup found or already dismissed');
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
