# Creator Hub Fashion — Deployment Checklist

This checklist is intentionally a gate: a passing local test suite is not evidence that supplier, delivery or live payment operations are ready.

## Before test deployment

- [ ] Use a supported Node.js release (22.5+ for this build).
- [ ] Copy `.env.example` to `.env` or configure equivalent secret environment variables on the host.
- [ ] Set `NODE_ENV=production` so the session cookie gets the `Secure` flag behind HTTPS.
- [ ] Set a durable SQLite path / persistent volume and confirm data survives a restart and redeploy.
- [ ] Set realistic shipping fees and free-shipping threshold in JMD.
- [ ] Create the first admin account and verify the admin role is restricted.
- [ ] Replace every sample catalogue item, stock count, photo and placeholder product description with verified business data.
- [ ] Confirm all imagery is licensed/owned and served securely.
- [ ] Confirm backups are made and can be restored.

## Payments and fulfilment

- [ ] Configure PayPal sandbox credentials and a verified JMD-per-USD exchange policy/rate before testing the button.
- [ ] Test successful capture, declined/cancelled payment, repeat capture, timeout and mismatched amount handling in sandbox.
- [ ] Review unsettled PayPal orders and inventory release behavior.
- [ ] Test pay-on-delivery order submission and status updates with the actual fulfilment team.
- [ ] Publish the delivery area/rates, order confirmation process, returns/refunds policy and verified support contact.
- [ ] Configure order confirmation emails/SMS and carrier tracking separately; these are not included in this version.
- [ ] Confirm inventory and prices remain accurate when concurrent customers check out.

## Security and legal readiness

- [ ] Use HTTPS and verify redirect and cookie behavior.
- [ ] Keep `.env`, database files, logs and backups private; never put PayPal secrets in frontend files.
- [ ] Review admin access, account policies, privacy/data-retention practices and abuse/rate-limit settings.
- [ ] Review Jamaican and any target-market business, tax, consumer-protection, privacy and online-selling requirements with qualified advisors.
- [ ] Add a tested password reset and email-verification flow before relying on customer accounts in production.
- [ ] Load test the target host and test recovery from backup.

## Launch gate

**Do not treat the starter project as launch-ready until every applicable item above has been verified.** This ZIP has not been deployed to a live host and no real payment credentials were supplied or tested.
