import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import mammoth from "mammoth";
import heicConvert from "heic-convert";

const root = process.cwd();
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "0.0.0.0";

const pageSize = {
  width: 612,
  height: 792,
  margin: 54
};

const colors = {
  text: rgb(34 / 255, 34 / 255, 34 / 255),
  header: rgb(15 / 255, 76 / 255, 129 / 255),
  accent: rgb(46 / 255, 117 / 255, 182 / 255)
};

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function parseMultipart(buffer, contentType) {
  const boundaryMatch = /boundary=([^;]+)/i.exec(contentType || "");
  if (!boundaryMatch) return [];

  const boundary = `--${boundaryMatch[1]}`;
  const body = buffer.toString("binary");
  return body
    .split(boundary)
    .slice(1, -1)
    .map((part) => {
      const trimmed = part.replace(/^\r\n/, "").replace(/\r\n$/, "");
      const splitIndex = trimmed.indexOf("\r\n\r\n");
      if (splitIndex < 0) return null;

      const headerText = trimmed.slice(0, splitIndex);
      const content = trimmed.slice(splitIndex + 4);
      const nameMatch = /name="([^"]+)"/i.exec(headerText);
      const filenameMatch = /filename="([^"]+)"/i.exec(headerText);
      const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerText);
      if (!nameMatch) return null;

      if (!filenameMatch) {
        return {
          name: nameMatch[1],
          value: Buffer.from(content, "binary").toString("utf8")
        };
      }

      return {
        name: nameMatch[1],
        filename: sanitizeFileName(filenameMatch[1]),
        contentType: typeMatch?.[1] || "application/octet-stream",
        data: Buffer.from(content, "binary")
      };
    })
    .filter(Boolean);
}

function getMultipartFiles(parts) {
  return parts.filter((part) => part.filename);
}

function getMultipartField(parts, name) {
  return parts.find((part) => part.name === name && !part.filename)?.value || "";
}

function sanitizeFileName(fileName) {
  return fileName.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
}

function wrapText(text, font, size, maxWidth) {
  const words = String(text).replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let line = "";

  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      return;
    }

    if (line) lines.push(line);
    line = word;
  });

  if (line) lines.push(line);
  return lines;
}

async function appendTextDocument(pdfDoc, title, text) {
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const bodySize = 11;
  const titleSize = 20;
  const lineHeight = bodySize * 1.4;
  let page = pdfDoc.addPage([pageSize.width, pageSize.height]);
  let y = pageSize.height - pageSize.margin;

  function newPage() {
    page = pdfDoc.addPage([pageSize.width, pageSize.height]);
    y = pageSize.height - pageSize.margin;
  }

  page.drawText(title, {
    x: pageSize.margin,
    y,
    size: titleSize,
    font: bold,
    color: colors.header
  });
  y -= titleSize * 1.4;

  page.drawLine({
    start: { x: pageSize.margin, y },
    end: { x: pageSize.width - pageSize.margin, y },
    thickness: 1.2,
    color: colors.accent
  });
  y -= 24;

  const paragraphs = String(text || "No readable text was found in this document.")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  paragraphs.forEach((paragraph) => {
    const lines = paragraph
      .split(/\n/)
      .flatMap((line) => wrapText(line, regular, bodySize, pageSize.width - pageSize.margin * 2));

    lines.forEach((line) => {
      if (y < pageSize.margin) newPage();
      page.drawText(line, {
        x: pageSize.margin,
        y,
        size: bodySize,
        font: regular,
        color: colors.text
      });
      y -= lineHeight;
    });
    y -= bodySize;
  });
}

async function handleWordConversion(request, response) {
  try {
    const body = await readRequestBody(request);
    const files = getMultipartFiles(parseMultipart(body, request.headers["content-type"]));
    const wordFiles = files.filter((file) => /\.docx$/i.test(file.filename));
    const legacyFiles = files.filter((file) => /\.doc$/i.test(file.filename));

    if (legacyFiles.length) {
      sendJson(response, 400, {
        error: "Legacy .doc files are not supported on the hosted converter. Save them as .docx, then upload again."
      });
      return;
    }

    if (!wordFiles.length) {
      sendJson(response, 400, { error: "Upload at least one .docx file." });
      return;
    }

    const pdfDoc = await PDFDocument.create();
    for (const file of wordFiles) {
      const result = await mammoth.extractRawText({ buffer: file.data });
      await appendTextDocument(pdfDoc, file.filename.replace(/\.docx$/i, ""), result.value);
    }

    pdfDoc.setTitle("WORD_TO_PDF");
    pdfDoc.setSubject("Word documents converted to PDF");
    pdfDoc.setCreator("A2Z UNGATING Convert");
    const pdf = Buffer.from(await pdfDoc.save());

    response.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "Content-Disposition",
      "Content-Type": "application/pdf",
      "Content-Length": pdf.length,
      "Content-Disposition": 'attachment; filename="WORD_TO_PDF.pdf"'
    });
    response.end(pdf);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
}

