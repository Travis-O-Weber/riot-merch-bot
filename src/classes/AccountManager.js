/**
 * Account Manager - Handles Riot account sign-in/sign-out operations
 * Required for multi-account purchasing where each account has purchase limits
 */
const { log, withRetry, captureScreenshot, sleep, maskSensitive } = require('../util.js');

class AccountManager {
  /**
   * @param {import('playwright').Page} page
   * @param {Object} SEL - Selectors object
   * @param {Object} config - Configuration
   */
  constructor(page, SEL, config) {
    this.page = page;
    this.SEL = SEL;
    this.config = config;
    this.currentAccountIndex = -1;
    this.currentAccount = null;
    this.accountResults = []; // Track results for each account
  }

  /**
   * Get the number of configured accounts
   * @returns {number}
   */
  getAccountCount() {
    const count = this.config.RIOT_ACCOUNTS?.length || 0;
    const maxAccounts = this.config.MAX_ACCOUNTS || 0;
    return maxAccounts > 0 ? Math.min(count, maxAccounts) : count;
  }

  /**
   * Get account by index
   * @param {number} index
   * @returns {{username: string, password: string}|null}
   */
  getAccount(index) {
    const accounts = this.config.RIOT_ACCOUNTS || [];
    if (index >= 0 && index < accounts.length) {
      return accounts[index];
    }
    return null;
  }

  /**
   * Set current account for logging purposes
   * @param {number} index
   */
  setCurrentAccountIndex(index) {
    this.currentAccountIndex = index;
    this.currentAccount = this.getAccount(index);
  }

  /**
   * Get masked username for logging
   * @returns {string}
   */
  getMaskedUsername() {
    if (!this.currentAccount) return 'unknown';
    return maskSensitive(this.currentAccount.username, 4);
  }

