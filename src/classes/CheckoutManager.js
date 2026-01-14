/**
 * Checkout Manager - Orchestrates the checkout flow
 */
const { log, withRetry, captureScreenshot, captureFailure, sleep } = require('../util.js');
const FormFiller = require('./FormFiller.js');

class CheckoutManager {
  /**
   * @param {import('playwright').Page} page
   * @param {Object} SEL - Selectors object
   * @param {Object} config - Configuration
   * @param {Object} cartManager - Cart operations
   */
  constructor(page, SEL, config, cartManager) {
    this.page = page;
    this.SEL = SEL;
    this.config = config;
    this.cart = cartManager;
    this.formFiller = new FormFiller(page, SEL, config);
  }

  /**
   * Execute full checkout flow
   * @returns {Promise<boolean>}
   */
  async performCheckout() {
    if (!this.config.CHECKOUT_ENABLED) {
      log('INFO', 'Checkout disabled - stopping at cart');
      return false;
    }

    log('INFO', '=== Starting Checkout Flow ===');

    try {
      // Step 1: Open cart and proceed to checkout
      const cartOpened = await this.cart.openCart();
      if (!cartOpened) {
        await this.cart.goToCartPage();
      }

      // Check if cart is empty
      if (await this.cart.isEmpty()) {
        log('WARN', 'Cart is empty - cannot proceed to checkout');
        return false;
      }

      // Proceed to checkout
      const checkoutStarted = await this.cart.proceedToCheckout();
      if (!checkoutStarted) {
        log('ERROR', 'Failed to start checkout');
        return false;
      }

      await captureScreenshot(this.page, 'checkout-started');

      // Step 2: Fill contact/shipping information
      await this._fillContactInfo();
      await this._fillShippingInfo();

      // Step 3: Continue to shipping method selection
      await this._continueToShipping();

      // Step 4: Continue to payment
      await this._continueToPayment();

      // Step 5: Apply discount code if provided
      if (this.config.DISCOUNT_CODE) {
        await this._applyDiscountCode();
      }

      // Step 6: Fill payment information
      await this._fillPaymentInfo();

      // Step 7: Review and place order
      return await this._reviewAndPlaceOrder();

    } catch (err) {
      await captureFailure(this.page, 'checkout', err);
      return false;
    }
  }

  /**
   * Fill contact information
   */
  async _fillContactInfo() {
    log('INFO', 'Step: Filling contact information');
    await this.formFiller.fillContactForm();
    await sleep(500);
  }

  /**
   * Fill shipping information
   */
  async _fillShippingInfo() {
    log('INFO', 'Step: Filling shipping information');
    await this.formFiller.fillShippingForm();
    await sleep(500);
  }

  /**
   * Continue to shipping method
   */
  async _continueToShipping() {
    log('INFO', 'Step: Continue to shipping');

    const strategies = [
      () => this.SEL.continueToShipping(),
      () => this.SEL.continueToShippingFallback1(),
      () => this.SEL.continueToShippingFallback2(),
      () => this.page.getByRole('button', { name: /continue/i }),
      () => this.page.locator('button[type="submit"]'),
    ];

    for (const strategy of strategies) {
      try {
        const btn = strategy();
        if (await btn.count() > 0) {
          const element = btn.first();
          if (await element.isVisible() && await element.isEnabled()) {
            await element.click();
            await this._waitForPageTransition();
            log('OK', 'Continued to shipping');
            return;
          }
        }
      } catch {
        // Try next
      }
    }

    log('WARN', 'Continue to shipping button not found - may already be on next step');
  }

