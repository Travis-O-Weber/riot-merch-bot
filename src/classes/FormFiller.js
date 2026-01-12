/**
 * Form Filler - Master coordinator for checkout form filling
 */
const { log, fillIfNotEmpty, sleep, captureScreenshot, maskSensitive } = require('../util.js');

class FormFiller {
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
   * Fill contact form (email, phone)
   */
  async fillContactForm() {
    const { email, phone } = this.config.CHECKOUT;

    // Email
    await this._fillField(
      [
        () => this.SEL.emailInput(),
        () => this.SEL.emailInputFallback1(),
        () => this.SEL.emailInputFallback2(),
        () => this.SEL.emailInputFallback3(),
        () => this.SEL.emailInputFallback4(),
      ],
      email,
      'Email'
    );

    // Phone
    await this._fillField(
      [
        () => this.SEL.phoneInput(),
        () => this.SEL.phoneInputFallback1(),
        () => this.SEL.phoneInputFallback2(),
        () => this.SEL.phoneInputFallback3(),
      ],
      phone,
      'Phone'
    );
  }

  /**
   * Fill shipping address form
   */
  async fillShippingForm() {
    const { firstName, lastName, address1, address2, city, state, zip, country } = this.config.CHECKOUT;

    // First Name
    await this._fillField(
      [
        () => this.SEL.firstNameInput(),
        () => this.SEL.firstNameFallback1(),
        () => this.SEL.firstNameFallback2(),
        () => this.SEL.firstNameFallback3(),
      ],
      firstName,
      'First Name'
    );

    // Last Name
    await this._fillField(
      [
        () => this.SEL.lastNameInput(),
        () => this.SEL.lastNameFallback1(),
        () => this.SEL.lastNameFallback2(),
        () => this.SEL.lastNameFallback3(),
      ],
      lastName,
      'Last Name'
    );

    // Address Line 1
    await this._fillField(
      [
        () => this.SEL.address1Input(),
        () => this.SEL.address1Fallback1(),
        () => this.SEL.address1Fallback2(),
        () => this.SEL.address1Fallback3(),
      ],
      address1,
      'Address Line 1'
    );

    // Address Line 2
    await this._fillField(
      [
        () => this.SEL.address2Input(),
        () => this.SEL.address2Fallback1(),
        () => this.SEL.address2Fallback2(),
        () => this.SEL.address2Fallback3(),
      ],
      address2,
      'Address Line 2'
    );

    // City
    await this._fillField(
      [
        () => this.SEL.cityInput(),
        () => this.SEL.cityFallback1(),
        () => this.SEL.cityFallback2(),
        () => this.SEL.cityFallback3(),
      ],
      city,
      'City'
    );

    // State/Province (select or input)
    if (state) {
      await this._fillSelectOrInput(
        [
          () => this.SEL.stateSelect(),
          () => this.SEL.stateSelectFallback1(),
          () => this.SEL.stateSelectFallback2(),
          () => this.SEL.stateSelectFallback3(),
        ],
        [
          () => this.SEL.stateInput(),
        ],
        state,
        'State'
      );
    }

    // ZIP/Postal Code
    await this._fillField(
      [
        () => this.SEL.zipInput(),
        () => this.SEL.zipFallback1(),
        () => this.SEL.zipFallback2(),
        () => this.SEL.zipFallback3(),
      ],
      zip,
      'ZIP Code'
    );

    // Country (select)
    if (country) {
      await this._fillSelect(
        [
          () => this.SEL.countrySelect(),
          () => this.SEL.countrySelectFallback1(),
          () => this.SEL.countrySelectFallback2(),
          () => this.SEL.countrySelectFallback3(),
        ],
        country,
        'Country'
      );
    }
  }

  /**
   * Fill payment form
   */
  async fillPaymentForm() {
    const { cardNumber, cardExpMonth, cardExpYear, cardCvv } = this.config.PAYMENT;

    // Check if any payment info is provided
    if (!cardNumber && !cardExpMonth && !cardCvv) {
      log('INFO', 'No payment info provided - skipping payment form');
      return;
    }

    log('INFO', 'Filling payment form');

    // Try to find payment iframe first (for Stripe/similar)
    const iframe = await this._findPaymentIframe();

    if (iframe) {
      log('DEBUG', 'Found payment iframe - filling within iframe');
      await this._fillPaymentInIframe(iframe, cardNumber, cardExpMonth, cardExpYear, cardCvv);
    } else {
      log('DEBUG', 'No payment iframe - filling on main page');
      await this._fillPaymentOnPage(cardNumber, cardExpMonth, cardExpYear, cardCvv);
    }
  }