function isSupportedPhoto(file) {
  return /\.(png|jpe?g|heic|heif)$/i.test(file.filename) || /image\/(png|jpeg|heic|heif)/i.test(file.contentType);
}

function isHeicPhoto(file) {
  return /\.(heic|heif)$/i.test(file.filename) || /image\/(heic|heif)/i.test(file.contentType);
}

function isPngPhoto(file) {
  return /\.png$/i.test(file.filename) || /image\/png/i.test(file.contentType);
}

async function getEmbeddableImage(pdfDoc, file) {
  if (isHeicPhoto(file)) {
    const jpegBytes = Buffer.from(
      await heicConvert({
        buffer: file.data,
        format: "JPEG",
        quality: 0.92
      })
    );
    return pdfDoc.embedJpg(jpegBytes);
  }

  return isPngPhoto(file) ? pdfDoc.embedPng(file.data) : pdfDoc.embedJpg(file.data);
}

async function appendPhotoPage(pdfDoc, file) {
  const image = await getEmbeddableImage(pdfDoc, file);
  const page = pdfDoc.addPage([pageSize.width, pageSize.height]);
  const maxWidth = pageSize.width - pageSize.margin * 2;
  const maxHeight = pageSize.height - pageSize.margin * 2;
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  const width = image.width * scale;
  const height = image.height * scale;

  page.drawImage(image, {
    x: (pageSize.width - width) / 2,
    y: (pageSize.height - height) / 2,
    width,
    height
  });
}

async function handlePhotoConversion(request, response) {
  try {
    const body = await readRequestBody(request);
    const files = getMultipartFiles(parseMultipart(body, request.headers["content-type"])).filter(isSupportedPhoto);

    if (!files.length) {
      sendJson(response, 400, { error: "Upload at least one JPG, PNG, or HEIC photo." });
      return;
    }

    const pdfDoc = await PDFDocument.create();
    for (const file of files) {
      await appendPhotoPage(pdfDoc, file);
    }

    pdfDoc.setTitle("PHOTOS_TO_PDF");
    pdfDoc.setSubject("Photos converted to PDF");
    pdfDoc.setCreator("A2Z UNGATING Convert");
    const pdf = Buffer.from(await pdfDoc.save());

    response.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "Content-Disposition",
      "Content-Type": "application/pdf",
      "Content-Length": pdf.length,
      "Content-Disposition": 'attachment; filename="PHOTOS_TO_PDF.pdf"'
    });
    response.end(pdf);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
}

function isSupportedMasterFile(file) {
  return isPdfFile(file) || isSupportedPhoto(file);
}

function isPdfFile(file) {
  return /\.pdf$/i.test(file.filename) || /application\/pdf/i.test(file.contentType);
}

function buildSopParts(data) {
  const invoiceLine = data.invoiceNumber
    ? `The primary invoice referenced for this request is ${data.invoiceNumber}${data.invoiceDate ? `, dated ${data.invoiceDate}` : ""}.`
    : "The attached invoice is included as the primary purchase record for this request.";

  return {
    title: "Ungating Approval Request",
    meta: [
      `ASIN: ${data.asin || "[ASIN]"}`,
      `Units: ${data.unitsPurchased || "[unit count]"}`,
      `Supplier: ${data.supplierName || "[supplier name]"}`,
      `Invoice: ${data.invoiceNumber || "[invoice number]"}`,
      `Business Address: ${data.billingAddress || "[business address]"}`
    ],
    paragraphs: [
      "To Amazon Seller Support Team,",
      `I am requesting approval to sell ASIN ${data.asin || "[ASIN]"}, described as ${data.productDescription || "[product description]"}. I purchased ${data.unitsPurchased || "[unit count]"} units from ${data.supplierName || "[supplier name]"} for resale through my business${data.buyerName ? `, ${data.buyerName}` : ""}.`,
      `${invoiceLine} I have attached the supporting supplier documentation, delivery evidence, and product photographs so your team can verify the purchase source, quantity, and product identity.`,
      `The documents in this packet are genuine purchase records and supporting proofs. They are organized to show the connection between the supplier, the purchased inventory, and the ASIN requested for approval.${data.billingAddress ? ` My business address for verification is ${data.billingAddress}.` : ""} ${data.purchaseNotes || "The invoice, shipment evidence, and photographs are intended to make the review straightforward and complete."}`,
      "Please review the attached packet and approve my account to list this product. I am happy to provide any additional documentation needed for verification.",
      `Thank you,\n${data.buyerName || "[Your business name]"}`
    ],
    footer: "Generated for marketplace ungating submission"
  };
}