  /**
   * Continue to payment
   */
  async _continueToPayment() {
    log('INFO', 'Step: Continue to payment');

    const strategies = [
      () => this.SEL.continueToPayment(),
      () => this.SEL.continueToPaymentFallback1(),
      () => this.SEL.continueToPaymentFallback2(),
      () => this.page.getByRole('button', { name: /continue/i }),
      () => this.page.locator('button[type="submit"]'),
    ];

    for (const strategy of strategies) {
      try {
        const btn = strategy();
        if (await btn.count() > 0) {
          const element = btn.first();
          if (await element.isVisible() && await element.isEnabled()) {
            await element.click();
            await this._waitForPageTransition();
            log('OK', 'Continued to payment');
            return;
          }
        }
      } catch {
        // Try next
      }
    }

    log('WARN', 'Continue to payment button not found - may already be on next step');
  }

  /**
   * Apply discount code
   */
  async _applyDiscountCode() {
    log('INFO', `Step: Applying discount code: ${this.config.DISCOUNT_CODE}`);
    await this.formFiller.applyDiscountCode(this.config.DISCOUNT_CODE);
  }

  /**
   * Fill payment information
   */
  async _fillPaymentInfo() {
    log('INFO', 'Step: Filling payment information');
    await this.formFiller.fillPaymentForm();
    await sleep(500);
  }

  /**
   * Review order and place it (or stop before)
   * @returns {Promise<boolean>}
   */
  async _reviewAndPlaceOrder() {
    log('INFO', 'Step: Review order');
    await captureScreenshot(this.page, 'order-review');

    if (!this.config.FULL_SEND) {
      log('INFO', '=== SAFE_STOP_BEFORE_PURCHASE ===');
      log('INFO', 'FULL_SEND is disabled (FULL_SEND=0) - bot has stopped at final review page');
      log('INFO', 'Order NOT placed. Review the order and submit manually if desired.');
      log('INFO', 'To enable automatic order placement, set FULL_SEND=1 in your .env file');
      await captureScreenshot(this.page, 'safe-stop-final-review');
      return true;
    }

    // FULL_SEND mode - actually place the order
    log('WARN', '=== FULL_SEND MODE - PLACING ORDER ===');

    const strategies = [
      () => this.SEL.placeOrderButton(),
      () => this.SEL.placeOrderFallback1(),
      () => this.SEL.placeOrderFallback2(),
      () => this.SEL.placeOrderFallback3(),
      () => this.SEL.placeOrderFallback4(),
      () => this.SEL.placeOrderFallback5(),
    ];

    for (const strategy of strategies) {
      try {
        const btn = strategy();
        if (await btn.count() > 0) {
          const element = btn.first();
          if (await element.isVisible() && await element.isEnabled()) {
            await element.click();
            await this._waitForOrderConfirmation();
            log('OK', '=== ORDER PLACED SUCCESSFULLY ===');
            await captureScreenshot(this.page, 'order-confirmation');
            return true;
          }
        }
      } catch {
        // Try next
      }
    }

    log('ERROR', 'Place order button not found');
    await captureScreenshot(this.page, 'error-place-order');
    return false;
  }

  /**
   * Wait for page transition during checkout
   */
  async _waitForPageTransition() {
    try {
      await this.page.waitForLoadState('networkidle', { timeout: 15000 });
    } catch {
      // Continue
    }
    await sleep(1000);
  }

  /**
   * Wait for order confirmation
   */
  async _waitForOrderConfirmation() {
    try {
      // Wait for confirmation page elements
      const confirmationStrategies = [
        () => this.SEL.orderConfirmation(),
        () => this.SEL.orderConfirmationFallback(),
      ];

      for (const strategy of confirmationStrategies) {
        try {
          const confirmation = strategy();
          await confirmation.first().waitFor({ state: 'visible', timeout: 30000 });
          return;
        } catch {
          // Try next
        }
      }

      // Fallback: wait for URL change or title change
      await this.page.waitForLoadState('networkidle', { timeout: 30000 });
    } catch (err) {
      log('WARN', `Order confirmation detection uncertain: ${err.message}`);
    }
    await sleep(2000);
  }
}

module.exports = CheckoutManager;