  /**
   * Apply discount code
   * @param {string} code - Discount code
   */
  async applyDiscountCode(code) {
    if (!code || code.trim() === '') {
      log('DEBUG', 'No discount code provided - skipping');
      return;
    }

    log('INFO', `Applying discount code: ${code}`);

    // First, try to find and click discount toggle/expand
    await this._expandDiscountSection();

    // Find discount input
    const inputStrategies = [
      () => this.SEL.discountInput(),
      () => this.SEL.discountInputFallback1(),
      () => this.SEL.discountInputFallback2(),
      () => this.SEL.discountInputFallback3(),
      () => this.SEL.discountInputFallback4(),
      () => this.SEL.discountInputFallback5(),
    ];

    let input = null;
    for (const strategy of inputStrategies) {
      try {
        const locator = strategy();
        if (await locator.count() > 0 && await locator.first().isVisible()) {
          input = locator.first();
          break;
        }
      } catch {
        // Try next
      }
    }

    if (!input) {
      log('WARN', 'Discount code input not found');
      return;
    }

    try {
      // Check if already has a value
      const currentValue = await input.inputValue().catch(() => '');
      if (currentValue && currentValue.trim() !== '') {
        log('DEBUG', 'Discount field already has value - skipping');
        return;
      }

      // Fill the discount code
      await input.fill(code);
      await sleep(300);

      // Click apply button or press Enter
      const applied = await this._clickApplyDiscount();
      if (!applied) {
        await input.press('Enter');
      }

      await sleep(1000);
      log('OK', `Discount code "${code}" applied`);
    } catch (err) {
      log('WARN', `Failed to apply discount code: ${err.message}`);
    }
  }

  /**
   * Fill a field using multiple selector strategies
   * @param {Array<() => import('playwright').Locator>} strategies
   * @param {string} value
   * @param {string} fieldName
   */
  async _fillField(strategies, value, fieldName) {
    if (!value || value.trim() === '') {
      log('DEBUG', `Skipping ${fieldName} - no value provided`);
      return;
    }

    for (const strategy of strategies) {
      try {
        const locator = strategy();
        if (await locator.count() > 0) {
          const element = locator.first();
          if (await element.isVisible()) {
            // Check if field already has value
            const currentValue = await element.inputValue().catch(() => '');
            if (currentValue && currentValue.trim() !== '') {
              log('DEBUG', `Skipping ${fieldName} - already has value`);
              return;
            }

            await element.fill(value);
            log('OK', `Filled ${fieldName}`);
            return;
          }
        }
      } catch {
        // Try next strategy
      }
    }

    log('WARN', `${fieldName} field not found`);
  }

  /**
   * Fill a select element
   * @param {Array<() => import('playwright').Locator>} strategies
   * @param {string} value
   * @param {string} fieldName
   */
  async _fillSelect(strategies, value, fieldName) {
    if (!value || value.trim() === '') {
      log('DEBUG', `Skipping ${fieldName} - no value provided`);
      return;
    }

    for (const strategy of strategies) {
      try {
        const locator = strategy();
        if (await locator.count() > 0) {
          const element = locator.first();
          if (await element.isVisible()) {
            // Try to select by visible text first, then by value
            try {
              await element.selectOption({ label: value });
            } catch {
              try {
                await element.selectOption({ value: value });
              } catch {
                // Try partial match
                await element.selectOption({ label: new RegExp(value, 'i') });
              }
            }
            log('OK', `Selected ${fieldName}: ${value}`);
            return;
          }
        }
      } catch {
        // Try next strategy
      }
    }

    log('WARN', `${fieldName} select not found`);
  }

  /**
   * Fill either select or input field
   */
  async _fillSelectOrInput(selectStrategies, inputStrategies, value, fieldName) {
    // Try select first
    for (const strategy of selectStrategies) {
      try {
        const locator = strategy();
        if (await locator.count() > 0 && await locator.first().isVisible()) {
          await this._fillSelect(selectStrategies, value, fieldName);
          return;
        }
      } catch {
        // Continue
      }
    }

    // Fallback to input
    await this._fillField(inputStrategies, value, fieldName);
  }

  /**
   * Find payment iframe
   * @returns {Promise<import('playwright').FrameLocator|null>}
   */
  async _findPaymentIframe() {
    const iframeSelectors = [
      'iframe[name*="card"]',
      'iframe[src*="stripe"]',
      'iframe[title*="payment" i]',
      'iframe[title*="card" i]',
      'iframe[name*="__privateStripeFrame"]',
      'iframe[src*="checkout"]',
    ];

    for (const selector of iframeSelectors) {
      try {
        const iframe = this.page.locator(selector);
        if (await iframe.count() > 0) {
          return this.page.frameLocator(selector);
        }
      } catch {
        // Try next
      }
    }

    return null;
  }

