/**
 * Cart Manager - Handles cart operations
 */
const { log, withRetry, captureScreenshot, sleep, clickWithFallback } = require('../util.js');

/**
 * Accept cookie consent to enable checkout functionality
 * @param {import('playwright').Page} page
 */
async function acceptCookies(page) {
  log('DEBUG', 'Checking for cookie consent in cart');

  const acceptSelectors = [
    // Common accept button patterns - prioritize "Accept All" for full functionality
    'button:has-text("Accept All")',
    'button:has-text("Accept Cookies")',
    'button:has-text("Accept")',
    'button:has-text("Allow All")',
    'button:has-text("Allow")',
    'button:has-text("I Accept")',
    'button:has-text("Agree")',
    // OneTrust (common cookie consent provider)
    '#onetrust-accept-btn-handler',
    '.onetrust-accept-btn',
    // CookieBot
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    // Generic patterns
    '[data-testid*="accept"]',
    '[class*="cookie"][class*="accept"]',
    '[class*="consent"][class*="accept"]',
    '[class*="cookie"] button:has-text("Accept")',
    '[role="dialog"] button:has-text("Accept")',
  ];

  for (const selector of acceptSelectors) {
    try {
      const btn = page.locator(selector);
      if (await btn.count() > 0) {
        const element = btn.first();
        if (await element.isVisible()) {
          await element.click();
          log('OK', `Cookies accepted via: ${selector.substring(0, 40)}`);
          await sleep(1000);
          return true;
        }
      }
    } catch {
      // Continue
    }
  }

  log('DEBUG', 'No cookie consent popup found');
  return false;
}

class CartManager {
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
   * Open cart (click cart icon)
   * @returns {Promise<boolean>}
   */
  async openCart() {
    log('INFO', 'Opening cart');

    // First, accept any cookie consent that might be blocking
    await acceptCookies(this.page);

    const strategies = [
      () => this.SEL.cartIcon(),
      () => this.SEL.cartIconFallback1(),
      () => this.SEL.cartIconFallback2(),
      () => this.SEL.cartIconFallback3(),
    ];

    try {
      await clickWithFallback(this.page, strategies, 'Open Cart', this.config.ACTION_TIMEOUT_MS);
      await sleep(1500);

      // Accept cookies again if popup appeared after opening cart
      await acceptCookies(this.page);
      await sleep(500);

      log('OK', 'Cart opened');
      return true;
    } catch (err) {
      log('ERROR', `Failed to open cart: ${err.message}`);
      return false;
    }
  }

  /**
   * Close cart if open
   * @returns {Promise<boolean>}
   */
  async closeIfOpen() {
    // Check if cart drawer is visible
    const drawerStrategies = [
      () => this.SEL.cartDrawer(),
      () => this.SEL.cartDrawerFallback(),
    ];

    let isOpen = false;
    for (const strategy of drawerStrategies) {
      try {
        const drawer = strategy();
        if (await drawer.count() > 0 && await drawer.first().isVisible()) {
          isOpen = true;
          break;
        }
      } catch {
        // Continue
      }
    }

    if (!isOpen) {
      return false;
    }

    log('INFO', 'Closing cart drawer');

    // Try close button
    const closeStrategies = [
      () => this.SEL.cartClose(),
      () => this.SEL.cartCloseFallback1(),
      () => this.SEL.cartCloseFallback2(),
    ];

    for (const strategy of closeStrategies) {
      try {
        const btn = strategy();
        if (await btn.count() > 0 && await btn.first().isVisible()) {
          await btn.first().click();
          await sleep(500);
          log('OK', 'Cart closed');
          return true;
        }
      } catch {
        // Try next
      }
    }

    // Try pressing Escape
    try {
      await this.page.keyboard.press('Escape');
      await sleep(500);
      log('OK', 'Cart closed via Escape');
      return true;
    } catch {
      // Continue
    }

    return false;
  }

  /**
   * Go to cart page (full page, not drawer)
   * @returns {Promise<boolean>}
   */
  async goToCartPage() {
    log('INFO', 'Navigating to cart page');

    // Try direct navigation first
    try {
      await this.page.goto(`${this.config.URL}/cart`, {
        waitUntil: 'domcontentloaded',
        timeout: this.config.NAV_TIMEOUT_MS
      });
      await sleep(1000);
      log('OK', 'Navigated to cart page');
      return true;
    } catch {
      // Continue with click approach
    }

    // Click cart icon
    return await this.openCart();
  }

