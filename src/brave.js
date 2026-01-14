/**
 * Browser launching with support for connecting to existing Chrome
 * Includes CAPTCHA avoidance measures
 */
const fs = require('fs');
const http = require('http');
const playwright = require('playwright');
const { log, sleep, captureScreenshot } = require('./util.js');

// Default CDP endpoint for Chrome with remote debugging
// IMPORTANT: Use 127.0.0.1 instead of localhost to avoid IPv6 ::1 resolution issues
const DEFAULT_CDP_ENDPOINT = 'http://127.0.0.1:9222';

/**
 * Verify that the CDP endpoint is listening by fetching /json/version
 * Also extracts webSocketDebuggerUrl for fallback connection
 * @param {string} cdpEndpoint - The CDP endpoint URL (e.g., http://127.0.0.1:9222)
 * @returns {Promise<{success: boolean, data?: Object, webSocketUrl?: string, error?: string}>}
 */
async function verifyCdpEndpoint(cdpEndpoint) {
  return new Promise((resolve) => {
    const versionUrl = `${cdpEndpoint}/json/version`;
    log('DEBUG', `Verifying CDP endpoint: ${versionUrl}`);

    const timeoutMs = 5000;
    const req = http.get(versionUrl, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(data);
            log('DEBUG', `CDP version info: Browser=${json.Browser || 'unknown'}`);
            const webSocketUrl = json.webSocketDebuggerUrl || null;
            if (webSocketUrl) {
              log('DEBUG', `WebSocket debugger URL available: ${webSocketUrl}`);
            }
            resolve({ success: true, data: json, webSocketUrl });
          } catch {
            resolve({ success: true, data: null, webSocketUrl: null });
          }
        } else {
          resolve({ success: false, error: `HTTP ${res.statusCode}` });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, error: 'Connection timed out' });
    });
  });
}

/**
 * Log actionable instructions for launching Chrome with remote debugging
 */
function logChromeInstructions() {
  log('INFO', '');
  log('INFO', '=== CHROME DEBUG MODE NOT DETECTED ===');
  log('INFO', '');
  log('INFO', 'To launch Chrome with remote debugging:');
  log('INFO', '');
  log('INFO', '  1. Close ALL Chrome windows completely');
  log('INFO', '');
  log('INFO', '  2. Run ONE of these commands in a terminal:');
  log('INFO', '');
  log('INFO', '     Windows (CMD):');
  log('INFO', '       "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%USERPROFILE%\\ChromeDebug"');
  log('INFO', '');
  log('INFO', '     Windows (PowerShell):');
  log('INFO', '       & "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:USERPROFILE\\ChromeDebug"');
  log('INFO', '');
  log('INFO', '     Or use the provided batch file:');
  log('INFO', '       1-launch-chrome.bat');
  log('INFO', '');
  log('INFO', '  3. Navigate to https://merch.riotgames.com and sign in');
  log('INFO', '');
  log('INFO', '  4. Run this bot again');
  log('INFO', '');
  log('INFO', 'NOTE: The --user-data-dir flag is REQUIRED for --remote-debugging-port to work.');
  log('INFO', '===========================================');
  log('INFO', '');
}

/**
 * Try to connect to Chrome via CDP using a specific endpoint (HTTP or WebSocket)
 * @param {string} endpoint - The endpoint URL to connect to
 * @param {string} method - 'HTTP' or 'WebSocket' for logging
 * @returns {Promise<{browser: import('playwright').Browser, context: import('playwright').BrowserContext, page: import('playwright').Page}|null>}
 */
async function tryConnectCDP(endpoint, method) {
  try {
    const browser = await playwright.chromium.connectOverCDP(endpoint);
    log('OK', `Connected to Chrome browser via CDP (${method})`);

    const contexts = browser.contexts();
    let context;
    let page;

    if (contexts.length > 0) {
      context = contexts[0];
      const pages = context.pages();

      page = pages.find(p => p.url().includes('merch.riotgames.com'));

      if (page) {
        log('OK', 'Found existing Riot Merch tab');
      } else if (pages.length > 0) {
        page = pages[0];
        log('INFO', `Using existing tab: ${page.url()}`);
      } else {
        page = await context.newPage();
        log('INFO', 'Created new tab in existing browser');
      }
    } else {
      context = await browser.newContext();
      page = await context.newPage();
      log('INFO', 'Created new context and tab');
    }

    return { browser, context, page };
  } catch (err) {
    log('WARN', `CDP connection failed (${method}): ${err.message}`);
    return null;
  }
}