  /**
   * Record result for current account
   * @param {'success'|'out_of_stock'|'limit_reached'|'error'} status
   * @param {string} message
   */
  recordAccountResult(status, message) {
    this.accountResults.push({
      index: this.currentAccountIndex,
      username: this.getMaskedUsername(),
      status,
      message,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Get all account results
   * @returns {Array}
   */
  getResults() {
    return this.accountResults;
  }

  /**
   * Check if user is currently signed in
   * @returns {Promise<boolean>}
   */
  async isSignedIn() {
    log('DEBUG', 'Checking if user is signed in');

    const currentUrl = this.page.url();

    // If we're on the auth/login page, we're definitely NOT signed in
    if (currentUrl.includes('auth.riotgames.com') || currentUrl.includes('login') || currentUrl.includes('authenticate')) {
      log('DEBUG', 'On login page - user is NOT signed in');
      return false;
    }

    // FIRST: Look for sign-in button in HEADER ONLY (indicates user is NOT signed in)
    // Be strict - only count actual "Sign In" links/buttons, not help text
    try {
      const headerSignIn = this.page.locator('header a, header button, nav a, nav button');
      const count = await headerSignIn.count();

      for (let i = 0; i < count; i++) {
        const el = headerSignIn.nth(i);
        const text = await el.textContent().catch(() => '');
        // Must be exact "Sign In" or "Log In", not "Can't sign in?" or other variations
        if (text && /^sign\s*in$|^log\s*in$/i.test(text.trim())) {
          if (await el.isVisible()) {
            log('DEBUG', `Sign in button found in header: "${text.trim()}" - user is NOT signed in`);
            return false;
          }
        }
      }
    } catch {
      // Continue
    }

    // THEN: Look for signed-in indicators
    const signedInIndicators = [
      // Sign out button visible means signed in
      () => this.page.locator('header button:has-text("Sign Out"), header a:has-text("Sign Out")'),
      () => this.page.locator('header button:has-text("Log Out"), header a:has-text("Log Out")'),
      // "My Account" link means signed in
      () => this.page.locator('header a:has-text("My Account")'),
      // Account/profile indicators in header
      () => this.page.locator('header [class*="account"][class*="logged"], header [class*="signed-in"]'),
    ];

    for (const indicator of signedInIndicators) {
      try {
        const element = indicator();
        if (await element.count() > 0 && await element.first().isVisible()) {
          log('DEBUG', 'Signed-in indicator found - user IS signed in');
          return true;
        }
      } catch {
        // Continue
      }
    }

    // If we're on the merch site (not login page) and no sign-in button found,
    // we might be signed in - check the page more carefully
    if (currentUrl.includes('merch.riotgames.com')) {
      // Look for any account-related element that suggests logged in
      try {
        const accountArea = this.page.locator('header').getByText(/my account|sign out|log out/i);
        if (await accountArea.count() > 0 && await accountArea.first().isVisible()) {
          log('DEBUG', 'Account text found - user IS signed in');
          return true;
        }
      } catch {
        // Continue
      }
    }

    // If we can't determine, assume NOT signed in (safer default)
    log('DEBUG', 'Could not determine sign-in state - assuming NOT signed in');
    return false;
  }

  /**
   * Sign in to Riot account
   * @param {string} username - Riot username/email
   * @param {string} password - Riot password
   * @returns {Promise<boolean>}
   */
  async signIn(username, password) {
    log('INFO', `Signing in as: ${maskSensitive(username, 4)}`);

    if (!username || !password) {
      log('ERROR', 'Username or password not provided');
      return false;
    }

    try {
      // Check if already signed in - only sign out if actually signed in
      const alreadySignedIn = await this.isSignedIn();
      if (alreadySignedIn) {
        log('INFO', 'Already signed in - signing out first');
        await this.signOut();
        await sleep(2000);
        // Navigate back to homepage after logout
        await this.page.goto(this.config.URL, { waitUntil: 'domcontentloaded' });
        await sleep(1000);
      }

      // Find and click sign in button/link
      log('INFO', 'Looking for sign in button...');
      const signInClicked = await this._clickSignIn();
      if (!signInClicked) {
        log('ERROR', 'Could not find sign in button');
        await captureScreenshot(this.page, `error-signin-button-acct${this.currentAccountIndex}`);
        return false;
      }

      // Wait for sign-in page/modal to load
      await this._waitForSignInPage();

      // Fill username with human-like typing
      const usernameFilled = await this._fillUsername(username);
      if (!usernameFilled) {
        log('ERROR', 'Could not fill username');
        await captureScreenshot(this.page, `error-username-acct${this.currentAccountIndex}`);
        return false;
      }

      // Small delay between fields (human-like)
      await sleep(this._randomDelay(200, 400));

      // Fill password with human-like typing
      const passwordFilled = await this._fillPassword(password);
      if (!passwordFilled) {
        log('ERROR', 'Could not fill password');
        await captureScreenshot(this.page, `error-password-acct${this.currentAccountIndex}`);
        return false;
      }

      // Small delay before submit (human-like)
      await sleep(this._randomDelay(300, 600));

      // Submit sign in form
      const submitted = await this._submitSignIn();
      if (!submitted) {
        log('ERROR', 'Could not submit sign in form');
        await captureScreenshot(this.page, `error-submit-signin-acct${this.currentAccountIndex}`);
        return false;
      }

      // Wait for sign in to complete
      await this._waitForSignInComplete();

      // Check for sign-in errors
      if (await this._hasSignInError()) {
        log('ERROR', 'Sign in failed - check credentials');
        await captureScreenshot(this.page, `error-signin-failed-acct${this.currentAccountIndex}`);
        return false;
      }

      // Verify signed in
      const signedIn = await this.isSignedIn();
      if (signedIn) {
        log('OK', `Successfully signed in as: ${maskSensitive(username, 4)}`);
        return true;
      } else {
        log('WARN', 'Sign in may have failed - could not verify');
        await captureScreenshot(this.page, `warn-signin-verify-acct${this.currentAccountIndex}`);
        return false;
      }

    } catch (err) {
      log('ERROR', `Sign in failed: ${err.message}`);
      await captureScreenshot(this.page, `error-signin-exception-acct${this.currentAccountIndex}`);
      return false;
    }
  }

  /**
   * Generate random delay for human-like behavior
   * @param {number} min - Minimum delay in ms
   * @param {number} max - Maximum delay in ms
   * @returns {number}
   */
  _randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Type text character by character with human-like delays
   * @param {import('playwright').Locator} element
   * @param {string} text
   * @param {number} [baseDelay=67] - Base delay between keystrokes in ms
   */
  async _humanType(element, text, baseDelay = 67) {
    // Initial delay before starting to type (like moving hand to keyboard)
    await sleep(this._randomDelay(50, 150));

    // Click to focus the element first
    await element.click();
    await sleep(this._randomDelay(30, 80));

    // Clear any existing text
    await element.fill('');
    await sleep(this._randomDelay(20, 50));

    // Type each character with random delays
    for (let i = 0; i < text.length; i++) {
      const char = text[i];

      // Random delay between keystrokes (varies around baseDelay)
      // Humans type faster in the middle of words, slower at the start
      const variance = baseDelay * 0.5;
      const delay = baseDelay + this._randomDelay(-variance, variance);

      // Occasional longer pauses (like thinking or finding a key)
      const pauseChance = Math.random();
      if (pauseChance < 0.05) {
        // 5% chance of a longer pause
        await sleep(this._randomDelay(150, 300));
      }

      await element.press(char);
      await sleep(Math.max(20, delay)); // Minimum 20ms delay
    }

    log('DEBUG', `Human-typed ${text.length} characters`);
  }

  /**
   * Sign out from current account
   * @returns {Promise<boolean>}
   */
  async signOut() {
    log('INFO', 'Signing out');

    try {
      // Check if signed in first
      if (!(await this.isSignedIn())) {
        log('DEBUG', 'Not signed in - no need to sign out');
        return true;
      }

      // Try to find account menu and click it first
      const accountMenuOpened = await this._openAccountMenu();

      // Find and click sign out button/link
      const signOutStrategies = [
        // Direct sign out buttons
        () => this.page.locator('button:has-text("Sign Out")'),
        () => this.page.locator('a:has-text("Sign Out")'),
        () => this.page.locator('button:has-text("Log Out")'),
        () => this.page.locator('a:has-text("Log Out")'),
        () => this.page.locator('button:has-text("Logout")'),
        () => this.page.locator('a:has-text("Logout")'),
        // By aria-label
        () => this.page.locator('[aria-label*="sign out" i], [aria-label*="log out" i]'),
        // By class/id
        () => this.page.locator('.sign-out, .logout, .signout, #logout, #sign-out'),
        () => this.page.locator('[class*="sign-out"], [class*="logout"]'),
        // In dropdown/menu
        () => this.page.locator('[class*="dropdown"], [class*="menu"]').locator('text=Sign Out'),
        () => this.page.locator('[class*="dropdown"], [class*="menu"]').locator('text=Log Out'),
      ];

      for (const strategy of signOutStrategies) {
        try {
          const btn = strategy();
          if (await btn.count() > 0) {
            const element = btn.first();
            if (await element.isVisible()) {
              await element.click();
              await sleep(2000);
              log('OK', 'Sign out clicked');

              // Wait for page to update
              try {
                await this.page.waitForLoadState('networkidle', { timeout: 10000 });
              } catch {
                // Continue
              }

              // Verify signed out
              const stillSignedIn = await this.isSignedIn();
              if (!stillSignedIn) {
                log('OK', 'Successfully signed out');
                return true;
              }
            }
          }
        } catch {
          // Try next
        }
      }

      // If sign out link not found, try navigating to logout URL
      const logoutUrls = [
        `${this.config.URL}/account/logout`,
        `${this.config.URL}/logout`,
        'https://auth.riotgames.com/logout',
      ];

      for (const url of logoutUrls) {
        try {
          log('DEBUG', `Trying logout URL: ${url}`);
          await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
          await sleep(2000);

          // Navigate back to main site
          await this.page.goto(this.config.URL, { waitUntil: 'domcontentloaded' });
          await sleep(1000);

          if (!(await this.isSignedIn())) {
            log('OK', 'Successfully signed out via URL');
            return true;
          }
        } catch {
          // Continue
        }
      }

      log('WARN', 'Could not sign out - may need manual intervention');
      await captureScreenshot(this.page, `warn-signout-failed-acct${this.currentAccountIndex}`);
      return false;

    } catch (err) {
      log('ERROR', `Sign out failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Click sign in button/link
   * @returns {Promise<boolean>}
   */
  async _clickSignIn() {
    log('DEBUG', 'Searching for sign in button...');

    const strategies = [
      // Riot Merch specific - look for Sign In text in header
      () => this.page.locator('header').getByRole('link', { name: /sign in/i }),
      () => this.page.locator('header').getByRole('button', { name: /sign in/i }),
      () => this.page.locator('header').getByText('Sign In'),
      () => this.page.locator('header a').filter({ hasText: /sign in/i }),
      () => this.page.locator('header button').filter({ hasText: /sign in/i }),
      // Generic Sign In text
      () => this.page.getByRole('link', { name: /sign in/i }),
      () => this.page.getByRole('button', { name: /sign in/i }),
      () => this.page.locator('a:has-text("Sign In")'),
      () => this.page.locator('button:has-text("Sign In")'),
      // Log In variations
      () => this.page.locator('header').getByText('Log In'),
      () => this.page.locator('a:has-text("Log In"), button:has-text("Log In")'),
      () => this.page.locator('a:has-text("Login"), button:has-text("Login")'),
      // By aria-label
      () => this.page.locator('[aria-label*="sign in" i]'),
      () => this.page.locator('[aria-label*="log in" i]'),
      // By href to auth
      () => this.page.locator('a[href*="auth.riotgames.com"]'),
      () => this.page.locator('a[href*="login"]'),
      () => this.page.locator('a[href*="signin"]'),
      // Account/User icon that might lead to login
      () => this.page.locator('header [class*="account"]').first(),
      () => this.page.locator('header [class*="user"]').first(),
    ];

    for (let i = 0; i < strategies.length; i++) {
      try {
        const btn = strategies[i]();
        const count = await btn.count();
        if (count > 0) {
          const element = btn.first();
          if (await element.isVisible()) {
            const text = await element.textContent().catch(() => '');
            log('DEBUG', `Found clickable element (strategy ${i + 1}): "${text?.trim() || 'no text'}"`);
            await element.click();
            await sleep(1000);
            log('OK', 'Clicked sign in button');
            return true;
          }
        }
      } catch (err) {
        log('DEBUG', `Strategy ${i + 1} failed: ${err.message}`);
      }
    }

    // Last resort: try to find any element with "sign" and "in" in the text
    try {
      const allLinks = this.page.locator('a, button');
      const count = await allLinks.count();
      log('DEBUG', `Scanning ${count} links/buttons for sign in...`);

      for (let i = 0; i < Math.min(count, 50); i++) {
        const el = allLinks.nth(i);
        const text = await el.textContent().catch(() => '');
        if (text && /sign\s*in|log\s*in/i.test(text)) {
          if (await el.isVisible()) {
            log('DEBUG', `Found sign in via scan: "${text.trim()}"`);
            await el.click();
            await sleep(1000);
            log('OK', 'Clicked sign in button (via scan)');
            return true;
          }
        }
      }
    } catch (err) {
      log('DEBUG', `Scan failed: ${err.message}`);
    }

    log('ERROR', 'No sign in button found after all strategies');
    return false;
  }

  /**
   * Wait for sign in page/modal to load
   */
  async _waitForSignInPage() {
    log('DEBUG', 'Waiting for sign in page');

    try {
      // Wait for page navigation or modal
      await Promise.race([
        this.page.waitForURL(/auth\.riotgames\.com|login|signin/i, { timeout: 15000 }),
        this.page.waitForSelector('input[name="username"], input[type="email"], input[name="email"]', { timeout: 15000 }),
      ]);
    } catch {
      // Continue - page may already be loaded
    }

    await sleep(1500);
  }

  /**
   * Fill username field with human-like typing
   * @param {string} username
   * @returns {Promise<boolean>}
   */
  async _fillUsername(username) {
    const strategies = [
      // By role
      () => this.page.getByRole('textbox', { name: /username|email/i }),
      // By type
      () => this.page.locator('input[type="email"]'),
      () => this.page.locator('input[type="text"]').first(),
      // By name attribute
      () => this.page.locator('input[name="username"]'),
      () => this.page.locator('input[name="email"]'),
      () => this.page.locator('input[name="login"]'),
      // By placeholder
      () => this.page.locator('input[placeholder*="username" i]'),
      () => this.page.locator('input[placeholder*="email" i]'),
      // By id
      () => this.page.locator('#username, #email, #login'),
      // By autocomplete
      () => this.page.locator('input[autocomplete="username"], input[autocomplete="email"]'),
    ];

    for (const strategy of strategies) {
      try {
        const input = strategy();
        if (await input.count() > 0) {
          const element = input.first();
          if (await element.isVisible()) {
            // Use human-like typing
            await this._humanType(element, username, 67);
            log('DEBUG', 'Filled username (human-like typing)');
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
   * Fill password field with human-like typing
   * @param {string} password
   * @returns {Promise<boolean>}
   */
  async _fillPassword(password) {
    const strategies = [
      // By type
      () => this.page.locator('input[type="password"]'),
      // By name
      () => this.page.locator('input[name="password"]'),
      () => this.page.locator('input[name="pass"]'),
      // By placeholder
      () => this.page.locator('input[placeholder*="password" i]'),
      // By id
      () => this.page.locator('#password'),
      // By autocomplete
      () => this.page.locator('input[autocomplete="current-password"]'),
    ];

    for (const strategy of strategies) {
      try {
        const input = strategy();
        if (await input.count() > 0) {
          const element = input.first();
          if (await element.isVisible()) {
            // Use human-like typing
            await this._humanType(element, password, 67);
            log('DEBUG', 'Filled password (human-like typing)');
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
   * Submit sign in form
   * @returns {Promise<boolean>}
   */
  async _submitSignIn() {
    const strategies = [
      // Sign In button
      () => this.page.getByRole('button', { name: /sign in|log in|login|submit/i }),
      () => this.page.locator('button[type="submit"]'),
      () => this.page.locator('button:has-text("Sign In")'),
      () => this.page.locator('button:has-text("Log In")'),
      () => this.page.locator('button:has-text("Login")'),
      () => this.page.locator('input[type="submit"]'),
      // By class
      () => this.page.locator('.login-button, .submit-button, .sign-in-button'),
    ];

    for (const strategy of strategies) {
      try {
        const btn = strategy();
        if (await btn.count() > 0) {
          const element = btn.first();
          if (await element.isVisible() && await element.isEnabled()) {
            await element.click();
            log('DEBUG', 'Submitted sign in form');
            return true;
          }
        }
      } catch {
        // Try next
      }
    }

    // Fallback: press Enter on password field
    try {
      await this.page.locator('input[type="password"]').first().press('Enter');
      log('DEBUG', 'Submitted via Enter key');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Wait for sign in to complete (includes CAPTCHA solving time)
   */
  async _waitForSignInComplete() {
    log('DEBUG', 'Waiting for sign in to complete (CAPTCHA may be required)');
    log('INFO', '>>> Waiting up to 60 seconds for CAPTCHA / sign-in completion <<<');

    const startTime = Date.now();
    const maxWaitTime = 60000; // 60 seconds for CAPTCHA solving

    try {
      // Wait for navigation away from auth page (user solved CAPTCHA and logged in)
      while (Date.now() - startTime < maxWaitTime) {
        const currentUrl = this.page.url();

        // Check if we've left the auth/login page
        if (!currentUrl.includes('auth.riotgames.com') &&
            !currentUrl.includes('login') &&
            !currentUrl.includes('authenticate')) {
          log('OK', 'Sign-in page navigation detected - login may be complete');
          break;
        }

        // Check for error messages on login page
        const hasError = await this._hasSignInError();
        if (hasError) {
          log('WARN', 'Sign-in error detected on page');
          break;
        }

        await sleep(1000);

        // Log progress every 10 seconds
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        if (elapsed > 0 && elapsed % 10 === 0) {
          log('INFO', `Still waiting for sign-in... ${elapsed}s elapsed (solve CAPTCHA if present)`);
        }
      }
    } catch (err) {
      log('DEBUG', `Wait error: ${err.message}`);
    }

    // Additional wait for page to stabilize
    await sleep(2000);
    log('DEBUG', 'Sign-in wait complete');
  }

  /**
   * Check for sign in error messages
   * @returns {Promise<boolean>}
   */
  async _hasSignInError() {
    const errorSelectors = [
      // Error messages
      ':text("invalid")',
      ':text("incorrect")',
      ':text("wrong password")',
      ':text("authentication failed")',
      ':text("account not found")',
      // Error containers
      '.error, .error-message, [class*="error"]',
      '[role="alert"]',
      '.alert-danger, .alert-error',
    ];

    for (const selector of errorSelectors) {
      try {
        const error = this.page.locator(selector);
        if (await error.count() > 0 && await error.first().isVisible()) {
          const text = await error.first().textContent().catch(() => '');
          if (text && /invalid|incorrect|wrong|failed|error/i.test(text)) {
            log('DEBUG', `Found sign in error: ${text.substring(0, 50)}`);
            return true;
          }
        }
      } catch {
        // Continue
      }
    }

    return false;
  }

  /**
   * Open account menu/dropdown
   * @returns {Promise<boolean>}
   */
  async _openAccountMenu() {
    const menuTriggers = [
      () => this.page.locator('header [class*="account"]'),
      () => this.page.locator('[aria-label*="account" i]'),
      () => this.page.locator('header [class*="user"]'),
      () => this.page.locator('.account-menu-trigger, .user-menu'),
    ];

    for (const trigger of menuTriggers) {
      try {
        const menu = trigger();
        if (await menu.count() > 0) {
          const element = menu.first();
          if (await element.isVisible()) {
            await element.click();
            await sleep(500);
            return true;
          }
        }
      } catch {
        // Continue
      }
    }

    return false;
  }

  /**
   * Check if product limit has been reached for this account
   * @returns {Promise<boolean>}
   */
  async hasReachedPurchaseLimit() {
    const limitIndicators = [
      // Common limit messages
      ':text("limit")',
      ':text("already purchased")',
      ':text("maximum")',
      ':text("one per")',
      ':text("1 per")',
      ':text("only one")',
      ':text("limit reached")',
      // Error specific to limits
      '.limit-error, .purchase-limit',
      '[class*="limit"]',
    ];

    for (const selector of limitIndicators) {
      try {
        const indicator = this.page.locator(selector);
        if (await indicator.count() > 0 && await indicator.first().isVisible()) {
          const text = await indicator.first().textContent().catch(() => '');
          if (text && /limit|maximum|already|one per|1 per/i.test(text)) {
            log('WARN', `Purchase limit indicator found: ${text.substring(0, 50)}`);
            return true;
          }
        }
      } catch {
        // Continue
      }
    }

    return false;
  }
}

module.exports = AccountManager;
