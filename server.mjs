import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import mammoth from "mammoth";
import heicConvert from "heic-convert";
import mysql from "mysql2/promise";
import nodemailer from "nodemailer";

const root = process.cwd();
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "0.0.0.0";
const sessionCookieName = "a2z_session";
const sessionDays = 14;
const resetTokenMinutes = 30;
const resetRequestLimit = 5;
const resetRateWindowMs = 15 * 60 * 1000;
const coupons = {
  LAUNCH10: { type: "percent", amount: 10 },
  BETA25: { type: "percent", amount: 25 },
  YEARLY50: { type: "fixed", amount: 50, planType: "yearly" }
};
const plans = {
  monthly: { planType: "monthly", planName: "Unlimited Generate", planPrice: 9.99, billingCycle: "Monthly" },
  yearly: { planType: "yearly", planName: "Unlimited Generate", planPrice: 96, billingCycle: "Yearly" }
};

let dbPool = null;
let dbReady = false;
const resetRequestBuckets = new Map();

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
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml; charset=utf-8",
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

function sendJsonWithHeaders(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8",
    ...headers
  });
  response.end(JSON.stringify(payload));
}

async function sendFile(response, filePath, headers = {}) {
  const body = await readFile(filePath);
  response.writeHead(200, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": types[extname(filePath)] || "application/octet-stream",
    ...headers
  });
  response.end(body);
}

