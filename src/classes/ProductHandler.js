/**
 * Product Handler - Discovers products and adds to cart
 */
const { log, withRetry, captureScreenshot, captureFailure, sleep, fuzzyMatch, clickWithFallback, normalizeText } = require('../util.js');
const stringSimilarity = require('string-similarity');

class ProductHandler {
  /**
   * @param {import('playwright').Page} page
   * @param {Object} SEL - Selectors object
   * @param {Object} config - Configuration
   * @param {Object} navigationManager - For search functionality
   * @param {Object} cartManager - For cart operations
   */
  constructor(page, SEL, config, navigationManager, cartManager) {
    this.page = page;
    this.SEL = SEL;
    this.config = config;
    this.navigation = navigationManager;
    this.cart = cartManager;
  }

  /**
   * Find and add all configured products
   * @returns {Promise<{totalAdded: number, results: Array<{product: string, status: string, message: string}>}>}
   */
  async processAllProducts() {
    let totalAdded = 0;
    const results = [];

    for (const product of this.config.PRODUCTS) {
      log('INFO', `Processing product: ${product.names[0]}`);

      try {
        const result = await withRetry(
          async () => {
            const addResult = await this.findAndAddProduct(product.names, product.quantity);
            // Only retry on 'error' or 'not_found' status, not on limit_reached or out_of_stock
            if (!addResult.success && (addResult.status === 'error' || addResult.status === 'not_found')) {
              throw new Error(addResult.message);
            }
            return addResult;
          },
          this.config.MAX_RETRIES,
          `Adding "${product.names[0]}"`,
          { page: this.page }
        );

        results.push({
          product: product.names[0],
          quantity: product.quantity,
          status: result.status,
          message: result.message
        });

        if (result.success) {
          totalAdded++;
          log('OK', `Successfully added: ${product.names[0]} x${product.quantity}`);
        } else if (result.status === 'limit_reached') {
          log('WARN', `Limit reached for "${product.names[0]}": ${result.message}`);
        } else if (result.status === 'out_of_stock') {
          log('WARN', `Out of stock: "${product.names[0]}"`);
        }
      } catch (err) {
        results.push({
          product: product.names[0],
          quantity: product.quantity,
          status: 'error',
          message: err.message
        });
        await captureFailure(this.page, `add-product-${product.names[0].substring(0, 20)}`, err);
      }

      // Close cart if open before processing next product
      await this.cart.closeIfOpen();
    }

    return { totalAdded, results };
  }

  /**
   * Find and add a single product
   * @param {string[]} productNames - Product names/synonyms
   * @param {number} quantity - Quantity to add
   * @returns {Promise<{success: boolean, status: 'success'|'limit_reached'|'out_of_stock'|'not_found'|'error', message: string}>}
   */
  async findAndAddProduct(productNames, quantity) {
    // Strategy 1: Navigate by game category (Homepage → Category → Game)
    log('INFO', 'Strategy 1: Navigating by game category');
    const navigatedToCategory = await this._navigateToGameCategory(productNames[0]);
    if (navigatedToCategory) {
      await this._loadAllProducts();
      const foundInCategory = await this._findProductInListing(productNames);
      if (foundInCategory) {
        return await this._addProductToCart(foundInCategory, quantity);
      }
    }

    // Strategy 2: Browse from homepage and load products
    log('INFO', 'Strategy 2: Browsing from homepage');
    await this.navigation.goToHomepage();
    await this._loadAllProducts();
    const foundOnHome = await this._findProductInListing(productNames);
    if (foundOnHome) {
      return await this._addProductToCart(foundOnHome, quantity);
    }

    // Strategy 3: Browse shop/all products page
    log('INFO', 'Strategy 3: Navigating to all products');
    const navigatedToShop = await this.navigation.goToShop();
    if (navigatedToShop) {
      await this._loadAllProducts();
      const foundInShop = await this._findProductInListing(productNames);
      if (foundInShop) {
        return await this._addProductToCart(foundInShop, quantity);
      }
    }

    // Strategy 4: Fallback to search only if browsing fails
    log('INFO', 'Strategy 4: Using search as fallback');
    for (const name of productNames) {
      const searched = await this.navigation.searchForProduct(name);
      if (searched) {
        const found = await this._findProductInListing(productNames);
        if (found) {
          return await this._addProductToCart(found, quantity);
        }
      }
    }

    log('ERROR', 'Product not found with any strategy');
    return { success: false, status: 'not_found', message: 'Product not found with any discovery strategy' };
  }