  /**
   * Check if cart is empty
   * @returns {Promise<boolean>}
   */
  async isEmpty() {
    // Wait for cart to fully load
    await sleep(2000);

    try {
      // First check for cart items - if we find any, cart is definitely not empty
      const items = await this._getCartItems();
      log('DEBUG', `Cart items found via standard selectors: ${items.length}`);

      if (items.length > 0) {
        return false; // Cart has items
      }

      // Check for any product-like elements in cart
      const altItemSelectors = [
        '[class*="cart"] [class*="item"]:not([class*="empty"])',
        '[class*="cart"] [class*="product"]',
        '[class*="cart"] img[src*="product"]',
        '[class*="line-item"]',
        '[class*="cart-line"]',
        '[data-cart-item]',
        '[class*="cart"] [class*="title"]',
        '[class*="cart"] [class*="price"]',
        '[class*="mini-cart"] [class*="item"]',
        '[class*="drawer"] [class*="product"]',
      ];

      for (const selector of altItemSelectors) {
        try {
          const altItems = this.page.locator(selector);
          const count = await altItems.count();
          if (count > 0) {
            const firstVisible = await altItems.first().isVisible().catch(() => false);
            if (firstVisible) {
              log('DEBUG', `Found ${count} items via: ${selector}`);
              return false; // Cart is not empty
            }
          }
        } catch {
          // Continue
        }
      }

      // Only now check for explicit empty cart messages with text content
      const emptyTextPatterns = [
        'Your cart is empty',
        'cart is empty',
        'no items in your cart',
        'no items in cart',
        'Cart is empty',
        'Your bag is empty',
      ];

      for (const text of emptyTextPatterns) {
        try {
          const emptyMsg = this.page.locator(`:text("${text}")`);
          if (await emptyMsg.count() > 0 && await emptyMsg.first().isVisible()) {
            log('DEBUG', `Cart empty confirmed by text: "${text}"`);
            return true;
          }
        } catch {
          // Continue
        }
      }

      // If we couldn't find items but also no empty message, assume not empty
      // (better to try checkout than fail here)
      log('DEBUG', 'Could not definitively determine cart state - proceeding');
      return false;
    } catch (err) {
      log('WARN', `Error checking cart: ${err.message}`);
      // If we can't determine, assume not empty to allow checkout attempt
      return false;
    }
  }

  /**
   * Get cart items
   * @returns {Promise<import('playwright').Locator[]>}
   */
  async _getCartItems() {
    const itemStrategies = [
      () => this.SEL.cartItem(),
      () => this.SEL.cartItemFallback(),
    ];

    for (const strategy of itemStrategies) {
      try {
        const items = strategy();
        const count = await items.count();
        if (count > 0) {
          const result = [];
          for (let i = 0; i < count; i++) {
            result.push(items.nth(i));
          }
          return result;
        }
      } catch {
        // Try next
      }
    }

    return [];
  }

  /**
   * Update quantity for a cart item
   * @param {string} productName - Product name to match
   * @param {number} quantity - New quantity
   * @returns {Promise<boolean>}
   */
  async updateQuantity(productName, quantity) {
    log('INFO', `Updating quantity for "${productName}" to ${quantity}`);

    try {
      // Find cart item by name
      const item = this.SEL.cartItemByName(productName);
      if (await item.count() === 0) {
        log('WARN', `Cart item "${productName}" not found`);
        return false;
      }

      const cartItem = item.first();

      // Find quantity input within cart item
      const inputSelectors = [
        'input[type="number"]',
        'input[name*="quantity"]',
        '.quantity-input input',
        '[class*="quantity"] input'
      ];

      for (const selector of inputSelectors) {
        try {
          const input = cartItem.locator(selector).first();
          if (await input.count() > 0 && await input.isVisible()) {
            await input.clear();
            await input.fill(quantity.toString());
            await input.press('Enter');
            await sleep(500);
            log('OK', `Updated quantity to ${quantity}`);
            return true;
          }
        } catch {
          // Try next
        }
      }

      // Fallback: use +/- buttons
      return await this._adjustQuantityWithButtons(cartItem, quantity);
    } catch (err) {
      log('ERROR', `Failed to update quantity: ${err.message}`);
      return false;
    }
  }

  /**
   * Adjust quantity using +/- buttons
   * @param {import('playwright').Locator} cartItem
   * @param {number} targetQuantity
   * @returns {Promise<boolean>}
   */
  async _adjustQuantityWithButtons(cartItem, targetQuantity) {
    try {
      // Get current quantity
      const input = cartItem.locator('input[type="number"]').first();
      const currentQty = parseInt(await input.inputValue(), 10) || 1;

      if (currentQty === targetQuantity) {
        return true;
      }

      const diff = targetQuantity - currentQty;
      const isIncrease = diff > 0;
      const clicks = Math.abs(diff);

      const buttonSelector = isIncrease
        ? '[aria-label*="increase" i], .quantity-plus, .qty-plus, button:has-text("+")'
        : '[aria-label*="decrease" i], .quantity-minus, .qty-minus, button:has-text("-")';

      const button = cartItem.locator(buttonSelector).first();
      if (await button.count() === 0) {
        log('WARN', 'Quantity buttons not found');
        return false;
      }

      for (let i = 0; i < clicks; i++) {
        await button.click();
        await sleep(300);
      }

      log('OK', `Adjusted quantity by ${diff} clicks`);
      return true;
    } catch (err) {
      log('ERROR', `Failed to adjust quantity with buttons: ${err.message}`);
      return false;
    }
  }

