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