  /**
   * Navigate to game category: Homepage → Category Menu (top nav) → Game
   * @param {string} productName
   * @returns {Promise<boolean>}
   */
  async _navigateToGameCategory(productName) {
    const lowerName = productName.toLowerCase();

    // Determine which game category to navigate to
    let gameCategory = null;
    const gameMappings = [
      { keywords: ['valorant', 'vlrnt', 'valo', 'frgmt', 'wngmn'], game: 'VALORANT' },
      { keywords: ['league', 'lol', 'legends', 'arcane'], game: 'LEAGUE OF LEGENDS' },
      { keywords: ['tft', 'teamfight'], game: 'TEAMFIGHT TACTICS' },
      { keywords: ['wild rift', 'wildrift'], game: 'WILD RIFT' },
      { keywords: ['lor', 'runeterra'], game: 'LEGENDS OF RUNETERRA' },
    ];

    for (const mapping of gameMappings) {
      if (mapping.keywords.some(kw => lowerName.includes(kw))) {
        gameCategory = mapping.game;
        break;
      }
    }

    if (!gameCategory) {
      log('WARN', 'Could not determine game category from product name');
      return false;
    }

    log('INFO', `Navigating to game category: ${gameCategory}`);

    // Step 1: Look for CATEGORIES link in top navigation header
    const categoryTriggers = [
      // Target the top nav bar specifically
      () => this.page.locator('header a, nav a').filter({ hasText: /^CATEGORIES$/i }),
      () => this.page.locator('header').getByRole('link', { name: /categories/i }),
      () => this.page.locator('nav').getByRole('link', { name: /categories/i }),
      () => this.page.locator('a:has-text("CATEGORIES")'),
      () => this.page.locator('[class*="header"] a:has-text("Categories")'),
      () => this.page.locator('[class*="nav"] a:has-text("Categories")'),
    ];

    // Try to hover/click category menu to reveal dropdown
    let categoryMenuOpened = false;
    for (const trigger of categoryTriggers) {
      try {
        const menu = trigger();
        if (await menu.count() > 0 && await menu.first().isVisible()) {
          await menu.first().hover();
          await sleep(1000);
          log('DEBUG', 'Hovered on CATEGORIES in top nav');
          categoryMenuOpened = true;
          break;
        }
      } catch {
        // Continue
      }
    }

    if (!categoryMenuOpened) {
      log('WARN', 'Could not find CATEGORIES menu in top nav');
    }

    // Step 2: Look for the game link in the dropdown or visible nav
    const gameSelectors = [
      // Exact match in dropdown/submenu
      () => this.page.locator('[class*="dropdown"], [class*="submenu"], [class*="menu"]').getByRole('link', { name: new RegExp(`^${gameCategory}$`, 'i') }),
      () => this.page.locator('[class*="dropdown"], [class*="submenu"]').locator(`a:has-text("${gameCategory}")`),
      // In visible nav
      () => this.page.locator('header, nav').getByRole('link', { name: new RegExp(gameCategory, 'i') }),
      () => this.page.locator(`header a:has-text("${gameCategory}"), nav a:has-text("${gameCategory}")`),
      // More generic
      () => this.page.getByRole('link', { name: new RegExp(gameCategory, 'i') }).first(),
    ];

    for (const selector of gameSelectors) {
      try {
        const link = selector();
        if (await link.count() > 0) {
          const element = link.first();
          if (await element.isVisible()) {
            await element.click();
            await this.navigation._waitForPageLoad();
            log('OK', `Navigated to ${gameCategory} category via top nav`);
            return true;
          }
        }
      } catch {
        // Continue
      }
    }

    log('WARN', `Could not navigate to ${gameCategory} category`);
    return false;
  }