  /**
   * Remove item from cart
   * @param {string} productName - Product name to remove
   * @returns {Promise<boolean>}
   */
  async removeItem(productName) {
    log('INFO', `Removing "${productName}" from cart`);

    try {
      const item = this.SEL.cartItemByName(productName);
      if (await item.count() === 0) {
        log('WARN', `Cart item "${productName}" not found`);
        return false;
      }

      const cartItem = item.first();
      const removeSelectors = [
        '[aria-label*="remove" i]',
        '.remove-item',
        '.cart-remove',
        'button:has-text("Remove")',
        '.delete-item'
      ];

      for (const selector of removeSelectors) {
        try {
          const btn = cartItem.locator(selector).first();
          if (await btn.count() > 0 && await btn.isVisible()) {
            await btn.click();
            await sleep(500);
            log('OK', `Removed "${productName}" from cart`);
            return true;
          }
        } catch {
          // Try next
        }
      }

      log('WARN', 'Remove button not found');
      return false;
    } catch (err) {
      log('ERROR', `Failed to remove item: ${err.message}`);
      return false;
    }
  }

  /**
   * Proceed to checkout
   * @returns {Promise<boolean>}
   */
  async proceedToCheckout() {
    log('INFO', 'Proceeding to checkout');

    // Ensure cookies are accepted (required for checkout button to work)
    await acceptCookies(this.page);
    await sleep(500);

    const strategies = [
      () => this.SEL.checkoutButton(),
      () => this.SEL.checkoutButtonFallback1(),
      () => this.SEL.checkoutButtonFallback2(),
      () => this.SEL.checkoutButtonFallback3(),
      () => this.SEL.checkoutButtonFallback4(),
      () => this.SEL.checkoutButtonFallback5(),
    ];

    try {
      await clickWithFallback(this.page, strategies, 'Checkout', this.config.ACTION_TIMEOUT_MS);

      // Wait for checkout page
      await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await sleep(1000);

      log('OK', 'Proceeded to checkout');
      return true;
    } catch (err) {
      log('ERROR', `Failed to proceed to checkout: ${err.message}`);
      await captureScreenshot(this.page, 'error-checkout-button');
      return false;
    }
  }

  /**
   * Get cart info (for logging)
   * @returns {Promise<{itemCount: number, isEmpty: boolean}>}
   */
  async getCartInfo() {
    const items = await this._getCartItems();
    return {
      itemCount: items.length,
      isEmpty: items.length === 0
    };
  }

  /**
   * Clear all items from cart
   * Used between accounts to ensure clean state
   * @returns {Promise<boolean>}
   */
  async clearCart() {
    log('INFO', 'Clearing cart...');

    try {
      // First, open cart to see items
      await this.openCart();
      await sleep(1000);

      // Check if already empty
      if (await this.isEmpty()) {
        log('DEBUG', 'Cart already empty');
        await this.closeIfOpen();
        return true;
      }

      // Get all cart items and remove them one by one
      let attempts = 0;
      const maxAttempts = 10;

      while (attempts < maxAttempts) {
        const items = await this._getCartItems();
        if (items.length === 0) {
          log('OK', 'Cart cleared');
          await this.closeIfOpen();
          return true;
        }

        // Try to remove first item
        const removeStrategies = [
          // Within cart item
          () => this.page.locator('.cart-item, .cart-product, .line-item').first().locator('[aria-label*="remove" i], .remove-item, button:has-text("Remove")'),
          // Global remove buttons
          () => this.SEL.cartRemove(),
          () => this.SEL.cartRemoveFallback(),
          // Clear cart button
          () => this.page.locator('button:has-text("Clear Cart"), button:has-text("Empty Cart")'),
          () => this.page.locator('[aria-label*="clear cart" i], [aria-label*="empty cart" i]'),
        ];

        let removed = false;
        for (const strategy of removeStrategies) {
          try {
            const btn = strategy();
            if (await btn.count() > 0 && await btn.first().isVisible()) {
              await btn.first().click();
              await sleep(1000);
              removed = true;
              break;
            }
          } catch {
            // Try next strategy
          }
        }

        if (!removed) {
          // Try setting quantity to 0 or using decrease buttons
          try {
            const qtyInput = this.page.locator('.cart-item input[type="number"], .line-item input[type="number"]').first();
            if (await qtyInput.count() > 0 && await qtyInput.isVisible()) {
              await qtyInput.fill('0');
              await qtyInput.press('Enter');
              await sleep(1000);
              removed = true;
            }
          } catch {
            // Continue
          }
        }

        if (!removed) {
          log('WARN', 'Could not remove cart item');
          break;
        }

        attempts++;
      }

      // Final check
      const isEmpty = await this.isEmpty();
      await this.closeIfOpen();
      return isEmpty;

    } catch (err) {
      log('ERROR', `Failed to clear cart: ${err.message}`);
      await this.closeIfOpen();
      return false;
    }
  }
}

module.exports = CartManager;