  /**
   * Fill payment info within iframe
   */
  async _fillPaymentInIframe(iframe, cardNumber, expMonth, expYear, cvv) {
    // Card number
    if (cardNumber) {
      try {
        const cardInput = iframe.locator('input[name="cardnumber"], input[name="number"], input[placeholder*="card" i]').first();
        await cardInput.fill(cardNumber);
        log('OK', `Filled card number (masked): ${maskSensitive(cardNumber)}`);
      } catch (err) {
        log('WARN', `Failed to fill card number in iframe: ${err.message}`);
      }
    }

    // Expiry
    if (expMonth && expYear) {
      try {
        // Try combined expiry field
        const expiryInput = iframe.locator('input[name="exp-date"], input[name="expiry"], input[placeholder*="MM" i]').first();
        const expiry = `${expMonth}/${expYear.slice(-2)}`;
        await expiryInput.fill(expiry);
        log('OK', 'Filled expiry date');
      } catch {
        // Try separate month/year fields
        try {
          const monthInput = iframe.locator('input[name*="month"], select[name*="month"]').first();
          const yearInput = iframe.locator('input[name*="year"], select[name*="year"]').first();
          await monthInput.fill(expMonth);
          await yearInput.fill(expYear);
          log('OK', 'Filled expiry (separate fields)');
        } catch (err) {
          log('WARN', `Failed to fill expiry in iframe: ${err.message}`);
        }
      }
    }

    // CVV
    if (cvv) {
      try {
        const cvvInput = iframe.locator('input[name="cvc"], input[name="cvv"], input[placeholder*="CVC" i], input[placeholder*="CVV" i]').first();
        await cvvInput.fill(cvv);
        log('OK', 'Filled CVV (masked): ***');
      } catch (err) {
        log('WARN', `Failed to fill CVV in iframe: ${err.message}`);
      }
    }
  }

  /**
   * Fill payment info on main page
   */
  async _fillPaymentOnPage(cardNumber, expMonth, expYear, cvv) {
    // Card number
    await this._fillField(
      [
        () => this.SEL.cardNumberInput(),
        () => this.SEL.cardNumberFallback1(),
        () => this.SEL.cardNumberFallback2(),
        () => this.SEL.cardNumberFallback3(),
      ],
      cardNumber,
      'Card Number'
    );

    // Expiry (try combined first, then separate)
    if (expMonth && expYear) {
      const combinedExpiry = `${expMonth}/${expYear.slice(-2)}`;
      const filledCombined = await this._tryFillField(
        [
          () => this.SEL.cardExpiryInput(),
          () => this.SEL.cardExpiryFallback1(),
          () => this.SEL.cardExpiryFallback2(),
        ],
        combinedExpiry,
        'Expiry'
      );

      if (!filledCombined) {
        // Try separate fields
        await this._fillSelect(
          [() => this.SEL.cardExpMonthSelect()],
          expMonth,
          'Expiry Month'
        );
        await this._fillSelect(
          [() => this.SEL.cardExpYearSelect()],
          expYear,
          'Expiry Year'
        );
      }
    }

    // CVV
    await this._fillField(
      [
        () => this.SEL.cardCvvInput(),
        () => this.SEL.cardCvvFallback1(),
        () => this.SEL.cardCvvFallback2(),
      ],
      cvv,
      'CVV'
    );
  }

  /**
   * Try to fill field, return success status
   */
  async _tryFillField(strategies, value, fieldName) {
    if (!value) return false;

    for (const strategy of strategies) {
      try {
        const locator = strategy();
        if (await locator.count() > 0 && await locator.first().isVisible()) {
          await locator.first().fill(value);
          log('OK', `Filled ${fieldName}`);
          return true;
        }
      } catch {
        // Try next
      }
    }
    return false;
  }

  /**
   * Expand discount code section if collapsed
   */
  async _expandDiscountSection() {
    const toggleStrategies = [
      () => this.SEL.discountToggle(),
      () => this.SEL.discountToggleFallback(),
      () => this.page.locator('summary:has-text("discount"), summary:has-text("promo")'),
      () => this.page.locator('[class*="discount"][class*="toggle"], [class*="promo"][class*="toggle"]'),
    ];

    for (const strategy of toggleStrategies) {
      try {
        const toggle = strategy();
        if (await toggle.count() > 0 && await toggle.first().isVisible()) {
          await toggle.first().click();
          await sleep(500);
          return;
        }
      } catch {
        // Try next
      }
    }
  }

  /**
   * Click apply discount button
   * @returns {Promise<boolean>}
   */
  async _clickApplyDiscount() {
    const strategies = [
      () => this.SEL.discountApplyButton(),
      () => this.SEL.discountApplyFallback1(),
      () => this.SEL.discountApplyFallback2(),
    ];

    for (const strategy of strategies) {
      try {
        const btn = strategy();
        if (await btn.count() > 0 && await btn.first().isVisible()) {
          await btn.first().click();
          return true;
        }
      } catch {
        // Try next
      }
    }

    return false;
  }
}

module.exports = FormFiller;
