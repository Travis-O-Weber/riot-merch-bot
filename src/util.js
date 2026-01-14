/**
 * Utility functions for Riot Merch Bot
 * - Logging
 * - Retry with exponential backoff
 * - Screenshot capture
 * - Fuzzy matching
 */
const fs = require('fs');
const path = require('path');
const stringSimilarity = require('string-similarity');

const SS_DIR = path.join(__dirname, '..', 'screens');
const LOG_DIR = path.join(__dirname, '..', 'logs');

// Ensure base directories exist
if (!fs.existsSync(SS_DIR)) fs.mkdirSync(SS_DIR, { recursive: true });
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// Run context - set once at bot startup, used for unified artifacts
let _runContext = {
  runId: null,
  runDir: null,
  startTime: null,
  accountIndex: -1  // -1 = no account context
};

/**
 * Initialize run context for unified failure artifacts
 * Creates a run-specific folder: logs/run_YYYY-MM-DDTHH-MM-SS/
 * @returns {{runId: string, runDir: string, startTime: string}}
 */
function initRunContext() {
  const now = new Date();
  const runId = now.toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(LOG_DIR, `run_${runId}`);
  
  fs.mkdirSync(runDir, { recursive: true });
  
  _runContext = {
    runId,
    runDir,
    startTime: now.toISOString(),
    accountIndex: -1
  };
  
  log('INFO', `Run artifacts folder: ${runDir}`);
  return { runId, runDir, startTime: _runContext.startTime };
}

/**
 * Get current run context
 * @returns {{runId: string|null, runDir: string|null, startTime: string|null, accountIndex: number}}
 */
function getRunContext() {
  return { ..._runContext };
}

/**
 * Set current account index for failure context
 * @param {number} index - Account index (0-based), -1 for no account context
 */
function setAccountContext(index) {
  _runContext.accountIndex = index;
}

/**
 * Get current account index
 * @returns {number}
 */
function getAccountContext() {
  return _runContext.accountIndex;
}

/**
 * Log message with timestamp and level
 * @param {'INFO'|'OK'|'WARN'|'ERROR'|'DEBUG'} level
 * @param {string} message
 */
