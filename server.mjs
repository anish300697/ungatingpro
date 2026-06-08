import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const mammoth = require("mammoth");
const heicConvert = require("heic-convert");

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
      const filenameMatch = /filename="([^"]+)"/i.exec(headerText);
      const typeMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerText);
      if (!filenameMatch) return null;

      return {
        filename: sanitizeFileName(filenameMatch[1]),
        contentType: typeMatch?.[1] || "application/octet-stream",
        data: Buffer.from(content, "binary")
      };
    })
    .filter(Boolean);
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
    const files = parseMultipart(body, request.headers["content-type"]);
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
    pdfDoc.setCreator("Project X Convert");
    const pdf = Buffer.from(await pdfDoc.save());

    response.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
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
    const files = parseMultipart(body, request.headers["content-type"]).filter(isSupportedPhoto);

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
    pdfDoc.setCreator("Project X Convert");
    const pdf = Buffer.from(await pdfDoc.save());

    response.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/pdf",
      "Content-Length": pdf.length,
      "Content-Disposition": 'attachment; filename="PHOTOS_TO_PDF.pdf"'
    });
    response.end(pdf);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
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
  console.log(`Project X running on port ${port}`);
});
