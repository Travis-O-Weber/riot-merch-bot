/**
 * Centralized selector definitions for Riot Merch Bot
 * Multi-tier fallback approach for self-healing
 */

/**
 * Get all selectors bound to a page
 * @param {import('playwright').Page} page
 */
function getSelectors(page) {
  return {
    // ==========================================
    // SEARCH & NAVIGATION
    // ==========================================

    // Search input - multiple strategies
    searchInput: () => page.getByRole('searchbox'),
    searchInputFallback1: () => page.locator('input[type="search"]'),
    searchInputFallback2: () => page.locator('input[placeholder*="search" i]'),
    searchInputFallback3: () => page.locator('input[name*="search" i]'),
    searchInputFallback4: () => page.locator('[data-testid*="search"] input'),
    searchInputFallback5: () => page.locator('.search-input, .search-field, #search'),

    // Search button
    searchButton: () => page.getByRole('button', { name: /search/i }),
    searchButtonFallback1: () => page.locator('button[type="submit"][aria-label*="search" i]'),
    searchButtonFallback2: () => page.locator('.search-button, .search-submit'),
    searchButtonFallback3: () => page.locator('button:has(svg), button:has(.icon-search)'),

    // Search icon/trigger to open search
    searchTrigger: () => page.getByRole('button', { name: /search/i }),
    searchTriggerFallback1: () => page.locator('[aria-label*="search" i]'),
    searchTriggerFallback2: () => page.locator('.search-icon, .icon-search, [class*="search"][class*="icon"]'),
    searchTriggerFallback3: () => page.locator('a[href*="search"], button[data-action*="search"]'),

    // Navigation links
    navShop: () => page.getByRole('link', { name: /shop/i }),
    navShopFallback1: () => page.locator('a[href*="/collections"], a[href*="/products"]'),
    navShopFallback2: () => page.locator('nav a:has-text("Shop"), header a:has-text("Shop")'),
    navAllProducts: () => page.getByRole('link', { name: /all products|view all|shop all/i }),

    // ==========================================
    // PRODUCT LISTING
    // ==========================================

    // Product grid/container
    productGrid: () => page.locator('.product-grid, .products-grid, .collection-products, [class*="product-list"]'),
    productGridFallback: () => page.locator('[data-testid*="product"], main [class*="grid"]'),

    // Individual product cards
    productCard: () => page.locator('.product-card, .product-item, .product-tile, [class*="product-card"]'),
    productCardFallback1: () => page.locator('[data-testid="product-card"], [data-product-id]'),
    productCardFallback2: () => page.locator('article[class*="product"], div[class*="product"][class*="card"]'),
    productCardFallback3: () => page.locator('.grid-item, .collection-item'),

    // Product card by text match
    productCardByText: (name) => page.locator('.product-card, .product-item, .product-tile, [class*="product-card"], [data-testid="product-card"]').filter({ hasText: new RegExp(name, 'i') }),

    // Product title within card
    productTitle: () => page.locator('.product-card__title, .product-title, .product-name, [class*="product"][class*="title"]'),
    productTitleFallback: () => page.locator('h2, h3, h4').filter({ hasText: /.+/ }),

    // Product link
    productLink: () => page.locator('.product-card a, .product-item a, a[href*="/products/"]'),

    // Load more / pagination
    loadMoreButton: () => page.getByRole('button', { name: /load more|show more|view more/i }),
    loadMoreFallback1: () => page.locator('button:has-text("Load More"), button:has-text("Show More")'),
    loadMoreFallback2: () => page.locator('.load-more, .show-more, [class*="load-more"]'),
    paginationNext: () => page.getByRole('link', { name: /next/i }),
    paginationNextFallback: () => page.locator('.pagination-next, .next-page, a[rel="next"]'),

    // ==========================================
    // PRODUCT PAGE
    // ==========================================

    // Quantity selector
    quantityInput: () => page.getByRole('spinbutton', { name: /quantity/i }),
    quantityInputFallback1: () => page.locator('input[name="quantity"], input[type="number"][name*="qty"]'),
    quantityInputFallback2: () => page.locator('.quantity-input, .qty-input, [class*="quantity"] input'),
    quantityInputFallback3: () => page.locator('input[id*="quantity"], input[data-quantity]'),

    // Quantity increase/decrease buttons
    quantityIncrease: () => page.getByRole('button', { name: /increase|plus|\+/i }),
    quantityIncreaseFallback1: () => page.locator('button[aria-label*="increase" i], button[aria-label*="add" i]'),
    quantityIncreaseFallback2: () => page.locator('.quantity-plus, .qty-plus, .increase-qty, [class*="plus"]'),
    quantityDecrease: () => page.getByRole('button', { name: /decrease|minus|-/i }),
    quantityDecreaseFallback: () => page.locator('.quantity-minus, .qty-minus, .decrease-qty, [class*="minus"]'),

    // Add to Cart button - extensive fallbacks
    addToCart: () => page.getByRole('button', { name: /add to cart|add to bag/i }),
    addToCartFallback1: () => page.locator('button[type="submit"]:has-text("Add")'),
    addToCartFallback2: () => page.locator('button:has-text("Add to Cart"), button:has-text("Add to Bag")'),
    addToCartFallback3: () => page.locator('.add-to-cart, .addtocart, [class*="add-to-cart"], [class*="addToCart"]'),
    addToCartFallback4: () => page.locator('button[name="add"], button[data-action="add-to-cart"]'),
    addToCartFallback5: () => page.locator('[data-testid*="add-to-cart"], [data-testid*="addToCart"]'),
    addToCartFallback6: () => page.locator('form[action*="/cart/add"] button[type="submit"]'),
    addToCartFallback7: () => page.locator('#AddToCart, #add-to-cart'),

    // Buy Now button
    buyNow: () => page.getByRole('button', { name: /buy now|buy it now/i }),
    buyNowFallback: () => page.locator('.buy-now, .buy-it-now, button:has-text("Buy Now")'),

    // Preorder button
    preorder: () => page.getByRole('button', { name: /pre-order|preorder/i }),
    preorderFallback1: () => page.locator('button:has-text("Pre-Order"), button:has-text("Preorder")'),
    preorderFallback2: () => page.locator('.preorder, .pre-order, [class*="preorder"], [class*="pre-order"]'),
    preorderFallback3: () => page.locator('[data-testid*="preorder"], [data-action*="preorder"]'),

    // Sold out indicator
    soldOut: () => page.locator('.sold-out, .out-of-stock, [class*="sold-out"], button:has-text("Sold Out")'),
    soldOutFallback: () => page.locator('button[disabled]:has-text("Out of Stock"), .unavailable'),

    // ==========================================
    // CART
    // ==========================================

    // Cart icon/link
    cartIcon: () => page.getByRole('link', { name: /cart|bag/i }),
    cartIconFallback1: () => page.locator('[aria-label*="cart" i], [aria-label*="bag" i]'),
    cartIconFallback2: () => page.locator('a[href*="/cart"], .cart-icon, .cart-link, [class*="cart-icon"]'),
    cartIconFallback3: () => page.locator('header [class*="cart"], nav [class*="cart"]'),

    // Cart drawer/modal
    cartDrawer: () => page.locator('.cart-drawer, .cart-sidebar, .mini-cart, [class*="cart-drawer"]'),
    cartDrawerFallback: () => page.locator('[role="dialog"]:has-text("Cart"), [class*="drawer"]:has-text("Cart")'),

    // Cart items
    cartItem: () => page.locator('.cart-item, .cart-product, .line-item, [class*="cart-item"]'),
    cartItemFallback: () => page.locator('[data-testid*="cart-item"], .cart-drawer__item'),
    cartItemByName: (name) => page.locator('.cart-item, .cart-product, .line-item').filter({ hasText: new RegExp(name, 'i') }),

    // Cart quantity input
    cartQuantityInput: () => page.locator('.cart-item input[type="number"], .line-item input[name*="quantity"]'),
    cartQuantityInputFallback: () => page.locator('.cart-quantity input, [class*="cart"] input[type="number"]'),

    // Remove from cart
    cartRemove: () => page.getByRole('button', { name: /remove/i }),
    cartRemoveFallback: () => page.locator('.cart-remove, .remove-item, button[aria-label*="remove" i]'),

    // Cart empty message
    cartEmpty: () => page.locator('.cart-empty, .empty-cart, :text("cart is empty")'),

    // Cart total
    cartTotal: () => page.locator('.cart-total, .cart-subtotal, [class*="cart-total"]'),

    // Cart close button
    cartClose: () => page.getByRole('button', { name: /close/i }),
    cartCloseFallback1: () => page.locator('.cart-drawer__close, .drawer__close, .close-drawer'),
    cartCloseFallback2: () => page.locator('[aria-label*="close" i], .drawer__overlay'),

    // ==========================================
    // CHECKOUT TRIGGER
    // ==========================================

    // Checkout button
    checkoutButton: () => page.getByRole('button', { name: /checkout|check out/i }),
    checkoutButtonFallback1: () => page.getByRole('link', { name: /checkout|check out/i }),
    checkoutButtonFallback2: () => page.locator('button:has-text("Checkout"), a:has-text("Checkout")'),
    checkoutButtonFallback3: () => page.locator('.checkout-button, .btn-checkout, [class*="checkout"][class*="btn"]'),
    checkoutButtonFallback4: () => page.locator('a[href*="/checkout"], button[data-action="checkout"]'),
    checkoutButtonFallback5: () => page.locator('[data-testid*="checkout"], #checkout'),

    // ==========================================
    // CHECKOUT FORM - CONTACT
    // ==========================================

    // Email field
    emailInput: () => page.getByRole('textbox', { name: /email/i }),
    emailInputFallback1: () => page.locator('input[type="email"]'),
    emailInputFallback2: () => page.locator('input[name="email"], input[name*="email"]'),
    emailInputFallback3: () => page.locator('input[autocomplete="email"]'),
    emailInputFallback4: () => page.locator('#email, #checkout_email, [data-testid*="email"]'),

    // Phone field
    phoneInput: () => page.getByRole('textbox', { name: /phone/i }),
    phoneInputFallback1: () => page.locator('input[type="tel"]'),
    phoneInputFallback2: () => page.locator('input[name="phone"], input[name*="phone"]'),
    phoneInputFallback3: () => page.locator('input[autocomplete="tel"]'),

    // ==========================================
    // CHECKOUT FORM - SHIPPING
    // ==========================================

    firstNameInput: () => page.getByRole('textbox', { name: /first name/i }),
    firstNameFallback1: () => page.locator('input[name="firstName"], input[name="first_name"]'),
    firstNameFallback2: () => page.locator('input[name*="shipping"][name*="first"]'),
    firstNameFallback3: () => page.locator('input[autocomplete="given-name"]'),

    lastNameInput: () => page.getByRole('textbox', { name: /last name/i }),
    lastNameFallback1: () => page.locator('input[name="lastName"], input[name="last_name"]'),
    lastNameFallback2: () => page.locator('input[name*="shipping"][name*="last"]'),
    lastNameFallback3: () => page.locator('input[autocomplete="family-name"]'),

    address1Input: () => page.getByRole('textbox', { name: /address|street/i }).first(),
    address1Fallback1: () => page.locator('input[name="address1"], input[name="address_1"]'),
    address1Fallback2: () => page.locator('input[name*="shipping"][name*="address1"]'),
    address1Fallback3: () => page.locator('input[autocomplete="address-line1"]'),

    address2Input: () => page.getByRole('textbox', { name: /apartment|suite|unit/i }),
    address2Fallback1: () => page.locator('input[name="address2"], input[name="address_2"]'),
    address2Fallback2: () => page.locator('input[name*="shipping"][name*="address2"]'),
    address2Fallback3: () => page.locator('input[autocomplete="address-line2"]'),

    cityInput: () => page.getByRole('textbox', { name: /city/i }),
    cityFallback1: () => page.locator('input[name="city"]'),
    cityFallback2: () => page.locator('input[name*="shipping"][name*="city"]'),
    cityFallback3: () => page.locator('input[autocomplete="address-level2"]'),

    stateSelect: () => page.getByRole('combobox', { name: /state|province|region/i }),
    stateSelectFallback1: () => page.locator('select[name="state"], select[name="province"]'),
    stateSelectFallback2: () => page.locator('select[name*="shipping"][name*="state"]'),
    stateSelectFallback3: () => page.locator('select[autocomplete="address-level1"]'),
    stateInput: () => page.locator('input[name="state"], input[name="province"]'),

    zipInput: () => page.getByRole('textbox', { name: /zip|postal/i }),
    zipFallback1: () => page.locator('input[name="zip"], input[name="postal_code"], input[name="postalCode"]'),
    zipFallback2: () => page.locator('input[name*="shipping"][name*="zip"]'),
    zipFallback3: () => page.locator('input[autocomplete="postal-code"]'),

    countrySelect: () => page.getByRole('combobox', { name: /country/i }),
    countrySelectFallback1: () => page.locator('select[name="country"], select[name="countryCode"]'),
    countrySelectFallback2: () => page.locator('select[name*="shipping"][name*="country"]'),
    countrySelectFallback3: () => page.locator('select[autocomplete="country"]'),

    // ==========================================
    // CHECKOUT NAVIGATION
    // ==========================================

    continueToShipping: () => page.getByRole('button', { name: /continue to shipping/i }),
    continueToShippingFallback1: () => page.locator('button:has-text("Continue to shipping")'),
    continueToShippingFallback2: () => page.locator('button[type="submit"]:has-text("Continue")'),

    continueToPayment: () => page.getByRole('button', { name: /continue to payment/i }),
    continueToPaymentFallback1: () => page.locator('button:has-text("Continue to payment")'),
    continueToPaymentFallback2: () => page.locator('button[type="submit"]:has-text("Continue")'),

    // ==========================================
    // DISCOUNT CODE
    // ==========================================

    discountInput: () => page.getByRole('textbox', { name: /discount|promo|coupon/i }),
    discountInputFallback1: () => page.locator('input[name="discount"], input[name*="discount"]'),
    discountInputFallback2: () => page.locator('input[name="promo"], input[name*="promo"]'),
    discountInputFallback3: () => page.locator('input[name="coupon"], input[name*="coupon"]'),
    discountInputFallback4: () => page.locator('input[placeholder*="discount" i], input[placeholder*="promo" i]'),
    discountInputFallback5: () => page.locator('#discount-code, #promo-code, [data-testid*="discount"]'),

    discountApplyButton: () => page.getByRole('button', { name: /apply/i }),
    discountApplyFallback1: () => page.locator('button:has-text("Apply")'),
    discountApplyFallback2: () => page.locator('.discount-apply, .promo-apply, [class*="discount"] button'),

    discountToggle: () => page.locator(':text("discount code"), :text("promo code"), :text("coupon")'),
    discountToggleFallback: () => page.locator('.discount-toggle, [class*="discount"][class*="toggle"]'),

    // ==========================================
    // PAYMENT
    // ==========================================

    // Payment iframe (for Stripe, etc.)
    paymentIframe: () => page.frameLocator('iframe[name*="card"], iframe[src*="stripe"], iframe[title*="payment"]'),

    // Card number
    cardNumberInput: () => page.locator('input[name="cardNumber"], input[name="number"]'),
    cardNumberFallback1: () => page.locator('input[autocomplete="cc-number"]'),
    cardNumberFallback2: () => page.locator('input[placeholder*="card number" i]'),
    cardNumberFallback3: () => page.locator('#card-number, [data-testid*="card-number"]'),

    // Expiry
    cardExpiryInput: () => page.locator('input[name="expiry"], input[name="exp"]'),
    cardExpiryFallback1: () => page.locator('input[autocomplete="cc-exp"]'),
    cardExpiryFallback2: () => page.locator('input[placeholder*="MM" i]'),
    cardExpMonthSelect: () => page.locator('select[name*="month"], select[autocomplete="cc-exp-month"]'),
    cardExpYearSelect: () => page.locator('select[name*="year"], select[autocomplete="cc-exp-year"]'),

    // CVV
    cardCvvInput: () => page.locator('input[name="cvv"], input[name="cvc"], input[name="securityCode"]'),
    cardCvvFallback1: () => page.locator('input[autocomplete="cc-csc"]'),
    cardCvvFallback2: () => page.locator('input[placeholder*="CVV" i], input[placeholder*="CVC" i]'),

    // Name on card
    cardNameInput: () => page.locator('input[name="name"], input[name="cardName"]'),
    cardNameFallback: () => page.locator('input[autocomplete="cc-name"]'),

    // ==========================================
    // FINAL CHECKOUT
    // ==========================================

    placeOrderButton: () => page.getByRole('button', { name: /place order|complete order|pay now|submit order/i }),
    placeOrderFallback1: () => page.locator('button:has-text("Place Order"), button:has-text("Complete Order")'),
    placeOrderFallback2: () => page.locator('button:has-text("Pay Now"), button:has-text("Pay")'),
    placeOrderFallback3: () => page.locator('button[type="submit"]:has-text("Order")'),
    placeOrderFallback4: () => page.locator('.place-order, .complete-checkout, [class*="place-order"]'),
    placeOrderFallback5: () => page.locator('[data-testid*="place-order"], [data-testid*="submit-order"]'),

    // Order confirmation
    orderConfirmation: () => page.locator('.order-confirmation, .thank-you, :text("order confirmed")'),
    orderConfirmationFallback: () => page.locator(':text("thank you"), :text("order number"), h1:has-text("Confirmation")'),

    // ==========================================
    // LOADING STATES
    // ==========================================

    loader: () => page.locator('.loading, .spinner, .loader, [class*="loading"], [class*="spinner"]'),
    loaderFallback: () => page.locator('[aria-busy="true"], [data-loading="true"]'),
    buttonLoader: () => page.locator('button[disabled] .spinner, button.loading'),

    // ==========================================
    // ERROR STATES
    // ==========================================

    errorMessage: () => page.locator('.error, .error-message, [class*="error"], [role="alert"]'),
    fieldError: () => page.locator('.field-error, .input-error, .invalid-feedback'),

    // ==========================================
    // ACCOUNT / SIGN IN / SIGN OUT
    // ==========================================

    // Sign In button/link (when NOT signed in)
    signInButton: () => page.getByRole('link', { name: /sign in|log in/i }),
    signInButtonFallback1: () => page.locator('header a:has-text("Sign In"), header button:has-text("Sign In")'),
    signInButtonFallback2: () => page.locator('nav a:has-text("Sign In"), nav button:has-text("Sign In")'),
    signInButtonFallback3: () => page.locator('a:has-text("Log In"), button:has-text("Log In")'),
    signInButtonFallback4: () => page.locator('[aria-label*="sign in" i], [aria-label*="log in" i]'),
    signInButtonFallback5: () => page.locator('.sign-in, .signin, .login, #sign-in, #login'),
    signInButtonFallback6: () => page.locator('header [href*="login"], header [href*="signin"]'),

    // Sign In form fields (on login page)
    usernameInput: () => page.getByRole('textbox', { name: /username|email/i }),
    usernameInputFallback1: () => page.locator('input[name="username"]'),
    usernameInputFallback2: () => page.locator('input[name="email"]'),
    usernameInputFallback3: () => page.locator('input[type="email"]'),
    usernameInputFallback4: () => page.locator('input[placeholder*="username" i], input[placeholder*="email" i]'),
    usernameInputFallback5: () => page.locator('#username, #email, #login'),

    passwordInput: () => page.locator('input[type="password"]'),
    passwordInputFallback1: () => page.locator('input[name="password"]'),
    passwordInputFallback2: () => page.locator('input[placeholder*="password" i]'),
    passwordInputFallback3: () => page.locator('#password'),

    signInSubmit: () => page.getByRole('button', { name: /sign in|log in|login|submit/i }),
    signInSubmitFallback1: () => page.locator('button[type="submit"]'),
    signInSubmitFallback2: () => page.locator('button:has-text("Sign In"), button:has-text("Log In")'),
    signInSubmitFallback3: () => page.locator('.login-button, .submit-button, .sign-in-button'),

    // Account menu (when signed in)
    accountMenu: () => page.locator('[aria-label*="account" i], [aria-label*="profile" i]'),
    accountMenuFallback1: () => page.locator('header [class*="account"]'),
    accountMenuFallback2: () => page.locator('header [class*="user"], header [class*="avatar"]'),
    accountMenuFallback3: () => page.locator('.account-menu, .user-menu, .profile-menu'),
    accountMenuFallback4: () => page.locator('[data-testid*="account"], [data-testid*="user"]'),

    // Sign Out button/link (when signed in)
    signOutButton: () => page.getByRole('button', { name: /sign out|log out/i }),
    signOutButtonFallback1: () => page.locator('button:has-text("Sign Out"), a:has-text("Sign Out")'),
    signOutButtonFallback2: () => page.locator('button:has-text("Log Out"), a:has-text("Log Out")'),
    signOutButtonFallback3: () => page.locator('button:has-text("Logout"), a:has-text("Logout")'),
    signOutButtonFallback4: () => page.locator('[aria-label*="sign out" i], [aria-label*="log out" i]'),
    signOutButtonFallback5: () => page.locator('.sign-out, .signout, .logout, #sign-out, #logout'),
    signOutButtonFallback6: () => page.locator('[class*="dropdown"], [class*="menu"]').locator('text=Sign Out'),

    // Signed in indicator
    signedInIndicator: () => page.locator('a:has-text("My Account"), button:has-text("My Account")'),
    signedInIndicatorFallback1: () => page.locator('header [class*="logged-in"], header [class*="signed-in"]'),
    signedInIndicatorFallback2: () => page.locator('[data-user-logged-in="true"]'),

    // Purchase limit indicators
    purchaseLimitMessage: () => page.locator(':text("limit"), :text("maximum")'),
    purchaseLimitFallback1: () => page.locator(':text("already purchased"), :text("one per")'),
    purchaseLimitFallback2: () => page.locator('.limit-error, .purchase-limit, [class*="limit"]'),
    purchaseLimitFallback3: () => page.locator(':text("limited to"), :text("limit reached")'),
    purchaseLimitFallback4: () => page.locator(':text("cannot add more"), :text("max quantity")'),

    // Quantity limit / max quantity indicators
    quantityLimitMessage: () => page.locator('[class*="error"]:has-text("limit"), [class*="error"]:has-text("maximum")'),
    quantityLimitFallback1: () => page.locator('[role="alert"]:has-text("limit"), [role="alert"]:has-text("quantity")'),
    quantityLimitFallback2: () => page.locator(':text("per customer"), :text("per order")'),

    // Add to cart success indicators
    addedToCartConfirmation: () => page.locator(':text("added to cart"), :text("added to bag")'),
    addedToCartFallback1: () => page.locator('.cart-notification, .add-to-cart-success, [class*="cart-success"]'),
    addedToCartFallback2: () => page.locator('[role="alert"]:has-text("added"), [class*="notification"]:has-text("cart")'),
  };
}

module.exports = { getSelectors };