function log(level, message) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${level.padEnd(5)} ${message}`;
  console.log(logLine);

  // Write to daily log file
  const dailyLogFile = path.join(LOG_DIR, `${new Date().toISOString().split('T')[0]}.log`);
  fs.appendFileSync(dailyLogFile, logLine + '\n');

  // Also write to run-specific log if run context exists
  if (_runContext.runDir) {
    const runLogFile = path.join(_runContext.runDir, 'run.log');
    fs.appendFileSync(runLogFile, logLine + '\n');
  }
}

/**
 * Log a failure with full context (account index, step, URL, error)
 * @param {string} step - Current step name
 * @param {string} url - Current page URL
 * @param {Error|string} error - Error object or message
 * @param {Object} options - Additional options
 * @param {number} options.accountIndex - Account index override (uses context if not set)
 */
function logFailure(step, url, error, options = {}) {
  const accountIndex = options.accountIndex !== undefined 
    ? options.accountIndex 
    : _runContext.accountIndex;
  
  const errorMsg = error instanceof Error ? error.message : String(error);
  const accountPart = accountIndex >= 0 ? `[Account ${accountIndex + 1}]` : '[NoAccount]';
  
  log('ERROR', `${accountPart} Step: ${step} | URL: ${url} | Error: ${errorMsg}`);

  // Write structured failure to run folder
  if (_runContext.runDir) {
    const failureEntry = {
      timestamp: new Date().toISOString(),
      accountIndex,
      step,
      url,
      error: errorMsg
    };
    const failuresFile = path.join(_runContext.runDir, 'failures.jsonl');
    fs.appendFileSync(failuresFile, JSON.stringify(failureEntry) + '\n');
  }
}

/**
 * Retry an action with exponential backoff
 * @param {Function} action - Async function to retry
 * @param {number} maxRetries - Maximum retry attempts
 * @param {string} description - Description for logging
 * @param {Object} options - Additional options
 * @param {Object} options.page - Playwright page for screenshots
 * @param {boolean} options.screenshotOnFail - Take screenshot on failure
 */
async function withRetry(action, maxRetries, description, options = {}) {
  let attempts = 0;
  const backoffs = [100, 200, 400, 800, 1600]; // Exponential backoff

  while (attempts < maxRetries) {
    try {
      const result = await action();
      return result;
    } catch (error) {
      attempts++;
      log('WARN', `Retry ${attempts}/${maxRetries} for ${description}: ${error.message}`);

      // Take screenshot on failure if page provided
      if (options.page && options.screenshotOnFail !== false) {
        await captureScreenshot(options.page, `retry-${attempts}-${sanitizeFilename(description)}`);
      }

      if (attempts < maxRetries) {
        const delay = backoffs[attempts - 1] || 1600;
        await sleep(delay);
      } else {
        // Final failure - capture error screenshot
        if (options.page) {
          await captureScreenshot(options.page, `error-${sanitizeFilename(description)}`);
        }
        throw error;
      }
    }
  }
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Random sleep to appear more human (adds 20-80% variance)
 * @param {number} baseMs - Base delay in milliseconds
 */
function humanDelay(baseMs = 1000) {
  const variance = 0.2 + Math.random() * 0.6; // 20-80% of base
  const delay = Math.floor(baseMs * (1 + variance));
  return sleep(delay);
}

/**
 * Random delay between actions (500-2000ms)
 */
function randomDelay() {
  return sleep(500 + Math.random() * 1500);
}

/**
 * Capture screenshot with timestamp, account index, and step name
 * Filename format: TIMESTAMP_accN_STEP.png (or TIMESTAMP_STEP.png if no account)
 * Screenshots are saved to:
 *   - SS_DIR (screens/) for backward compatibility
 *   - Run folder if run context is initialized
 * 
 * @param {import('playwright').Page} page
 * @param {string} name - Screenshot name (step name)
 * @param {boolean|Object} fullPageOrOptions - fullPage boolean or options object
 * @param {boolean} fullPageOrOptions.fullPage - Capture full page
 * @param {number} fullPageOrOptions.accountIndex - Account index override
 */
async function captureScreenshot(page, name, fullPageOrOptions = true) {
  try {
    const options = typeof fullPageOrOptions === 'object' 
      ? fullPageOrOptions 
      : { fullPage: fullPageOrOptions };
    
    const fullPage = options.fullPage !== false;
    const accountIndex = options.accountIndex !== undefined 
      ? options.accountIndex 
      : _runContext.accountIndex;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const accountPart = accountIndex >= 0 ? `acc${accountIndex + 1}` : '';
    const sanitizedName = sanitizeFilename(name);
    
    // Build filename: TIMESTAMP_accN_STEP.png
    const filenameParts = [timestamp];
    if (accountPart) filenameParts.push(accountPart);
    filenameParts.push(sanitizedName);
    const filename = filenameParts.join('_') + '.png';
    
    // Save to screens/ directory
    const filepath = path.join(SS_DIR, filename);
    await page.screenshot({ path: filepath, fullPage });
    log('INFO', `Screenshot saved: ${filename}`);

    // Also save to run folder if context exists
    if (_runContext.runDir) {
      const runFilepath = path.join(_runContext.runDir, filename);
      await page.screenshot({ path: runFilepath, fullPage });
    }

    return filepath;
  } catch (err) {
    log('WARN', `Failed to capture screenshot: ${err.message}`);
    return null;
  }
}

/**
 * Capture failure screenshot with unified naming and logging
 * Combines logFailure + captureScreenshot for convenience
 * @param {import('playwright').Page} page
 * @param {string} step - Current step name
 * @param {Error|string} error - Error object or message
 * @param {Object} options - Additional options
 * @param {number} options.accountIndex - Account index override
 */
async function captureFailure(page, step, error, options = {}) {
  const url = page ? await page.url().catch(() => 'unknown') : 'no-page';
  logFailure(step, url, error, options);
  
  if (page) {
    return await captureScreenshot(page, `fail-${step}`, {
      fullPage: true,
      accountIndex: options.accountIndex
    });
  }
  return null;
}

/**
 * Sanitize string for use as filename
 * @param {string} str
 */
function sanitizeFilename(str) {
  return str
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

/**
 * Fuzzy match product name against target
 * @param {string} productName - Product name from page
 * @param {string[]} targetNames - Target names/synonyms to match
 * @param {number} threshold - Similarity threshold (0-1)
 * @returns {{matched: boolean, score: number, matchedName: string}}
 */
function fuzzyMatch(productName, targetNames, threshold = 0.5) {
  const normalizedProduct = normalizeText(productName);

  for (const target of targetNames) {
    const normalizedTarget = normalizeText(target);

    // Exact match (case-insensitive)
    if (normalizedProduct === normalizedTarget) {
      return { matched: true, score: 1.0, matchedName: target };
    }

    // Contains match
    if (normalizedProduct.includes(normalizedTarget) || normalizedTarget.includes(normalizedProduct)) {
      return { matched: true, score: 0.9, matchedName: target };
    }

    // Fuzzy similarity
    const score = stringSimilarity.compareTwoStrings(normalizedProduct, normalizedTarget);
    if (score >= threshold) {
      return { matched: true, score, matchedName: target };
    }

    // Word-level matching (all target words present)
    const targetWords = normalizedTarget.split(/\s+/).filter(w => w.length > 2);
    const productWords = normalizedProduct.split(/\s+/);
    const matchedWords = targetWords.filter(tw =>
      productWords.some(pw => pw.includes(tw) || tw.includes(pw))
    );
    if (targetWords.length > 0 && matchedWords.length >= targetWords.length * 0.7) {
      return { matched: true, score: 0.8, matchedName: target };
    }
  }

  return { matched: false, score: 0, matchedName: null };
}

/**
 * Normalize text for comparison
 * @param {string} text
 */
function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')  // Remove special chars
    .replace(/\s+/g, ' ')       // Normalize whitespace
    .trim();
}

/**
 * Wait for any of multiple selectors
 * @param {import('playwright').Page} page
 * @param {string[]} selectors
 * @param {number} timeout
 * @returns {Promise<import('playwright').Locator|null>}
 */
async function waitForAny(page, selectors, timeout = 10000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    for (const selector of selectors) {
      try {
        const locator = page.locator(selector);
        if (await locator.count() > 0 && await locator.first().isVisible()) {
          return locator.first();
        }
      } catch {
        // Continue to next selector
      }
    }
    await sleep(100);
  }

  return null;
}

/**
 * Click element with multiple fallback strategies
 * @param {import('playwright').Page} page
 * @param {Array<() => import('playwright').Locator>} strategies - Array of functions returning locators
 * @param {string} description - For logging
 * @param {number} timeout
 */
async function clickWithFallback(page, strategies, description, timeout = 30000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    for (let i = 0; i < strategies.length; i++) {
      try {
        const locator = strategies[i]();
        if (await locator.count() > 0) {
          const element = locator.first();
          if (await element.isVisible() && await element.isEnabled()) {
            await element.click();
            log('OK', `${description} (strategy ${i + 1})`);
            return true;
          }
        }
      } catch {
        // Try next strategy
      }
    }
    await sleep(200);
  }

  throw new Error(`Failed to click: ${description} - no strategy succeeded`);
}

/**
 * Fill field if not empty value provided and field is empty
 * @param {import('playwright').Page} page
 * @param {string|import('playwright').Locator} selector
 * @param {string} value
 * @param {string} fieldName
 */
async function fillIfNotEmpty(page, selector, value, fieldName) {
  if (!value || value.trim() === '') {
    log('DEBUG', `Skipping ${fieldName} - no value provided`);
    return false;
  }

  try {
    const locator = typeof selector === 'string' ? page.locator(selector) : selector;
    if (await locator.count() === 0) {
      log('WARN', `Field ${fieldName} not found`);
      return false;
    }

    const element = locator.first();
    const currentValue = await element.inputValue().catch(() => '');

    if (currentValue && currentValue.trim() !== '') {
      log('DEBUG', `Skipping ${fieldName} - already has value`);
      return false;
    }

    await element.fill(value);
    log('OK', `Filled ${fieldName}`);
    return true;
  } catch (err) {
    log('WARN', `Failed to fill ${fieldName}: ${err.message}`);
    return false;
  }
}

/**
 * Mask sensitive data for logging
 * @param {string} value
 * @param {number} visibleChars
 */
function maskSensitive(value, visibleChars = 4) {
  if (!value || value.length <= visibleChars) return '****';
  return '*'.repeat(value.length - visibleChars) + value.slice(-visibleChars);
}

/**
 * Save account results to JSON file
 * Saves to both LOG_DIR and run folder (if initialized)
 * @param {Array} results - Array of account results
 */
function saveAccountResults(results) {
  if (!results || results.length === 0) return;

  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `account-results-${timestamp}.json`;

    const summary = {
      timestamp: new Date().toISOString(),
      runId: _runContext.runId,
      totalAccounts: results.length,
      successful: results.filter(r => r.status === 'success').length,
      failed: results.filter(r => r.status === 'error').length,
      outOfStock: results.filter(r => r.status === 'out_of_stock').length,
      limitReached: results.filter(r => r.status === 'limit_reached').length,
      results: results
    };

    // Save to main logs folder
    const filepath = path.join(LOG_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(summary, null, 2));
    log('INFO', `Account results saved to: ${filename}`);

    // Also save to run folder if initialized
    if (_runContext.runDir) {
      const runFilepath = path.join(_runContext.runDir, 'account-results.json');
      fs.writeFileSync(runFilepath, JSON.stringify(summary, null, 2));
    }

    return filepath;
  } catch (err) {
    log('WARN', `Failed to save account results: ${err.message}`);
    return null;
  }
}

/**
 * Create error context for logging
 * @param {string} step - Current step name
 * @param {number} accountIndex - Account index (-1 if not in multi-account mode)
 * @param {string} message - Error message
 * @returns {Object}
 */
function createErrorContext(step, accountIndex, message) {
  return {
    step,
    accountIndex,
    message,
    timestamp: new Date().toISOString()
  };
}

/**
 * Format error for logging with account context
 * @param {string} step - Current step
 * @param {number} accountIndex - Account index
 * @param {Error} error - Error object
 * @returns {string}
 */
function formatAccountError(step, accountIndex, error) {
  const accountPart = accountIndex >= 0 ? `[Account ${accountIndex + 1}] ` : '';
  return `${accountPart}${step}: ${error.message || error}`;
}

module.exports = {
  log,
  logFailure,
  withRetry,
  sleep,
  humanDelay,
  randomDelay,
  captureScreenshot,
  captureFailure,
  sanitizeFilename,
  fuzzyMatch,
  normalizeText,
  waitForAny,
  clickWithFallback,
  fillIfNotEmpty,
  maskSensitive,
  saveAccountResults,
  createErrorContext,
  formatAccountError,
  initRunContext,
  getRunContext,
  setAccountContext,
  getAccountContext,
  SS_DIR,
  LOG_DIR
};
