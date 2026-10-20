# Creator Hub Fashion — Test Report

**Version:** 0.1.0  
**Execution:** local container run, no external payment account required.

## Automated checks

| Check | Result | What it covered |
| --- | --- | --- |
| `npm run check` | PASS | Syntax checks for server, browser code and tests |
| Catalogue API test | PASS | Health endpoint, seeded products, categories, search and category filtering |
| Customer session/wishlist test | PASS | Registration, HTTP-only session cookie, signed-in profile and account-bound wishlist |
| Checkout/order test | PASS | Empty-cart rejection, server-calculated subtotal/delivery, order persistence, email-gated tracking and customer order history |
| Payment safety/static test | PASS | PayPal create endpoint rejects unconfigured payments; static storefront and browser JS are served |
| Admin/inventory test | PASS | Admin-gated dashboard, product update, cancellation inventory restoration once and prevention of reopening cancelled order |
| `npm test` overall | PASS — 5/5 | All included integration tests passed |

Node printed the built-in SQLite `ExperimentalWarning` for the tested Node v22.16.0 environment. The test suite still passed.

## Not tested / not claimed

- No PayPal sandbox or live transaction was run because merchant credentials and a verified conversion rate were not supplied.
- No live hosting/deployment, production volume test, carrier/shipping API or customer-email delivery test was performed.
- Tests do not replace a manual cross-device/browser acceptance test or a security review before launch.
- External Unsplash image delivery and Google Fonts availability depend on browser network access; these assets are not bundled locally.

## Reproduction

From the extracted project folder, run:

```bash
npm run check
npm test
```