  /**
   * Try to navigate to a relevant category based on product name (legacy)
   * @param {string} productName
   * @returns {Promise<boolean>}
   */
  async _navigateToRelevantCategory(productName) {
    const lowerName = productName.toLowerCase();

    // Map keywords to category links
    const categoryMappings = [
      { keywords: ['valorant', 'vlrnt', 'valo'], linkText: /valorant/i },
      { keywords: ['league', 'lol', 'legends'], linkText: /league/i },
      { keywords: ['arcane'], linkText: /arcane/i },
      { keywords: ['plush', 'keychain', 'collectible'], linkText: /collectibles|accessories/i },
      { keywords: ['apparel', 'shirt', 'hoodie'], linkText: /apparel|clothing/i },
    ];

    for (const mapping of categoryMappings) {
      if (mapping.keywords.some(kw => lowerName.includes(kw))) {
        try {
          const categoryLink = this.page.getByRole('link', { name: mapping.linkText });
          if (await categoryLink.count() > 0 && await categoryLink.first().isVisible()) {
            await categoryLink.first().click();
            await this.navigation._waitForPageLoad();
            log('OK', `Navigated to category: ${mapping.linkText}`);
            return true;
          }
        } catch {
          // Continue
        }
      }
    }

    return false;
  }

  /**
   * Find product in current listing
   * @param {string[]} productNames - Names to match
   * @returns {Promise<import('playwright').Locator|null>}
   */
  async _findProductInListing(productNames) {
    await sleep(1000); // Wait for products to render

    // Get all product cards
    const cardStrategies = [
      () => this.SEL.productCard(),
      () => this.SEL.productCardFallback1(),
      () => this.SEL.productCardFallback2(),
      () => this.SEL.productCardFallback3(),
    ];

    let cards = null;
    for (const strategy of cardStrategies) {
      try {
        const locator = strategy();
        const count = await locator.count();
        if (count > 0) {
          cards = locator;
          log('DEBUG', `Found ${count} product cards`);
          break;
        }
      } catch {
        // Try next
      }
    }

    if (!cards) {
      log('WARN', 'No product cards found on page');
      await captureScreenshot(this.page, 'product-search-no-cards');
      return null;
    }

    // Collect all candidates with scores for logging on failure
    const candidates = [];
    const count = await cards.count();
    
    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      try {
        // Get product title text
        const titleText = await this._getProductTitle(card);
        if (!titleText) continue;

        // Calculate best match score against all target names
        const matchResult = this._calculateBestMatchScore(titleText, productNames);
        candidates.push({
          index: i,
          title: titleText,
          score: matchResult.score,
          matchedAgainst: matchResult.matchedAgainst,
          card
        });

        // Check if this matches using fuzzyMatch (includes contains matching etc)
        const match = fuzzyMatch(titleText, productNames, this.config.FUZZY_THRESHOLD);
        if (match.matched) {
          log('OK', `Found product: "${titleText}" (score: ${match.score.toFixed(2)}, matched: "${match.matchedName}")`);
          return card;
        }
      } catch (err) {
        log('DEBUG', `Error checking card ${i}: ${err.message}`);
      }
    }