async function sendNoCacheFile(response, relativePath) {
  const filePath = normalize(join(root, relativePath));
  await sendFile(response, filePath, {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0"
  });
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

async function readJsonBody(request) {
  const body = await readRequestBody(request);
  if (!body.length) return {};
  return JSON.parse(body.toString("utf8"));
}

function hasDatabaseConfig() {
  return Boolean(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);
}

function requireDatabase(response) {
  if (dbReady && dbPool) return true;
  sendJson(response, 503, {
    error: "Database is not configured. Add DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, and DB_PORT in Hostinger environment variables."
  });
  return false;
}

async function initDatabase() {
  if (!hasDatabaseConfig()) {
    console.warn("A2Z auth database is not configured. Sign In will stay unavailable until DB env vars are added.");
    return;
  }

  dbPool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 3306),
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 5),
    namedPlaceholders: true
  });

  await dbPool.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(160) NOT NULL,
      email VARCHAR(191) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(32) NOT NULL DEFAULT 'user',
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      is_master TINYINT(1) NOT NULL DEFAULT 0,
      subscription_status VARCHAR(32) NOT NULL DEFAULT 'inactive',
      plan VARCHAR(32) NULL,
      plan_type VARCHAR(32) NULL,
      payment_status VARCHAR(32) NULL,
      coupon_code VARCHAR(64) NULL,
      access_source VARCHAR(32) NULL,
      has_full_access TINYINT(1) NOT NULL DEFAULT 0,
      access_expires_at DATETIME NULL,
      subscription_started_at DATETIME NULL,
      subscription_expires_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await ensureUserSubscriptionColumns();

  await dbPool.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      id CHAR(64) PRIMARY KEY,
      user_id INT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await dbPool.execute(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      token_hash CHAR(64) NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await dbPool.execute(`
    CREATE TABLE IF NOT EXISTS payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      plan_type VARCHAR(32) NOT NULL,
      coupon_code VARCHAR(64) NULL,
      discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      final_amount DECIMAL(10,2) NOT NULL,
      payment_status VARCHAR(32) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await seedMasterAccount();
  dbReady = true;
}

async function ensureUserSubscriptionColumns() {
  const columns = [
    ["subscription_status", "VARCHAR(32) NOT NULL DEFAULT 'inactive'"],
    ["plan", "VARCHAR(32) NULL"],
    ["plan_type", "VARCHAR(32) NULL"],
    ["payment_status", "VARCHAR(32) NULL"],
    ["coupon_code", "VARCHAR(64) NULL"],
    ["access_source", "VARCHAR(32) NULL"],
    ["has_full_access", "TINYINT(1) NOT NULL DEFAULT 0"],
    ["access_expires_at", "DATETIME NULL"],
    ["subscription_started_at", "DATETIME NULL"],
    ["subscription_expires_at", "DATETIME NULL"]
  ];

  for (const [column, definition] of columns) {
    const [rows] = await dbPool.execute(
      `
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'users'
          AND COLUMN_NAME = :column
      `,
      { column }
    );
    if (!rows.length) {
      await dbPool.execute(`ALTER TABLE users ADD COLUMN ${column} ${definition}`);
    }
  }
}

function hashPassword(password) {
  const iterations = 210000;
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex");
  return `pbkdf2$${iterations}$${salt}$${hash}`;
}

function hashToken(token) {
  return pbkdf2Sync(token, "a2z-password-reset", 100000, 32, "sha256").toString("hex");
}

function verifyPassword(password, storedHash) {
  const [scheme, iterations, salt, hash] = String(storedHash || "").split("$");
  if (scheme !== "pbkdf2" || !iterations || !salt || !hash) return false;
  const candidate = pbkdf2Sync(password, salt, Number(iterations), 32, "sha256");
  const expected = Buffer.from(hash, "hex");
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    isMaster: Boolean(user.is_master),
    subscriptionStatus: user.subscription_status || "inactive",
    plan: user.plan || user.plan_type || null,
    planType: user.plan_type || user.plan || null,
    paymentStatus: user.payment_status || null,
    couponCode: user.coupon_code || null,
    accessSource: user.access_source || null,
    hasFullAccess: Boolean(user.has_full_access),
    subscriptionStartedAt: user.subscription_started_at || null,
    subscriptionExpiresAt: user.subscription_expires_at || user.access_expires_at || null,
    hasActiveAccess: hasActiveAccess(user)
  };
}

function hasActiveAccess(user) {
  if (!user) return false;
  if (user.is_master || user.role === "admin") return true;
  if (user.has_full_access) return true;
  if (user.plan === "free_all" || user.plan_type === "free_all") return true;
  const status = user.subscription_status;
  const activeStatus = status === "active" || status === "trial";
  if (!activeStatus) return false;
  if (!user.subscription_expires_at) return true;
  return new Date(user.subscription_expires_at).getTime() > Date.now();
}

function getPublicBaseUrl(request) {
  const configured = process.env.PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, "");
  const proto = request.headers["x-forwarded-proto"] || (process.env.NODE_ENV === "production" ? "https" : "http");
  const requestHost = request.headers["x-forwarded-host"] || request.headers.host || `${host}:${port}`;
  return `${proto}://${requestHost}`;
}

function getClientIp(request) {
  return String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
}

function checkResetRateLimit(request, email) {
  const now = Date.now();
  const key = `${getClientIp(request)}:${email}`;
  const bucket = resetRequestBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    resetRequestBuckets.set(key, { count: 1, resetAt: now + resetRateWindowMs });
    return true;
  }

  if (bucket.count >= resetRequestLimit) return false;
  bucket.count += 1;
  return true;
}

function hasSmtpConfig() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);
}

async function sendPasswordResetEmail(to, resetUrl) {
  if (!hasSmtpConfig()) {
    throw new Error("Email service is not configured. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, and PUBLIC_APP_URL.");
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD
    }
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: "Reset your Ungating Pro password",
    text: `Use this secure link to reset your password. It expires in ${resetTokenMinutes} minutes:\n\n${resetUrl}`,
    html: `<p>Use this secure link to reset your password. It expires in ${resetTokenMinutes} minutes.</p><p><a href="${resetUrl}">Reset password</a></p>`
  });
}

async function seedMasterAccount() {
  const email = normalizeEmail(process.env.MASTER_ADMIN_EMAIL);
  const password = process.env.MASTER_ADMIN_PASSWORD;
  const name = process.env.MASTER_ADMIN_NAME || "Master Admin";
  if (!email || !password) return;

  const passwordHash = hashPassword(password);
  await dbPool.execute(
    `
      INSERT INTO users (name, email, password_hash, role, status, is_master)
      VALUES (:name, :email, :passwordHash, 'admin', 'active', 1)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        password_hash = VALUES(password_hash),
        role = 'admin',
        status = 'active',
        is_master = 1
    `,
    { name, email, passwordHash }
  );
}

