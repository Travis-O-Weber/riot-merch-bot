/**
 * Browser launching with support for connecting to existing Chrome
 * Includes CAPTCHA avoidance measures
 */
const fs = require('fs');
const playwright = require('playwright');
const { log } = require('./util.js');

// Default CDP endpoint for Chrome with remote debugging
const DEFAULT_CDP_ENDPOINT = 'http://localhost:9222';

/**
 * Connect to an existing Chrome browser via CDP (Chrome DevTools Protocol)
 * User must launch Chrome with: chrome.exe --remote-debugging-port=9222
 * @param {Object} config - Configuration object
 * @returns {Promise<{browser: import('playwright').Browser, context: import('playwright').BrowserContext, page: import('playwright').Page}>}
 */
async function connectToExistingChrome(config) {
  const cdpEndpoint = config.CDP_ENDPOINT || DEFAULT_CDP_ENDPOINT;

  log('INFO', `Connecting to existing Chrome at ${cdpEndpoint}...`);

  try {
    const browser = await playwright.chromium.connectOverCDP(cdpEndpoint);
    log('OK', 'Connected to existing Chrome browser');

    // Get the default context (the one the user is using)
    const contexts = browser.contexts();
    let context;
    let page;

    if (contexts.length > 0) {
      context = contexts[0];
      const pages = context.pages();

      // Find the Riot Merch page if it exists
      page = pages.find(p => p.url().includes('merch.riotgames.com'));

      if (page) {
        log('OK', 'Found existing Riot Merch tab');
      } else if (pages.length > 0) {
        // Use the first available page
        page = pages[0];
        log('INFO', `Using existing tab: ${page.url()}`);
      } else {
        // Create a new page
        page = await context.newPage();
        log('INFO', 'Created new tab in existing browser');
      }
    } else {
      // Create new context and page
      context = await browser.newContext();
      page = await context.newPage();
      log('INFO', 'Created new context and tab');
    }

    return { browser, context, page };
  } catch (err) {
    log('ERROR', `Failed to connect to Chrome: ${err.message}`);
    log('INFO', '');
    log('INFO', 'Make sure Chrome is running with remote debugging:');
    log('INFO', '  1. Close all Chrome windows');
    log('INFO', '  2. Run: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222');
    log('INFO', '  3. Navigate to merch.riotgames.com and sign in');
    log('INFO', '  4. Run this bot again');
    log('INFO', '');
    throw err;
  }
}

/**
 * Launch Brave browser or fallback to Chromium (original function)
 * @param {Object} config - Configuration object
 * @param {boolean} [forceFreshContext=false] - Force non-persistent context
 * @returns {Promise<{browser: import('playwright').Browser|null, context: import('playwright').BrowserContext, page: import('playwright').Page}>}
 */
async function launchBraveOrFallback(config, forceFreshContext = false) {
  const usePersistent = !forceFreshContext && config.USER_DATA_DIR && fs.existsSync(config.USER_DATA_DIR);

  // Try Brave first if path is configured
  if (config.BRAVE_PATH && fs.existsSync(config.BRAVE_PATH)) {
    try {
      log('INFO', `Attempting to launch Brave from: ${config.BRAVE_PATH}`);

      if (usePersistent) {
        log('INFO', `Using persistent context: ${config.USER_DATA_DIR}`);
        const context = await playwright.chromium.launchPersistentContext(
          config.USER_DATA_DIR,
          {
            executablePath: config.BRAVE_PATH,
            headless: config.HEADLESS,
            args: [
              '--no-sandbox',
              '--disable-blink-features=AutomationControlled',
              '--disable-dev-shm-usage',
              `--profile-directory=${config.PROFILE_DIR || 'Default'}`
            ],
            ignoreDefaultArgs: ['--enable-automation'],
            timeout: config.NAV_TIMEOUT_MS
          }
        );
        const page = context.pages()[0] || await context.newPage();
        await applyStealthScripts(page);
        log('OK', 'Launched Brave with persistent context');
        return { browser: null, context, page };
      } else {
        log('INFO', 'Using fresh context (non-persistent)');
        const browser = await playwright.chromium.launch({
          executablePath: config.BRAVE_PATH,
          headless: config.HEADLESS,
          args: [
            '--no-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage'
          ],
          ignoreDefaultArgs: ['--enable-automation'],
          timeout: config.NAV_TIMEOUT_MS
        });
        const context = await browser.newContext({
          viewport: { width: 1920, height: 1080 },
          locale: 'en-US',
          timezoneId: 'America/New_York',
        });
        const page = await context.newPage();
        await applyStealthScripts(page);
        log('OK', 'Launched Brave browser with fresh context');
        return { browser, context, page };
      }
    } catch (err) {
      log('WARN', `Failed to launch Brave: ${err.message}`);
      log('INFO', 'Falling back to Chromium...');
    }
  } else {
    log('INFO', 'Brave path not configured or not found, using Chromium');
  }

  // Fallback to Chromium
  try {
    const browser = await playwright.chromium.launch({
      headless: config.HEADLESS,
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
      timeout: config.NAV_TIMEOUT_MS
    });
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });
    const page = await context.newPage();
    await applyStealthScripts(page);
    log('OK', 'Launched Chromium browser');
    return { browser, context, page };
  } catch (err) {
    log('ERROR', `Failed to launch any browser: ${err.message}`);
    throw err;
  }
}

/**
 * Check if browser/context/page is still alive
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function isBrowserAlive(page) {
  if (!page) return false;
  try {
    await page.evaluate(() => true);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Safely close browser/context
 * For CDP connections, we disconnect instead of closing (to keep user's browser open)
 * @param {import('playwright').Browser|null} browser
 * @param {import('playwright').BrowserContext} context
 * @param {boolean} [isConnected=false] - If true, disconnect instead of close
 */
async function closeBrowser(browser, context, isConnected = false) {
  try {
    if (isConnected && browser) {
      // For CDP connections, disconnect (don't close user's browser)
      await browser.close(); // This disconnects for CDP
      log('INFO', 'Disconnected from browser (browser stays open)');
    } else if (browser) {
      await browser.close();
    } else if (context) {
      await context.close();
    }
  } catch (err) {
    log('DEBUG', `Browser close warning: ${err.message}`);
  }
}

/**
 * Apply stealth scripts to avoid bot detection
 * @param {import('playwright').Page} page
 */
async function applyStealthScripts(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });

    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin' },
        { name: 'Chrome PDF Viewer' },
        { name: 'Native Client' },
      ],
    });

    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });

    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
    delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
  });
}

module.exports = {
  connectToExistingChrome,
  launchBraveOrFallback,
  isBrowserAlive,
  closeBrowser,
  applyStealthScripts
};
