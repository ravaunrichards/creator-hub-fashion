# Creator Hub Fashion

**Version:** 0.1.0  
**Project type:** Standalone responsive fashion-commerce starter  
**Branding:** Original Creator Hub Fashion identity; not affiliated with or branded as SHEIN.

Creator Hub Fashion is a mobile-first storefront with a real Node.js backend and persistent SQLite database. It is a starting project for building a fashion retail business, not a production-ready copy of another company's store.

## Included

- Responsive editorial-style storefront for phones, tablets and desktop.
- Product categories, search, price filters, sale sorting, product details, sizes, colours, stock display and wishlists.
- A persistent SQLite catalogue seeded with 18 sample fashion products.
- Customer registration/sign-in with salted `scrypt` password hashes and HTTP-only session cookies.
- Shopping bag stored in the browser; stock and prices are re-validated by the server at checkout.
- Checkout with Jamaican parish/address fields, JMD pricing, configurable delivery fee and free-shipping threshold.
- Pay-on-delivery order requests and internal order tracking by order code plus checkout email.
- Optional server-side PayPal create/capture integration. PayPal is disabled by default and requires merchant credentials and a verified conversion rate.
- Protected admin dashboard for catalogue pricing, stock/visibility, adding products, order status updates and paid-order totals.
- Rate limits for login/registration, payload size limits, security headers, input checks and inventory-restoration safeguards.
- API integration tests, syntax checks and a launch checklist.

## Requirements

- Node.js **22.5 or newer** (the built-in `node:sqlite` module is used).
- No npm package installation is required; the application uses Node's built-in modules.
- Internet access in the browser for the externally hosted product/editorial images and optional web fonts. Replace sample imagery with your licensed product photography before launch.

Some Node versions print an `ExperimentalWarning` for `node:sqlite`; that warning does not indicate a failed test. The project was tested in this environment with Node v22.16.0.

## Run locally

1. Extract the ZIP.
2. On Windows, double-click `START-WINDOWS.bat`; on macOS/Linux, run `./start-mac-linux.sh`. These helpers create `.env` from the example if needed and start the server. Alternatively, copy `.env.example` to `.env` yourself.
3. To start manually, open a terminal in the project folder and run:

   ```bash
   npm start
   ```

4. Open `http://localhost:3000` in your browser. On a phone using the same Wi-Fi network, use the computer's local network IP and port `3000` if its firewall permits it.

For watch mode while developing:

```bash
npm run dev
```

A SQLite database is automatically created at `data/store.sqlite` on first launch. Keep the `data/` directory on a durable disk and back it up. Never commit the database or `.env` to a public repository.

## Set up the first administrator

1. Start the store and create a normal account using the storefront.
2. Stop the server with `Ctrl+C`.
3. In the same project folder and using the same `.env`/database path, run:

   ```bash
   npm run make-admin -- your-email@example.com
   ```

4. Restart with `npm start`, sign in with that account, and open **Store admin**.

The administrator command requires local access to the SQLite database. Do not expose the command or database to customers. Create additional admin users only by repeating the controlled local role change for an existing account.

## Checkout, JMD and PayPal

Default store settings:

- Prices and internal order totals: **JMD**.
- Standard delivery fee: **JMD $500**.
- Free delivery threshold: **JMD $10,000**.
- Pay-on-delivery: records an unpaid order request. It is not an online payment confirmation.
- PayPal: off until all required settings are filled in.

To enable PayPal, first create and test a PayPal app using credentials belonging to the actual store operator. Update `.env` with:

```dotenv
PAYPAL_CLIENT_ID=your_client_id
PAYPAL_CLIENT_SECRET=your_client_secret
PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com
PAYPAL_CURRENCY=USD
JMD_PER_USD=your_verified_rate
```

`JMD_PER_USD` means how many Jamaican dollars equal one US dollar under the store's chosen, verified conversion policy. **Do not copy a guessed rate.** Test with sandbox credentials and a verified rate first. Before live transactions, use the matching live client ID/secret and change `PAYPAL_BASE_URL` to `https://api-m.paypal.com`. Keep secrets on the server and out of browser code, Git and screenshots. This version's PayPal adapter settles in USD; the storefront and order ledger continue to display JMD.

If those settings are missing or invalid, the PayPal button stays unavailable and the API rejects attempts to create a PayPal order. The application does not claim an order is paid unless PayPal's capture response is completed and matches the expected order/currency/amount.

## Useful commands

```bash
npm start             # Start the storefront and API
npm run dev           # Restart automatically during local development
npm run check         # JavaScript syntax checks
npm test              # API and integration tests
npm run make-admin -- your-email@example.com
```

## API overview

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Basic application/database status |
| GET | `/api/config` | Store settings needed by the storefront |
| GET | `/api/products` | Catalogue search, category, tag, price and sorting filters |
| GET | `/api/products/:id-or-slug` | Product detail |
| POST | `/api/auth/register` | Create customer account and session |
| POST | `/api/auth/login` | Sign in |
| GET | `/api/auth/me` | Current customer session |
| POST | `/api/auth/logout` | Sign out |
| GET / POST | `/api/wishlist` | Read or update a signed-in customer's wishlist |
| POST | `/api/orders` | Place a pay-on-delivery order request |
| POST | `/api/payments/paypal/create` | Create a server-side PayPal order (configuration required) |
| POST | `/api/payments/paypal/capture` | Capture and validate a PayPal order |
| GET | `/api/track?code=...&email=...` | Look up a customer's order status |
| GET | `/api/account/orders` | List orders linked to signed-in account |
| GET | `/api/admin/summary` | Admin summary, products and order list |
| POST | `/api/admin/products` | Add a product (admin only) |
| PATCH | `/api/admin/products/:id-or-slug` | Update product details (admin only) |
| PATCH | `/api/admin/orders/:id-or-code` | Update order status (admin only) |

## Before public launch

This project deliberately uses sample product records, sample stock, and remotely hosted demo imagery so that the storefront is immediately viewable. Before accepting real customers, the owner must replace sample records and photographs, confirm supplier permissions and stock, publish real prices and product terms, define delivery/returns/refunds/support policies, configure real payments, configure business emails and monitoring, take database backups, and review local business/tax/consumer obligations.

Other integrations not included: carrier/shipping-provider APIs, automatic customer emails/SMS, payment refunds, password reset/email verification, multi-vendor seller accounts, real newsletter service, tax engine, analytics, and store-specific legal documents. Current order tracking is the store's own status, not carrier tracking.

## Deployment guidance

Deploy this project only to a host that supports the required Node version and a **durable writable disk** for SQLite. Many ephemeral server containers erase local files on rebuild/restart; on those hosts, configure a persistent volume or replace the local SQLite adapter with a managed database. Use HTTPS, `NODE_ENV=production`, strong environment secrets, backups, monitoring, and a tested recovery procedure. Never run public production traffic until the deployment checklist and real-payment tests have been completed.

See [DEPLOYMENT-CHECKLIST.md](DEPLOYMENT-CHECKLIST.md) and [TEST-REPORT.md](TEST-REPORT.md).