async function appendSopPage(pdfDoc, data) {
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const sop = buildSopParts(data);
  const bodySize = 11;
  const lineHeight = bodySize * 1.4;
  let page = pdfDoc.addPage([pageSize.width, pageSize.height]);
  let y = pageSize.height - pageSize.margin;

  function drawFooter(targetPage) {
    targetPage.drawLine({
      start: { x: pageSize.margin, y: pageSize.margin - 16 },
      end: { x: pageSize.width - pageSize.margin, y: pageSize.margin - 16 },
      thickness: 0.6,
      color: colors.accent
    });
    targetPage.drawText(sop.footer, {
      x: pageSize.margin,
      y: pageSize.margin - 30,
      size: 8,
      font: regular,
      color: colors.text
    });
  }

  function newPage() {
    drawFooter(page);
    page = pdfDoc.addPage([pageSize.width, pageSize.height]);
    y = pageSize.height - pageSize.margin;
  }

  page.drawText(sop.title, {
    x: pageSize.margin,
    y,
    size: 24,
    font: bold,
    color: colors.header
  });
  y -= 28;

  page.drawLine({
    start: { x: pageSize.margin, y },
    end: { x: pageSize.width - pageSize.margin, y },
    thickness: 1.4,
    color: colors.accent
  });
  y -= 24;

  wrapText(sop.meta.join("   |   "), bold, 13, pageSize.width - pageSize.margin * 2).forEach((line) => {
    page.drawText(line, {
      x: pageSize.margin,
      y,
      size: 13,
      font: bold,
      color: colors.accent
    });
    y -= 18.2;
  });
  y -= 16;

  sop.paragraphs.forEach((paragraph) => {
    const lines = paragraph
      .split("\n")
      .flatMap((line) => wrapText(line, regular, bodySize, pageSize.width - pageSize.margin * 2));

    lines.forEach((line) => {
      if (y < pageSize.margin + 28) newPage();
      page.drawText(line, {
        x: pageSize.margin,
        y,
        size: bodySize,
        font: regular,
        color: colors.text
      });
      y -= lineHeight;
    });
    y -= bodySize * 0.85;
  });

  drawFooter(page);
}

async function appendPdfFile(pdfDoc, file) {
  const sourcePdf = await PDFDocument.load(file.data, { ignoreEncryption: true });
  const copiedPages = await pdfDoc.copyPages(sourcePdf, sourcePdf.getPageIndices());
  copiedPages.forEach((page) => pdfDoc.addPage(page));
}

async function appendMasterFile(pdfDoc, file) {
  if (isPdfFile(file)) {
    await appendPdfFile(pdfDoc, file);
    return;
  }

  if (isSupportedPhoto(file)) {
    await appendPhotoPage(pdfDoc, file);
    return;
  }

  throw new Error(`Unsupported file type: ${file.filename}. Upload PDF, JPG, PNG, HEIC, or HEIF files.`);
}

async function handleMasterPdfGeneration(request, response) {
  try {
    const body = await readRequestBody(request);
    const parts = parseMultipart(body, request.headers["content-type"]);
    const files = getMultipartFiles(parts);

    if (!files.length) {
      sendJson(response, 400, { error: "Upload at least one invoice, delivery slip, order confirmation, or product photo." });
      return;
    }

    const unsupported = files.filter((file) => !isSupportedMasterFile(file));
    if (unsupported.length) {
      sendJson(response, 400, {
        error: `Unsupported file type: ${unsupported.map((file) => file.filename).join(", ")}. Upload PDF, JPG, PNG, HEIC, or HEIF files.`
      });
      return;
    }

    let data = {};
    try {
      data = JSON.parse(getMultipartField(parts, "data") || "{}");
    } catch {
      sendJson(response, 400, { error: "The PDF request data could not be read. Refresh the page and try again." });
      return;
    }

    const pdfDoc = await PDFDocument.create();
    await appendSopPage(pdfDoc, data);

    for (const file of files) {
      await appendMasterFile(pdfDoc, file);
    }

    pdfDoc.setTitle("Ungating_Package");
    pdfDoc.setSubject("Ungating master packet");
    pdfDoc.setCreator("A2Z UNGATING");
    const pdf = Buffer.from(await pdfDoc.save());

    response.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "Content-Disposition",
      "Content-Type": "application/pdf",
      "Content-Length": pdf.length,
      "Content-Disposition": 'attachment; filename="Ungating_Package.pdf"'
    });
    response.end(pdf);
  } catch (error) {
    sendJson(response, 500, { error: `PDF generation failed: ${error.message}` });
  }
}

function getSafeStaticPath(pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(root, requested));
  const rootWithSeparator = root.endsWith(sep) ? root : `${root}${sep}`;
  return filePath === root || filePath.startsWith(rootWithSeparator) ? filePath : null;
}

createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Origin": "*"
    });
    response.end();
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/convert/word") {
    await handleWordConversion(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/convert/photos") {
    await handlePhotoConversion(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/generate-master-pdf") {
    await handleMasterPdfGeneration(request, response);
    return;
  }

  const filePath = getSafeStaticPath(url.pathname);
  if (!filePath) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": types[extname(filePath)] || "application/octet-stream"
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}).listen(port, host, () => {
  console.log(`A2Z UNGATING running on port ${port}`);
});