function parseCookies(request) {
  return Object.fromEntries(
    String(request.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index === -1 ? [part, ""] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function getCookieHeader(request, token) {
  const secure = request.headers["x-forwarded-proto"] === "https" || process.env.NODE_ENV === "production";
  const maxAge = sessionDays * 24 * 60 * 60;
  return `${sessionCookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function getClearCookieHeader(request) {
  const secure = request.headers["x-forwarded-proto"] === "https" || process.env.NODE_ENV === "production";
  return `${sessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? "; Secure" : ""}`;
}

function getClearTokenCookieHeader(request) {
  const secure = request.headers["x-forwarded-proto"] === "https" || process.env.NODE_ENV === "production";
  return `token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? "; Secure" : ""}`;
}

async function createSession(userId) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000);
  await dbPool.execute("INSERT INTO sessions (id, user_id, expires_at) VALUES (:token, :userId, :expiresAt)", {
    token,
    userId,
    expiresAt
  });
  return token;
}

async function getSessionUser(request) {
  if (!dbReady || !dbPool) return null;
  const token = parseCookies(request)[sessionCookieName];
  if (!token) return null;

  const [rows] = await dbPool.execute(
    `
      SELECT users.*
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.id = :token
        AND sessions.expires_at > NOW()
        AND users.status = 'active'
      LIMIT 1
    `,
    { token }
  );
  return rows[0] || null;
}

async function requireAdmin(request, response) {
  const user = await getSessionUser(request);
  if (!user) {
    sendJson(response, 401, { error: "Sign in is required." });
    return null;
  }
  if (user.role !== "admin" && !user.is_master) {
    sendJson(response, 403, { error: "Master admin access is required." });
    return null;
  }
  return user;
}

async function requireSignedIn(request, response) {
  if (!requireDatabase(response)) return null;
  const user = await getSessionUser(request);
  if (!user) {
    sendJson(response, 401, { error: "Sign in is required." });
    return null;
  }
  return user;
}

async function requireActiveAccess(request, response) {
  const user = await requireSignedIn(request, response);
  if (!user) return null;
  if (!hasActiveAccess(user)) {
    sendJson(response, 403, { error: "Subscription required. An active subscription is required to use this feature." });
    return null;
  }
  return user;
}

async function handleCreateAccount(request, response) {
  if (!requireDatabase(response)) return;

  try {
    const payload = await readJsonBody(request);
    const name = String(payload.name || "").trim();
    const email = normalizeEmail(payload.email);
    const password = String(payload.password || "");

    if (!name || !email || !password) {
      sendJson(response, 400, { error: "Name, email, and password are required." });
      return;
    }

    if (password.length < 8) {
      sendJson(response, 400, { error: "Password must be at least 8 characters." });
      return;
    }

    const passwordHash = hashPassword(password);
    const [result] = await dbPool.execute(
      "INSERT INTO users (name, email, password_hash) VALUES (:name, :email, :passwordHash)",
      { name, email, passwordHash }
    );
    const token = await createSession(result.insertId);
    const [rows] = await dbPool.execute("SELECT * FROM users WHERE id = :id LIMIT 1", { id: result.insertId });

    sendJsonWithHeaders(response, 201, { user: publicUser(rows[0]) }, { "Set-Cookie": getCookieHeader(request, token) });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      sendJson(response, 409, { error: "An account already exists with this email." });
      return;
    }
    sendJson(response, 500, { error: `Could not create account: ${error.message}` });
  }
}

async function handleSignIn(request, response) {
  if (!requireDatabase(response)) return;

  try {
    const payload = await readJsonBody(request);
    const email = normalizeEmail(payload.email);
    const password = String(payload.password || "");
    const [rows] = await dbPool.execute("SELECT * FROM users WHERE email = :email LIMIT 1", { email });
    const user = rows[0];

    if (!user || !verifyPassword(password, user.password_hash)) {
      sendJson(response, 401, { error: "Invalid email or password." });
      return;
    }

    if (user.status !== "active") {
      sendJson(response, 403, { error: "This account is disabled. Contact support." });
      return;
    }

    const token = await createSession(user.id);
    sendJsonWithHeaders(response, 200, { user: publicUser(user) }, { "Set-Cookie": getCookieHeader(request, token) });
  } catch (error) {
    sendJson(response, 500, { error: `Could not sign in: ${error.message}` });
  }
}

async function handleSignOut(request, response) {
  if (dbPool) {
    const token = parseCookies(request)[sessionCookieName];
    if (token) await dbPool.execute("DELETE FROM sessions WHERE id = :token", { token });
  }
  sendJsonWithHeaders(response, 200, { success: true }, { "Set-Cookie": [getClearCookieHeader(request), getClearTokenCookieHeader(request)] });
}

async function handlePasswordResetRequest(request, response) {
  if (!requireDatabase(response)) return;

  try {
    const payload = await readJsonBody(request);
    const email = normalizeEmail(payload.email);
    const neutralMessage = "If this email exists, a password reset link has been sent.";

    if (!email) {
      sendJson(response, 400, { error: "Email address is required." });
      return;
    }

    if (!checkResetRateLimit(request, email)) {
      sendJson(response, 429, { error: "Too many password reset requests. Please wait and try again." });
      return;
    }

    const [rows] = await dbPool.execute("SELECT id, email, status FROM users WHERE email = :email LIMIT 1", { email });
    const user = rows[0];

    if (user?.status === "active") {
      if (!hasSmtpConfig()) {
        console.error("Password reset SMTP is not configured.");
        sendJson(response, 503, { error: "Password reset email service is not configured. Please contact support." });
        return;
      }

      const token = randomBytes(32).toString("hex");
      const tokenHash = hashToken(token);
      const expiresAt = new Date(Date.now() + resetTokenMinutes * 60 * 1000);
      await dbPool.execute(
        "INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (:userId, :tokenHash, :expiresAt)",
        { userId: user.id, tokenHash, expiresAt }
      );

      const resetUrl = `${getPublicBaseUrl(request)}/reset-password?token=${encodeURIComponent(token)}`;
      try {
        await sendPasswordResetEmail(user.email, resetUrl);
      } catch (error) {
        console.error(`Password reset email failed: ${error.message}`);
        sendJson(response, 503, { error: "Password reset email service is not configured. Please contact support." });
        return;
      }
    }

    sendJson(response, 200, { message: neutralMessage });
  } catch (error) {
    console.error(`Password reset request failed: ${error.message}`);
    sendJson(response, 500, { error: "Could not send password reset email. Please contact support." });
  }
}

async function handlePasswordReset(request, response) {
  if (!requireDatabase(response)) return;

  try {
    const payload = await readJsonBody(request);
    const token = String(payload.token || "");
    const password = String(payload.password || "");

    if (!token || !password) {
      sendJson(response, 400, { error: "Reset token and new password are required." });
      return;
    }

    if (password.length < 8) {
      sendJson(response, 400, { error: "Password must be at least 8 characters." });
      return;
    }

    const tokenHash = hashToken(token);
    const [rows] = await dbPool.execute(
      `
        SELECT password_resets.id, password_resets.user_id
        FROM password_resets
        JOIN users ON users.id = password_resets.user_id
        WHERE password_resets.token_hash = :tokenHash
          AND password_resets.used_at IS NULL
          AND password_resets.expires_at > NOW()
          AND users.status = 'active'
        LIMIT 1
      `,
      { tokenHash }
    );

    const reset = rows[0];
    if (!reset) {
      sendJson(response, 400, { error: "This password reset link is invalid or expired." });
      return;
    }

    const passwordHash = hashPassword(password);
    await dbPool.execute("UPDATE users SET password_hash = :passwordHash WHERE id = :userId", {
      passwordHash,
      userId: reset.user_id
    });
    await dbPool.execute("UPDATE password_resets SET used_at = NOW() WHERE id = :id", { id: reset.id });
    await dbPool.execute("DELETE FROM sessions WHERE user_id = :userId", { userId: reset.user_id });

    sendJson(response, 200, { message: "Password updated successfully. Please sign in." });
  } catch (error) {
    console.error(`Password reset failed: ${error.message}`);
    sendJson(response, 500, { error: "Could not reset password. Please contact support." });
  }
}

async function handleCurrentUser(request, response) {
  if (!requireDatabase(response)) return;
  const user = await getSessionUser(request);
  sendJson(response, user ? 200 : 401, user ? { user: publicUser(user) } : { error: "Not signed in." });
}

async function handleAdminUsers(request, response) {
  if (!requireDatabase(response)) return;
  const admin = await requireAdmin(request, response);
  if (!admin) return;

  const [rows] = await dbPool.execute(
    `
      SELECT id, name, email, role, status, is_master, created_at
      FROM users
      WHERE is_master = 0
      ORDER BY created_at DESC
    `
  );
  sendJson(response, 200, { users: rows.map(publicUser) });
}

async function handleAdminUserUpdate(request, response) {
  if (!requireDatabase(response)) return;
  const admin = await requireAdmin(request, response);
  if (!admin) return;

  try {
    const payload = await readJsonBody(request);
    const userId = Number(payload.userId);
    const status = payload.status === "disabled" ? "disabled" : "active";

    if (!userId) {
      sendJson(response, 400, { error: "User ID is required." });
      return;
    }

    await dbPool.execute("UPDATE users SET status = :status WHERE id = :userId AND is_master = 0", { status, userId });
    sendJson(response, 200, { ok: true });
  } catch (error) {
    sendJson(response, 500, { error: `Could not update user: ${error.message}` });
  }
}

function roundMoney(value) {
  return Math.max(0, Math.round(Number(value) * 100) / 100);
}

function calculatePlanTotal(planType, couponCode = "") {
  const plan = plans[planType];
  if (!plan) {
    return { error: "Invalid plan selected." };
  }

  const normalizedCoupon = String(couponCode || "").trim().toUpperCase();
  const coupon = normalizedCoupon ? coupons[normalizedCoupon] : null;
  if (normalizedCoupon && !coupon) {
    return { error: "Invalid coupon code." };
  }
  if (coupon?.planType && coupon.planType !== planType) {
    return { error: "Invalid coupon code." };
  }

  let discountAmount = 0;
  if (coupon?.type === "percent") {
    discountAmount = roundMoney(plan.planPrice * (coupon.amount / 100));
  } else if (coupon?.type === "fixed") {
    discountAmount = roundMoney(coupon.amount);
  }

  const finalAmount = roundMoney(plan.planPrice - discountAmount);
  return {
    ...plan,
    couponCode: normalizedCoupon || null,
    discountAmount,
    finalAmount
  };
}

async function handleValidateCoupon(request, response) {
  try {
    const payload = await readJsonBody(request);
    const total = calculatePlanTotal(payload.planType, payload.couponCode);
    if (total.error) {
      sendJson(response, 400, { error: total.error });
      return;
    }
    sendJson(response, 200, total);
  } catch (error) {
    sendJson(response, 500, { error: "Could not validate coupon." });
  }
}

async function handleCreateCheckout(request, response) {
  const user = await requireSignedIn(request, response);
  if (!user) return;

  try {
    const payload = await readJsonBody(request);
    const total = calculatePlanTotal(payload.planType, payload.couponCode);
    if (total.error) {
      sendJson(response, 400, { error: total.error });
      return;
    }

    const [result] = await dbPool.execute(
      `
        INSERT INTO payments (user_id, plan_type, coupon_code, discount_amount, final_amount, payment_status)
        VALUES (:userId, :planType, :couponCode, :discountAmount, :finalAmount, 'pending')
      `,
      {
        userId: user.id,
        planType: total.planType,
        couponCode: total.couponCode,
        discountAmount: total.discountAmount,
        finalAmount: total.finalAmount
      }
    );

    sendJson(response, 200, {
      paymentId: result.insertId,
      stripePending: true,
      message: "Stripe integration pending. Payment has not been processed yet.",
      total
    });
  } catch (error) {
    sendJson(response, 500, { error: "Could not start payment." });
  }
}

async function handleApplyCoupon(request, response) {
  const user = await requireSignedIn(request, response);
  if (!user) return;

  try {
    const payload = await readJsonBody(request);
    const code = String(payload.code || "").trim().toUpperCase();
    const planType = String(payload.planType || "monthly").trim().toLowerCase();

    if (code !== "FREEALL") {
      sendJson(response, 400, { success: false, message: "Invalid coupon code." });
      return;
    }

    if (!plans[planType]) {
      sendJson(response, 400, { success: false, message: "Select a valid monthly or yearly plan." });
      return;
    }

    await dbPool.execute(
      `
        UPDATE users
        SET subscription_status = 'active',
            plan = :planType,
            plan_type = :planType,
            coupon_code = 'FREEALL',
            access_source = 'coupon',
            payment_status = 'coupon',
            has_full_access = 1,
            access_expires_at = NULL,
            subscription_started_at = NOW(),
            subscription_expires_at = NULL
        WHERE id = :userId
      `,
      { userId: user.id, planType }
    );

    await dbPool.execute(
      `
        INSERT INTO payments (user_id, plan_type, coupon_code, discount_amount, final_amount, payment_status)
        VALUES (:userId, :planType, 'FREEALL', 0, 0, 'coupon')
      `,
      { userId: user.id, planType }
    );

    sendJson(response, 200, {
      success: true,
      plan: planType,
      access: "full",
      message: "Coupon applied successfully. Your subscription is now active."
    });
  } catch (error) {
    sendJson(response, 500, { success: false, message: "Could not apply coupon." });
  }
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
    pdfDoc.setCreator("Ungating Pro Convert");
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
    pdfDoc.setCreator("Ungating Pro Convert");
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
  const user = await requireActiveAccess(request, response);
  if (!user) return;

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
    pdfDoc.setCreator("Ungating Pro");
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
  const appRoutes = new Set([
    "/",
    "/convert",
    "/signin",
    "/create-account",
    "/forgot-password",
    "/reset-password",
    "/subscription",
    "/coupon",
    "/builder",
    "/dashboard",
    "/account",
    "/history",
    "/admin",
    "/premium-tools",
    "/generate-package"
  ]);
  const requested = appRoutes.has(pathname) ? "/index.html" : pathname;
  const filePath = normalize(join(root, requested));
  const rootWithSeparator = root.endsWith(sep) ? root : `${root}${sep}`;
  return filePath === root || filePath.startsWith(rootWithSeparator) ? filePath : null;
}

const server = createServer(async (request, response) => {
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

  if (request.method === "GET" && url.pathname === "/favicon.ico") {
    try {
      await sendNoCacheFile(response, "favicon.ico");
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/favicon-ungatingpro.ico") {
    try {
      await sendNoCacheFile(response, "favicon-ungatingpro.ico");
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/favicon.png") {
    try {
      await sendNoCacheFile(response, "favicon.png");
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/favicon-ungatingpro.png") {
    try {
      await sendNoCacheFile(response, "favicon-ungatingpro.png");
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
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

  if (request.method === "POST" && url.pathname === "/api/auth/create-account") {
    await handleCreateAccount(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/sign-in") {
    await handleSignIn(request, response);
    return;
  }

  if (request.method === "POST" && (url.pathname === "/api/auth/sign-out" || url.pathname === "/api/auth/logout")) {
    await handleSignOut(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/request-password-reset") {
    await handlePasswordResetRequest(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/reset-password") {
    await handlePasswordReset(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/subscription/validate-coupon") {
    await handleValidateCoupon(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/subscription/create-checkout") {
    await handleCreateCheckout(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/apply-coupon") {
    await handleApplyCoupon(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/me") {
    await handleCurrentUser(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/admin/users") {
    await handleAdminUsers(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/users/update") {
    await handleAdminUserUpdate(request, response);
    return;
  }

  const filePath = getSafeStaticPath(url.pathname);
  if (!filePath) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    await sendFile(response, filePath);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

try {
  await initDatabase();
} catch (error) {
  console.error(`A2Z auth database failed to initialize: ${error.message}`);
}

server.listen(port, host, () => {
  console.log(`Ungating Pro running on port ${port}`);
});
