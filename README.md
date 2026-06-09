# A2Z UNGATING

A2Z UNGATING is a hosted ungating packet builder and document converter for seller approval workflows.

## What It Does

- Builds a master ungating PDF packet in this order:
  - formal SOP letter to Amazon Seller Support Team
  - invoice or sales receipt documents
  - photographs
  - other supporting documents
- Lets users review and reorder uploaded documents before saving the final packet.
- Downloads master packets as `Ungating_Package.pdf` from the backend endpoint.
- Generates master PDFs through `POST /api/generate-master-pdf`.
- Converts `.docx` files into a merged PDF using the Node backend.
- Converts JPG, PNG, HEIC, and HEIF photos into a merged PDF using the Node backend.

## Hostinger Deployment

Use Hostinger's Node.js hosting/app feature.

1. Upload the project files to Hostinger.
2. Set the Node.js version to 18 or newer.
3. Set the entry file to `server.mjs`.
4. Set the start command to:

```bash
npm start
```

5. Install dependencies:

```bash
npm install
```

The server uses `process.env.PORT`, which Hostinger provides automatically. No Windows paths, local Python runtime, PowerShell script, or local PC dependency is required.

## Database And Master Account

Create a MySQL database in Hostinger, then add these environment variables to the Node.js app:

```text
DB_HOST=your_mysql_host
DB_USER=your_mysql_user
DB_PASSWORD=your_mysql_password
DB_NAME=your_mysql_database
DB_PORT=3306
MASTER_ADMIN_EMAIL=your_private_admin_email
MASTER_ADMIN_PASSWORD=your_private_admin_password
MASTER_ADMIN_NAME=Master Admin
PUBLIC_APP_URL=https://your-domain.com
SMTP_HOST=your_smtp_host
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_smtp_username
SMTP_PASSWORD=your_smtp_password
SMTP_FROM=your_from_email
STRIPE_SECRET_KEY=sk_live_or_test_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
STRIPE_MONTHLY_PRICE_ID=price_monthly_optional
STRIPE_YEARLY_PRICE_ID=price_yearly_optional
STRIPE_CURRENCY=usd
NODE_ENV=production
```

The master account is created privately by the server and is not displayed on the public website. Password reset links are emailed through the SMTP settings above, use `/reset-password?token=...`, and expire after 30 minutes.

Stripe Checkout is created through `POST /api/subscription/create-checkout`. Configure a Stripe webhook in Stripe Dashboard pointing to:

```text
https://your-domain.com/api/stripe/webhook
```

The webhook updates subscription access after checkout, failed payment, paid invoice, subscription update, or subscription cancellation. If `STRIPE_MONTHLY_PRICE_ID` and `STRIPE_YEARLY_PRICE_ID` are not provided, the app creates inline Stripe subscription prices from the built-in monthly and yearly plan amounts.

After deployment, confirm the webhook route is installed by opening:

```text
https://your-domain.com/api/stripe/webhook/status
```

It should return `{"ok":true,"message":"Stripe webhook endpoint is installed"}`.

## Local Development

If Node.js is installed locally:

```bash
npm install
npm start
```

Then open:

```text
http://127.0.0.1:8080/
```

## Notes

- The hosted Word converter supports modern `.docx` files. Legacy `.doc` files should be saved as `.docx` before upload.
- HEIC/HEIF support is handled internally by the backend package, so users do not need to install Windows HEIF Image Extensions.
- This tool is designed to organize genuine purchase documentation. It should not be used to fabricate invoices, alter supplier evidence, or misrepresent purchases.