    // Product not found - log top 5 candidates for debugging
    await this._logTopCandidates(productNames, candidates, 5);
    return null;
  }

  /**
   * Calculate the best match score for a product title against target names
   * @param {string} productTitle - The product title from the page
   * @param {string[]} targetNames - Target names/synonyms to match against
   * @returns {{score: number, matchedAgainst: string}}
   */
  _calculateBestMatchScore(productTitle, targetNames) {
    const normalizedProduct = normalizeText(productTitle);
    let bestScore = 0;
    let matchedAgainst = targetNames[0] || '';

    for (const target of targetNames) {
      const normalizedTarget = normalizeText(target);

      // Exact match
      if (normalizedProduct === normalizedTarget) {
        return { score: 1.0, matchedAgainst: target };
      }

      // Contains match - high score
      if (normalizedProduct.includes(normalizedTarget)) {
        const score = 0.9;
        if (score > bestScore) {
          bestScore = score;
          matchedAgainst = target;
        }
        continue;
      }

      if (normalizedTarget.includes(normalizedProduct)) {
        const score = 0.85;
        if (score > bestScore) {
          bestScore = score;
          matchedAgainst = target;
        }
        continue;
      }

      // String similarity score
      const score = stringSimilarity.compareTwoStrings(normalizedProduct, normalizedTarget);
      if (score > bestScore) {
        bestScore = score;
        matchedAgainst = target;
      }
    }

    return { score: bestScore, matchedAgainst };
  }

  /**
   * Log top N candidate matches for debugging failed product search
   * @param {string[]} targetNames - What we were searching for
   * @param {Array<{index: number, title: string, score: number, matchedAgainst: string}>} candidates
   * @param {number} topN - Number of top candidates to log
   */
  async _logTopCandidates(targetNames, candidates, topN = 5) {
    log('WARN', `Product not found. Searched for: "${targetNames.join(' | ')}"`);
    log('WARN', `Fuzzy threshold: ${this.config.FUZZY_THRESHOLD}`);

    if (candidates.length === 0) {
      log('WARN', 'No product titles could be extracted from cards');
      await captureScreenshot(this.page, 'product-search-failed-no-titles');
      return;
    }

    // Sort by score descending and take top N
    const topCandidates = [...candidates]
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);

    log('INFO', `Top ${topCandidates.length} candidate matches:`);
    for (let i = 0; i < topCandidates.length; i++) {
      const c = topCandidates[i];
      log('INFO', `  ${i + 1}. "${c.title}" (score: ${c.score.toFixed(3)} vs "${c.matchedAgainst}")`);
    }

    // Take screenshot for debugging
    await captureScreenshot(this.page, 'product-search-failed-with-candidates');
  }

  /**
   * Get product title from card
   * @param {import('playwright').Locator} card
   * @returns {Promise<string|null>}
   */
  async _getProductTitle(card) {
    // Try specific title selectors within card
    const titleSelectors = [
      '.product-card__title',
      '.product-title',
      '.product-name',
      '[class*="product"][class*="title"]',
      '[class*="product"][class*="name"]',
      'h2', 'h3', 'h4',
      'a[href*="/products/"]'
    ];

    for (const selector of titleSelectors) {
      try {
        const title = card.locator(selector).first();
        if (await title.count() > 0) {
          const text = await title.textContent();
          if (text && text.trim()) {
            return text.trim();
          }
        }
      } catch {
        // Try next
      }
    }

    // Fallback: get card's full text
    try {
      const text = await card.textContent();
      return text ? text.trim().split('\n')[0] : null;
    } catch {
      return null;
    }
  }

  /**
   * Add product to cart
   * @param {import('playwright').Locator} productCard
   * @param {number} quantity
   * @returns {Promise<{success: boolean, status: 'success'|'limit_reached'|'out_of_stock'|'error', message: string}>}
   */
  async _addProductToCart(productCard, quantity) {
    // First, click on the product to go to product page
    log('INFO', 'Clicking product to open product page');

    try {
      // Try to find product link
      const linkSelectors = [
        'a[href*="/products/"]',
        'a',
        '.product-card__link',
        '[class*="product"][class*="link"]'
      ];

      let clicked = false;
      for (const selector of linkSelectors) {
        try {
          const link = productCard.locator(selector).first();
          if (await link.count() > 0 && await link.isVisible()) {
            await link.click();
            clicked = true;
            break;
          }
        } catch {
          // Try next
        }
      }

      if (!clicked) {
        // Click the card itself
        await productCard.click();
      }

      await this.navigation._waitForPageLoad();
    } catch (err) {
      log('ERROR', `Failed to click product: ${err.message}`);
      return { success: false, status: 'error', message: `Failed to click product: ${err.message}` };
    }

    // Check if sold out
    if (await this._isSoldOut()) {
      log('WARN', 'Product is sold out');
      await captureScreenshot(this.page, 'product-sold-out');
      return { success: false, status: 'out_of_stock', message: 'Product is sold out' };
    }

    // Set quantity (enforces QTY1 configuration)
    if (quantity > 1) {
      await this._setQuantity(quantity);
    }

    // Click Add to Cart and return structured result
    return await this._clickAddToCart();
  }

  /**
   * Check if product is sold out
   * @returns {Promise<boolean>}
   */
  async _isSoldOut() {
    const strategies = [
      () => this.SEL.soldOut(),
      () => this.SEL.soldOutFallback(),
    ];

    for (const strategy of strategies) {
      try {
        const soldOut = strategy();
        if (await soldOut.count() > 0 && await soldOut.first().isVisible()) {
          return true;
        }
      } catch {
        // Continue
      }
    }

    // Check if add to cart button is disabled with sold out text
    try {
      const addBtn = this.SEL.addToCart();
      if (await addBtn.count() > 0) {
        const text = await addBtn.first().textContent();
        if (text && /sold out|out of stock|unavailable/i.test(text)) {
          return true;
        }
      }
    } catch {
      // Continue
    }

    return false;
  }

  /**
   * Set product quantity
   * @param {number} quantity
   */
  async _setQuantity(quantity) {
    log('INFO', `Setting quantity to ${quantity}`);

    // Try direct input first
    const inputStrategies = [
      () => this.SEL.quantityInput(),
      () => this.SEL.quantityInputFallback1(),
      () => this.SEL.quantityInputFallback2(),
      () => this.SEL.quantityInputFallback3(),
    ];

    for (const strategy of inputStrategies) {
      try {
        const input = strategy();
        if (await input.count() > 0) {
          const element = input.first();
          if (await element.isVisible()) {
            await element.clear();
            await element.fill(quantity.toString());
            log('OK', `Set quantity via input to ${quantity}`);
            return;
          }
        }
      } catch {
        // Try next
      }
    }

    // Fallback: click increase button
    log('INFO', 'Using increase button for quantity');
    const increaseStrategies = [
      () => this.SEL.quantityIncrease(),
      () => this.SEL.quantityIncreaseFallback1(),
      () => this.SEL.quantityIncreaseFallback2(),
    ];

    for (const strategy of increaseStrategies) {
      try {
        const btn = strategy();
        if (await btn.count() > 0 && await btn.first().isVisible()) {
          for (let i = 1; i < quantity; i++) {
            await btn.first().click();
            await sleep(200);
          }
          log('OK', `Set quantity via button clicks to ${quantity}`);
          return;
        }
      } catch {
        // Try next
      }
    }

    log('WARN', 'Could not set quantity - using default');
  }

  /**
   * Click Add to Cart button with multiple fallback strategies
   * Supports: Add to Cart, Buy Now, Preorder buttons
   * @returns {Promise<{success: boolean, status: 'success'|'limit_reached'|'out_of_stock'|'error', message: string}>}
   */
  async _clickAddToCart() {
    log('INFO', 'Clicking Add to Cart / Buy / Preorder');

    const strategies = [
      // Primary: Add to Cart buttons
      () => this.SEL.addToCart(),
      () => this.SEL.addToCartFallback1(),
      () => this.SEL.addToCartFallback2(),
      () => this.SEL.addToCartFallback3(),
      () => this.SEL.addToCartFallback4(),
      () => this.SEL.addToCartFallback5(),
      () => this.SEL.addToCartFallback6(),
      () => this.SEL.addToCartFallback7(),
      // Secondary: Buy Now buttons
      () => this.SEL.buyNow(),
      () => this.SEL.buyNowFallback(),
      // Tertiary: Preorder buttons
      () => this.SEL.preorder(),
      () => this.SEL.preorderFallback1(),
      () => this.SEL.preorderFallback2(),
      () => this.SEL.preorderFallback3(),
    ];

    try {
      await clickWithFallback(this.page, strategies, 'Add to Cart', this.config.ACTION_TIMEOUT_MS);
      await sleep(1500);

      // Check for limit/error messages after clicking
      const limitCheck = await this._checkForPurchaseLimit();
      if (limitCheck.limitReached) {
        log('WARN', `Purchase limit detected: ${limitCheck.message}`);
        await captureScreenshot(this.page, 'limit-reached');
        return { success: false, status: 'limit_reached', message: limitCheck.message };
      }

      // Verify item was added (check for confirmation or cart drawer)
      const addedSuccessfully = await this._verifyItemAdded();
      if (addedSuccessfully) {
        log('OK', 'Item successfully added to cart');
        return { success: true, status: 'success', message: 'Item added to cart' };
      }

      // Item may have been added even without confirmation popup
      log('INFO', 'Add to Cart clicked (confirmation not detected, proceeding)');
      return { success: true, status: 'success', message: 'Add to Cart clicked' };

    } catch (err) {
      log('ERROR', `Failed to click Add to Cart: ${err.message}`);
      await captureScreenshot(this.page, 'error-add-to-cart');
      return { success: false, status: 'error', message: err.message };
    }
  }

  /**
   * Check for purchase limit messages after adding to cart
   * @returns {Promise<{limitReached: boolean, message: string}>}
   */
  async _checkForPurchaseLimit() {
    const limitPatterns = [
      /limit(ed)?\s*(to|of|reached|per)/i,
      /maximum\s*(quantity|purchase|allowed)/i,
      /already\s*(purchased|in\s*cart)/i,
      /one\s*per\s*(customer|order|account)/i,
      /cannot\s*add\s*more/i,
      /max\s*quantity/i,
      /per\s*customer/i,
      /per\s*order/i,
    ];

    // Check using selectors
    const limitStrategies = [
      () => this.SEL.purchaseLimitMessage(),
      () => this.SEL.purchaseLimitFallback1(),
      () => this.SEL.purchaseLimitFallback2(),
      () => this.SEL.purchaseLimitFallback3(),
      () => this.SEL.purchaseLimitFallback4(),
      () => this.SEL.quantityLimitMessage(),
      () => this.SEL.quantityLimitFallback1(),
      () => this.SEL.quantityLimitFallback2(),
    ];

    for (const strategy of limitStrategies) {
      try {
        const locator = strategy();
        const count = await locator.count();
        if (count > 0) {
          const element = locator.first();
          if (await element.isVisible()) {
            const text = await element.textContent();
            // Verify it's actually a limit message, not just random text with "limit"
            for (const pattern of limitPatterns) {
              if (pattern.test(text)) {
                return { limitReached: true, message: text.trim().substring(0, 100) };
              }
            }
          }
        }
      } catch {
        // Continue checking
      }
    }

    // Check for error messages with limit text
    try {
      const errorMessages = this.page.locator('[class*="error"], [role="alert"], .notification');
      const count = await errorMessages.count();
      for (let i = 0; i < count; i++) {
        const msg = errorMessages.nth(i);
        if (await msg.isVisible()) {
          const text = await msg.textContent();
          for (const pattern of limitPatterns) {
            if (pattern.test(text)) {
              return { limitReached: true, message: text.trim().substring(0, 100) };
            }
          }
        }
      }
    } catch {
      // Continue
    }

    return { limitReached: false, message: '' };
  }

  /**
   * Verify that item was added to cart (check for confirmation)
   * @returns {Promise<boolean>}
   */
  async _verifyItemAdded() {
    // Check for cart drawer opening
    const drawerStrategies = [
      () => this.SEL.cartDrawer(),
      () => this.SEL.cartDrawerFallback(),
    ];

    for (const strategy of drawerStrategies) {
      try {
        const drawer = strategy();
        if (await drawer.count() > 0 && await drawer.first().isVisible()) {
          log('DEBUG', 'Cart drawer opened - item added');
          return true;
        }
      } catch {
        // Continue
      }
    }

    // Check for confirmation message
    const confirmStrategies = [
      () => this.SEL.addedToCartConfirmation(),
      () => this.SEL.addedToCartFallback1(),
      () => this.SEL.addedToCartFallback2(),
    ];

    for (const strategy of confirmStrategies) {
      try {
        const confirm = strategy();
        if (await confirm.count() > 0 && await confirm.first().isVisible()) {
          log('DEBUG', 'Add to cart confirmation detected');
          return true;
        }
      } catch {
        // Continue
      }
    }

    return false;
  }

  /**
   * Load all products (handle pagination/infinite scroll)
   */
  async _loadAllProducts() {
    log('INFO', 'Loading all products (pagination/scroll)');
    let previousCount = 0;
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      // Get current product count
      const cards = this.SEL.productCard();
      const currentCount = await cards.count().catch(() => 0);

      if (currentCount === previousCount && attempts > 0) {
        log('INFO', `All products loaded: ${currentCount} items`);
        break;
      }
      previousCount = currentCount;

      // Try Load More button
      const loadMoreClicked = await this._clickLoadMore();
      if (!loadMoreClicked) {
        // Try scrolling
        await this._scrollToLoadMore();
      }

      attempts++;
      await sleep(1000);
    }
  }

  /**
   * Click Load More button if present
   * @returns {Promise<boolean>}
   */
  async _clickLoadMore() {
    const strategies = [
      () => this.SEL.loadMoreButton(),
      () => this.SEL.loadMoreFallback1(),
      () => this.SEL.loadMoreFallback2(),
      () => this.SEL.paginationNext(),
      () => this.SEL.paginationNextFallback(),
    ];

    for (const strategy of strategies) {
      try {
        const btn = strategy();
        if (await btn.count() > 0 && await btn.first().isVisible()) {
          await btn.first().click();
          log('DEBUG', 'Clicked load more button');
          return true;
        }
      } catch {
        // Try next
      }
    }

    return false;
  }

  /**
   * Scroll to load more products (infinite scroll)
   */
  async _scrollToLoadMore() {
    try {
      await this.page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await sleep(1500);
    } catch {
      // Continue
    }
  }
}

module.exports = ProductHandler;