/**
 * Connect to an existing Chrome browser via CDP (Chrome DevTools Protocol)
 * User must launch Chrome with: chrome.exe --remote-debugging-port=9222 --user-data-dir=...
 * 
 * This function:
 * 1. Uses 127.0.0.1 by default (never localhost to avoid IPv6 ::1 issues)
 * 2. Verifies the endpoint is listening before connecting
 * 3. Tries HTTP CDP first, then falls back to WebSocket URL if HTTP fails
 * 4. Retries with exponential backoff if connection fails
 * 5. Logs actionable instructions if Chrome is not running in debug mode
 * 6. Captures screenshot on failure if a page is available
 * 
 * @param {Object} config - Configuration object
 * @returns {Promise<{browser: import('playwright').Browser, context: import('playwright').BrowserContext, page: import('playwright').Page}>}
 */
async function connectToExistingChrome(config) {
  let cdpEndpoint = config.CDP_ENDPOINT || DEFAULT_CDP_ENDPOINT;
  const stepName = 'cdp-connect';

  // Ensure we're using 127.0.0.1 instead of localhost to avoid IPv6 issues
  if (cdpEndpoint.includes('localhost')) {
    const fixedEndpoint = cdpEndpoint.replace('localhost', '127.0.0.1');
    log('WARN', `CDP_ENDPOINT uses "localhost" which may resolve to IPv6 ::1`);
    log('INFO', `Rewriting to: ${fixedEndpoint}`);
    cdpEndpoint = fixedEndpoint;
  }

  log('INFO', `Connecting to existing Chrome at ${cdpEndpoint}...`);

  const maxRetries = config.MAX_RETRIES || 3;
  const backoffs = [500, 1000, 2000, 4000, 8000];
  let lastError = null;
  let webSocketUrl = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    log('INFO', `[Attempt ${attempt}/${maxRetries}] Verifying CDP endpoint...`);
    const verification = await verifyCdpEndpoint(cdpEndpoint);

    if (!verification.success) {
      log('WARN', `CDP endpoint not responding: ${verification.error}`);
      lastError = new Error(`CDP endpoint not available: ${verification.error}`);

      if (attempt === maxRetries) {
        logChromeInstructions();
        throw new Error(`CDP endpoint not available at ${cdpEndpoint}: ${verification.error}`);
      }

      const delay = backoffs[attempt - 1] || backoffs[backoffs.length - 1];
      log('INFO', `Retrying in ${delay}ms...`);
      await sleep(delay);
      continue;
    }

    log('OK', 'CDP endpoint verified - Chrome is listening');
    webSocketUrl = verification.webSocketUrl;

    // Step 2: Try HTTP CDP connection first
    log('INFO', 'Attempting HTTP CDP connection...');
    const httpResult = await tryConnectCDP(cdpEndpoint, 'HTTP');

    if (httpResult) {
      log('OK', 'Successfully connected using HTTP CDP');
      return httpResult;
    }

    // Step 3: Fall back to WebSocket if HTTP failed and webSocketUrl is available
    if (webSocketUrl) {
      log('INFO', `HTTP CDP failed, falling back to WebSocket: ${webSocketUrl}`);
      const wsResult = await tryConnectCDP(webSocketUrl, 'WebSocket');

      if (wsResult) {
        log('OK', 'Successfully connected using WebSocket CDP');
        return wsResult;
      }

      lastError = new Error('Both HTTP and WebSocket CDP connection attempts failed');
      log('WARN', lastError.message);
    } else {
      lastError = new Error('HTTP CDP connection failed and no WebSocket URL available');
      log('WARN', lastError.message);
    }

    if (attempt === maxRetries) {
      log('ERROR', `Failed to connect to Chrome after ${maxRetries} attempts`);
      log('ERROR', `Step: ${stepName}, URL: ${cdpEndpoint}`);
      logChromeInstructions();
      throw lastError;
    }

    const delay = backoffs[attempt - 1] || backoffs[backoffs.length - 1];
    log('INFO', `Retrying in ${delay}ms...`);
    await sleep(delay);
  }

  throw new Error('CDP connection failed after all retries');
}

/**
 * Capture failure screenshot with step name context
 * Used when CDP connection fails but we have a page reference
 * @param {import('playwright').Page} page
 * @param {string} stepName
 * @param {Error} error
 * @param {number} accountIndex
 */
async function captureConnectionFailure(page, stepName, error, accountIndex = -1) {
  if (!page) return;
  const accountPart = accountIndex >= 0 ? `acc${accountIndex + 1}` : '';
  const filename = `fail-${stepName}${accountPart ? '-' + accountPart : ''}`;
  await captureScreenshot(page, filename);
  log('ERROR', `[${stepName}] Account: ${accountIndex >= 0 ? accountIndex + 1 : 'N/A'}, Error: ${error.message}`);
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
  applyStealthScripts,
  captureConnectionFailure
};
