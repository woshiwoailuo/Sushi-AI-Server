#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const multer = require('multer');
const { ImageError, createImageService } = require('./lib/image-service');
const workshopLoaderHtml = require('./lib/workshop-loader');
const {
  openPostgres,
  migratePostgres,
  persistenceFromMode,
} = require('./lib/db-postgres');
const { normalizeChatPayload, collapseRepeatedText, normalizeChatModel, missingChatApiKeyMessage, configuredChatChannels, chatChannelLabel, buildKeyedChatRequest } = require('./lib/chat-response');

const SMTP_SECRET_FILE =
  process.env.SMTP_PASS_FILE ||
  '/home/box/agent-data/connector-secrets/d1a9ee04-b030-407c-82a6-ec2936e455df/smtp.json';

function loadSmtpPass() {
  if (process.env.SMTP_PASS) return process.env.SMTP_PASS;
  try {
    const parsed = JSON.parse(fs.readFileSync(SMTP_SECRET_FILE, 'utf8'));
    return parsed && typeof parsed.pass === 'string' ? parsed.pass : '';
  } catch (err) {
    console.warn('[mail] smtp secret file unreadable:', err.message);
    return '';
  }
}

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.163.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = loadSmtpPass();
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;
const SMTP_SECURE = process.env.SMTP_SECURE
  ? String(process.env.SMTP_SECURE) !== 'false'
  : SMTP_PORT === 465;

const PORT = Number(process.env.PORT || 8787);
const JWT_SECRET = process.env.JWT_SECRET || 'sushi-dev-secret';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@sushi.local').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin123!';
const CORS_ORIGINS = String(process.env.CORS_ORIGIN || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
// Vercel 的运行目录只读，临时数据必须写入 /tmp；本地/Render 继续使用持久目录。
const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL
  ? path.join('/tmp', 'sushi-data')
  : path.join(__dirname, 'data'));
const DB_PATH = path.join(DATA_DIR, 'app.db');
const PUBLIC_DIR = path.join(__dirname, 'public');
const APK_DIR = path.join(DATA_DIR, 'apk');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(APK_DIR)) fs.mkdirSync(APK_DIR, { recursive: true });

let dbMode = 'better-sqlite3';
let db;
let sqlJsSaveTimer = null;

function nowIso() {
  return new Date().toISOString();
}

function persistenceStatus() {
  return persistenceFromMode(dbMode, process.env);
}

function todayPrefix() {
  return new Date().toISOString().slice(0, 10);
}

class SqlJsAdapter {
  constructor(database) {
    this.database = database;
  }
  exec(sql) {
    this.database.run(sql);
  }
  prepare(sql) {
    const database = this.database;
    return {
      run(...params) {
        database.run(sql, params);
        const idRes = database.exec('SELECT last_insert_rowid() AS id');
        const lastInsertRowid = idRes[0] ? Number(idRes[0].values[0][0]) : 0;
        const ch = database.exec('SELECT changes() AS c');
        const changes = ch[0] ? Number(ch[0].values[0][0]) : 0;
        return { lastInsertRowid, changes };
      },
      get(...params) {
        const stmt = database.prepare(sql);
        stmt.bind(params);
        if (stmt.step()) {
          const row = stmt.getAsObject();
          stmt.free();
          return row;
        }
        stmt.free();
        return undefined;
      },
      all(...params) {
        const stmt = database.prepare(sql);
        stmt.bind(params);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
      },
    };
  }
}

/** Wrap sync SQLite adapters so callers can always `await db.prepare(...).get/run/all`. */
function wrapDbAsync(inner) {
  return {
    get database() {
      return inner.database;
    },
    exec(sql) {
      return Promise.resolve(inner.exec(sql));
    },
    prepare(sql) {
      const stmt = inner.prepare(sql);
      return {
        run: (...params) => Promise.resolve(stmt.run(...params)),
        get: (...params) => Promise.resolve(stmt.get(...params)),
        all: (...params) => Promise.resolve(stmt.all(...params)),
      };
    },
  };
}

function persistSqlJs() {
  if (dbMode !== 'sql.js') return;
  const data = db.database.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

async function openDatabase() {
  const databaseUrl = String(process.env.DATABASE_URL || '').trim();
  if (databaseUrl) {
    db = await openPostgres(databaseUrl);
    dbMode = 'postgres';
    console.log('[db] using Postgres via DATABASE_URL');
    return;
  }

  if (process.env.SUSHI_DB_MODE !== 'sql.js') {
    try {
      const Database = require('better-sqlite3');
      const raw = new Database(DB_PATH);
      raw.pragma('journal_mode = WAL');
      db = wrapDbAsync(raw);
      dbMode = 'better-sqlite3';
      return;
    } catch (err) {
      console.warn('[db] better-sqlite3 unavailable, falling back to sql.js:', err.message);
    }
  }

  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({
    locateFile(file) {
      return path.join(path.dirname(require.resolve('sql.js')), file);
    },
  });
  let fileBuf = null;
  if (fs.existsSync(DB_PATH)) {
    fileBuf = fs.readFileSync(DB_PATH);
  }
  const raw = fileBuf ? new SQL.Database(fileBuf) : new SQL.Database();
  db = wrapDbAsync(new SqlJsAdapter(raw));
  dbMode = 'sql.js';
  if (!process.env.VERCEL) {
    sqlJsSaveTimer = setInterval(persistSqlJs, 2000);
    // Do not keep test runners or graceful shutdowns alive just for a
    // best-effort SQLite flush.
    if (typeof sqlJsSaveTimer.unref === 'function') sqlJsSaveTimer.unref();
  }
}

async function exec(sql) {
  await db.exec(sql);
}

async function migrate() {
  if (dbMode === 'postgres') {
    await migratePostgres(db);
    return;
  }
  await exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      plan TEXT NOT NULL DEFAULT 'free',
      vip_until TEXT,
      gen_quota_daily INTEGER NOT NULL DEFAULT 10,
      banned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gen_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      kind TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      target_user_id INTEGER,
      note TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (admin_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_gen_logs_user_day ON gen_logs(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE TABLE IF NOT EXISTS email_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_email_codes_email ON email_codes(email);
  `);
  try {
    const cols = await db.prepare('PRAGMA table_info(users)').all();
    const names = new Set((cols || []).map((c) => c.name));
    if (!names.has('email_verified')) {
      await exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
    }
    if (!names.has('last_login_at')) {
      await exec('ALTER TABLE users ADD COLUMN last_login_at TEXT');
    }
    if (!names.has('last_ip')) {
      await exec('ALTER TABLE users ADD COLUMN last_ip TEXT');
    }
  } catch (err) {
    try {
      await exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
    } catch (err2) {
      /* column already exists */
    }
    try { await exec('ALTER TABLE users ADD COLUMN last_login_at TEXT'); } catch (e) {}
    try { await exec('ALTER TABLE users ADD COLUMN last_ip TEXT'); } catch (e) {}
  }
  await exec(`
    CREATE TABLE IF NOT EXISTS app_releases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_code INTEGER NOT NULL,
      version_name TEXT NOT NULL,
      notes TEXT,
      force_update INTEGER NOT NULL DEFAULT 0,
      apk_path TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      created_by INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_app_releases_code ON app_releases(version_code);
    CREATE TABLE IF NOT EXISTS workshop_tickets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      key_hex TEXT NOT NULL,
      iv_hex TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      tag TEXT NOT NULL,
      exp_ms INTEGER NOT NULL,
      key_used INTEGER NOT NULL DEFAULT 0,
      unlocks INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_workshop_tickets_exp ON workshop_tickets(exp_ms);
  `);
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const first = String(xff).split(',')[0].trim();
    if (first) return first;
  }
  return (req.ip || (req.socket && req.socket.remoteAddress) || '').toString();
}

async function recordLogin(userId, req) {
  await db.prepare('UPDATE users SET last_login_at = ?, last_ip = ? WHERE id = ?').run(
    nowIso(),
    clientIp(req),
    userId
  );
  persistSqlJs();
}

function smtpConfigured() {
  return !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

async function sendVerifyEmail(to, code) {
  if (!smtpConfigured()) {
    console.warn('[mail] SMTP_HOST/SMTP_USER/SMTP_PASS missing, skip send (code stored)');
    return false;
  }
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465 ? true : SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { minVersion: 'TLSv1.2' },
  });
  const subject = '苏轼AI 验证码';
  const text = '您的验证码是 ' + code + '，10 分钟有效。';
  const html =
    '<p>您的苏轼AI 验证码是 <b style="font-size:20px;">' +
    code +
    '</b></p><p>10 分钟有效。如非本人操作请忽略此邮件。</p>';
  await transporter.sendMail({
    from: SMTP_FROM || SMTP_USER,
    to,
    subject,
    text,
    html,
  });
  return true;
}

function genSixDigit() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

async function lastCodeCreatedAt(email) {
  const row = await db.prepare('SELECT created_at FROM email_codes WHERE email = ? ORDER BY id DESC LIMIT 1')
    .get(email);
  return row && row.created_at ? Date.parse(row.created_at) : 0;
}

async function resendTooSoon(email) {
  const t = await lastCodeCreatedAt(email);
  return t && Date.now() - t < 60000;
}

async function storeVerifyCode(email) {
  const code = genSixDigit();
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await db.prepare(
    'INSERT INTO email_codes (email, code, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).run(email, code, expires, nowIso());
  persistSqlJs();
  let mail_sent = false;
  try {
    mail_sent = !!(await sendVerifyEmail(email, code));
  } catch (err) {
    console.warn('[mail] send failed:', err && err.message ? err.message : err);
  }
  return { code, mail_sent };
}

async function seedAdmin() {
  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL);
  if (existing) {
    await db.prepare('UPDATE users SET email_verified = 1 WHERE email = ?').run(ADMIN_EMAIL);
    persistSqlJs();
    return;
  }
  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  await db.prepare(
    `INSERT INTO users (email, password_hash, display_name, role, plan, vip_until, gen_quota_daily, banned, email_verified, created_at)
     VALUES (?, ?, ?, 'admin', 'vip', ?, 9999, 0, 1, ?)`
  ).run(ADMIN_EMAIL, hash, '管理员', new Date(Date.now() + 365 * 86400000).toISOString(), nowIso());
  persistSqlJs();
  console.log('[seed] admin user created:', ADMIN_EMAIL);
}

function signToken(user) {
  return jwt.sign({ uid: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
}


function parseCookieHeader(header) {
  const out = {};
  if (!header) return out;
  String(header).split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    let v = part.slice(i + 1).trim();
    try {
      v = decodeURIComponent(v);
    } catch {
      /* keep raw */
    }
    if (k) out[k] = v;
  });
  return out;
}

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    const t = header.slice(7).trim();
    if (t) return t;
  }
  const cookies = parseCookieHeader(req.headers.cookie);
  if (cookies.sushi_token) return cookies.sushi_token;
  return null;
}

async function userFromToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(payload.uid);
    return user || null;
  } catch {
    return null;
  }
}

function setAuthCookie(res, token) {
  // Secure on HTTPS so iOS Safari keeps the session cookie for same-origin iframe workshop fetches.
  const secure = String(process.env.VERCEL || process.env.NODE_ENV || '').length > 0 || process.env.FORCE_SECURE_COOKIE === '1'
    ? '; Secure'
    : '';
  res.setHeader('Set-Cookie', 'sushi_token=' + token + '; HttpOnly; Path=/; SameSite=Lax' + secure + '; Max-Age=2592000');
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    role: row.role,
    plan: row.plan,
    vip_until: row.vip_until || null,
    gen_quota_daily: row.gen_quota_daily,
    banned: !!row.banned,
    email_verified: !!row.email_verified,
    created_at: row.created_at,
    last_login_at: row.last_login_at || null,
    last_ip: row.last_ip || null,
  };
}

async function usedToday(userId) {
  const prefix = todayPrefix();
  const row = await db.prepare('SELECT COUNT(*) AS c FROM gen_logs WHERE user_id = ? AND created_at LIKE ?')
    .get(userId, prefix + '%');
  return Number(row && row.c ? row.c : 0);
}

async function remainingQuota(user) {
  const used = await usedToday(user.id);
  return Math.max(0, Number(user.gen_quota_daily) - used);
}

async function authMiddleware(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: '未登录' });
    const user = await userFromToken(token);
    if (!user) return res.status(401).json({ error: '登录已过期' });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

function adminMiddleware(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
}

async function audit(adminId, action, targetUserId, note) {
  await db.prepare(
    'INSERT INTO audit_logs (admin_id, action, target_user_id, note, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(adminId, action, targetUserId || null, note || '', nowIso());
  persistSqlJs();
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(cors({
  origin(origin, callback) {
    // Same-origin and native Android requests normally have no Origin header.
    if (!origin || CORS_ORIGINS.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use('/api/images', express.json({ limit: '12mb' }));
app.use(express.json({ limit: '6mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.post('/api/auth/register', rateLimit('register', 5, 15 * 60_000), async (req, res) => {
  const email = String((req.body && req.body.email) || '')
    .trim()
    .toLowerCase();
  const password = String((req.body && req.body.password) || '');
  const display_name = String((req.body && req.body.display_name) || '').trim();
  if (!email || !email.includes('@')) return res.status(400).json({ error: '邮箱格式不正确' });
  if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  if (!display_name) return res.status(400).json({ error: '请填写显示名' });
  const dup = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (dup) return res.status(409).json({ error: '该邮箱已注册' });
  const hash = bcrypt.hashSync(password, 10);
  await db.prepare(
    `INSERT INTO users (email, password_hash, display_name, role, plan, vip_until, gen_quota_daily, banned, email_verified, created_at)
       VALUES (?, ?, ?, 'user', 'free', NULL, 10, 0, 0, ?)`
  ).run(email, hash, display_name, nowIso());
  persistSqlJs();
  const { mail_sent } = await storeVerifyCode(email);
  if (mail_sent) {
    return res.json({ ok: true, need_verify: true, email, mail_sent: true });
  }
  return res.json({
    ok: true,
    need_verify: true,
    email,
    mail_sent: false,
    error: '验证码邮件发送失败，请稍后重试或联系馆主通过验证',
  });
});

app.post('/api/auth/verify', async (req, res) => {
  const email = String((req.body && req.body.email) || '')
    .trim()
    .toLowerCase();
  const code = String((req.body && req.body.code) || '').trim();
  if (!email || !code) return res.status(400).json({ error: '请填写邮箱和验证码' });
  const row = await db.prepare('SELECT * FROM email_codes WHERE email = ? AND code = ? ORDER BY id DESC LIMIT 1')
    .get(email, code);
  if (!row) return res.status(400).json({ error: '验证码错误' });
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ error: '验证码已过期' });
  }
  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(400).json({ error: '验证码错误' });
  await db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(user.id);
  await db.prepare('DELETE FROM email_codes WHERE email = ?').run(email);
  persistSqlJs();
  await recordLogin(user.id, req);
  const updated = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  const token = signToken(updated);
  setAuthCookie(res, token);
  res.json({ token, user: publicUser(updated) });
});

app.post('/api/auth/resend', rateLimit('resend', 5, 15 * 60_000), async (req, res) => {
  const email = String((req.body && req.body.email) || '')
    .trim()
    .toLowerCase();
  const user = email ? await db.prepare('SELECT * FROM users WHERE email = ?').get(email) : null;
  if (user && !user.email_verified) {
    if (await resendTooSoon(email)) {
      return res.status(429).json({ error: '请 60 秒后再试' });
    }
    const { mail_sent } = await storeVerifyCode(email);
    if (!mail_sent) {
      return res.json({
        ok: true,
        need_verify: true,
        mail_sent: false,
        error: '验证码邮件发送失败，请稍后重试或联系馆主通过验证',
      });
    }
    return res.json({ ok: true, mail_sent: true });
  }
  res.json({ ok: true });
});

app.post('/api/auth/login', rateLimit('login', 12, 15 * 60_000), async (req, res) => {
  const email = String((req.body && req.body.email) || '')
    .trim()
    .toLowerCase();
  const password = String((req.body && req.body.password) || '');
  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '邮箱或密码错误' });
  }
  if (user.banned) return res.status(403).json({ error: '账号已被封禁' });
  if (!user.email_verified) {
    return res.status(403).json({ error: '请先验证邮箱', need_verify: true });
  }
  await recordLogin(user.id, req);
  const updated = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  const token = signToken(updated);
  setAuthCookie(res, token);
  res.json({ token, user: publicUser(updated) });
});

app.get('/api/me', authMiddleware, async (req, res) => {
  res.json({ user: publicUser(req.user), remaining: await remainingQuota(req.user) });
});

app.post('/api/me/password', authMiddleware, async (req, res) => {
  const current = String((req.body && req.body.current_password) || '');
  const next = String((req.body && req.body.new_password) || '');
  if (!bcrypt.compareSync(current, req.user.password_hash)) {
    return res.status(400).json({ error: '当前密码不正确' });
  }
  if (next.length < 6) return res.status(400).json({ error: '新密码至少 6 位' });
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(next, 10), req.user.id);
  persistSqlJs();
  res.json({ ok: true });
});

app.get('/api/me/quota', authMiddleware, async (req, res) => {
  const used = await usedToday(req.user.id);
  const remaining = await remainingQuota(req.user);
  res.json({
    remaining,
    used,
    daily: req.user.gen_quota_daily,
    plan: req.user.plan,
    vip_until: req.user.vip_until,
  });
});


const images = createImageService({
  apiKey: process.env.HORDE_API_KEY || '0000000000',
  model: process.env.HORDE_MODEL || '',
  async reserve(userId) {
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user || user.banned) throw new ImageError('账号不可用', 403, 'ACCOUNT_DISABLED');
    if (!user.email_verified) throw new ImageError('请先验证邮箱', 403, 'VERIFY_EMAIL');
    if ((await remainingQuota(user)) <= 0) throw new ImageError('今日额度已用尽', 402, 'QUOTA_EMPTY');
    const result = await db.prepare('INSERT INTO gen_logs (user_id, created_at, kind) VALUES (?, ?, ?)')
      .run(userId, nowIso(), 'image_pending');
    persistSqlJs();
    return Number(result.lastInsertRowid);
  },
  async refund(id, userId) {
    await db.prepare("DELETE FROM gen_logs WHERE id = ? AND user_id = ? AND kind = 'image_pending'").run(id, userId);
    persistSqlJs();
  },
  async commit(id, userId) {
    await db.prepare("UPDATE gen_logs SET kind = 'image' WHERE id = ? AND user_id = ? AND kind = 'image_pending'").run(id, userId);
    persistSqlJs();
  },
});

function imageAccount(req, res, next) {
  if (req.user.banned) return res.status(403).json({ error: '账号已被封禁' });
  if (!req.user.email_verified) return res.status(403).json({ error: '请先验证邮箱' });
  res.setHeader('Cache-Control', 'no-store');
  next();
}

function imageRoute(handler) {
  return (req, res) => Promise.resolve().then(() => handler(req, res)).catch((error) => {
    if (!res.headersSent && !res.destroyed) res.status(error.status || 500).json({
      error: error instanceof ImageError ? error.message : '生成服务暂时不可用，请稍后重试',
      code: error.code || 'SERVER_ERROR',
    });
  });
}

app.get('/api/images/config', authMiddleware, imageAccount, (req, res) => {
  res.json({ provider: 'horde', free: true, maxWaitSeconds: 600, race: ['turbo', 'flux', 'flux-realism', 'sana', 'horde', 'perchance'] });
});
app.get('/api/images/current', authMiddleware, imageAccount, (req, res) => res.json({ job: images.current(req.user.id) }));
app.post('/api/images', authMiddleware, imageAccount, imageRoute(async (req, res) => {
  const job = await images.create(req.user.id, req.body);
  if (res.destroyed) { await images.cancel(req.user.id, job.id); return; }
  res.status(202).json(job);
}));
app.get('/api/images/:id', authMiddleware, imageAccount, imageRoute(async (req, res) => res.json(await images.get(req.user.id, req.params.id))));
app.delete('/api/images/:id', authMiddleware, imageAccount, imageRoute(async (req, res) => res.json(await images.cancel(req.user.id, req.params.id))));

app.get('/assets/workshop-generation.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLIC_DIR, 'assets', 'workshop-generation.js'));
});

app.post('/api/gen/check', authMiddleware, async (req, res) => {
  if (req.user.banned) return res.status(403).json({ error: '账号已被封禁' });
  const remaining = await remainingQuota(req.user);
  if (remaining <= 0) return res.status(402).json({ error: '今日额度已用尽', remaining: 0 });
  await db.prepare('INSERT INTO gen_logs (user_id, created_at, kind) VALUES (?, ?, ?)').run(
    req.user.id,
    nowIso(),
    'image'
  );
  persistSqlJs();
  res.json({ ok: true, remaining: remaining - 1 });
});

app.get('/api/admin/stats', authMiddleware, adminMiddleware, async (req, res) => {
  const users = await db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const vip = await db.prepare("SELECT COUNT(*) AS c FROM users WHERE plan = 'vip'").get().c;
  const banned = await db.prepare('SELECT COUNT(*) AS c FROM users WHERE banned = 1').get().c;
  const gensToday = await db.prepare('SELECT COUNT(*) AS c FROM gen_logs WHERE created_at LIKE ?')
    .get(todayPrefix() + '%').c;
  res.json({
    users: Number(users),
    vip: Number(vip),
    banned: Number(banned),
    gens_today: Number(gensToday),
  });
});

app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const filter = String(req.query.filter || 'all');
  const limit = 20;
  const offset = (page - 1) * limit;
  let where = '1=1';
  const params = [];
  if (q) {
    where += ' AND (email LIKE ? OR display_name LIKE ?)';
    params.push('%' + q + '%', '%' + q + '%');
  }
  if (filter === 'vip') where += " AND plan = 'vip'";
  if (filter === 'banned') where += ' AND banned = 1';
  if (filter === 'free') where += " AND plan = 'free'";
  const total = await db.prepare('SELECT COUNT(*) AS c FROM users WHERE ' + where).get(...params).c;
  const rows = await db.prepare(
      'SELECT * FROM users WHERE ' + where + ' ORDER BY id DESC LIMIT ? OFFSET ?'
    )
    .all(...params, limit, offset);
  res.json({
    page,
    total: Number(total),
    pages: Math.ceil(Number(total) / limit) || 1,
    users: rows.map(publicUser),
  });
});


app.get('/api/admin/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const id = Number(req.params.id);
  const target = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  const gen_logs = await db.prepare('SELECT * FROM gen_logs WHERE user_id = ? ORDER BY id DESC LIMIT 50')
    .all(id);
  const audit_logs = await db.prepare(
      `SELECT a.*, u.email AS admin_email, t.email AS target_email
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.admin_id
       LEFT JOIN users t ON t.id = a.target_user_id
       WHERE a.target_user_id = ? OR a.admin_id = ?
       ORDER BY a.id DESC LIMIT 30`
    )
    .all(id, id);
  res.json({
    user: publicUser(target),
    remaining: await remainingQuota(target),
    gen_logs,
    audit_logs,
    email_verified: !!target.email_verified,
    last_login_at: target.last_login_at || null,
    last_ip: target.last_ip || null,
    created_at: target.created_at,
  });
});

const apkUpload = multer({
  dest: APK_DIR,
  limits: { fileSize: 80 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const name = String(file.originalname || '').toLowerCase();
    const mime = String(file.mimetype || '');
    const ok =
      name.endsWith('.apk') ||
      mime === 'application/vnd.android.package-archive' ||
      mime === 'application/octet-stream';
    if (!ok) return cb(new Error('仅支持 APK 文件'));
    cb(null, true);
  },
});

async function latestRelease() {
  return await db.prepare('SELECT * FROM app_releases ORDER BY version_code DESC, id DESC LIMIT 1').get();
}

function releasePublic(row) {
  if (!row) return { versionCode: 0 };
  return {
    versionCode: Number(row.version_code),
    versionName: row.version_name,
    notes: row.notes || '',
    force: !!row.force_update,
    size: Number(row.size_bytes || 0),
    url: '/api/app/download',
  };
}

app.post('/api/admin/app/release', authMiddleware, adminMiddleware, (req, res) => {
  apkUpload.single('file')(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'APK 不能超过 80MB' : err.message || '上传失败';
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: '请选择 APK 文件' });
    const version_code = parseInt(req.body.version_code, 10);
    const version_name = String(req.body.version_name || '').trim();
    const notes = String(req.body.notes || '').trim();
    const force = String(req.body.force || '0') === '1' || req.body.force === true || req.body.force === 'true' ? 1 : 0;
    if (!Number.isInteger(version_code) || version_code <= 0) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.status(400).json({ error: '版本号必须是正整数' });
    }
    if (!version_name) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.status(400).json({ error: '请填写版本名' });
    }
    const destName = 'v' + version_code + '-' + Date.now() + '.apk';
    const dest = path.join(APK_DIR, destName);
    fs.renameSync(req.file.path, dest);
    const size_bytes = fs.statSync(dest).size;
    await db.prepare(
      `INSERT INTO app_releases (version_code, version_name, notes, force_update, apk_path, size_bytes, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(version_code, version_name, notes, force, dest, size_bytes, nowIso(), req.user.id);
    persistSqlJs();
    await audit(req.user.id, 'app_release', null, version_name + ' (' + version_code + ')');
    const row = await db.prepare('SELECT * FROM app_releases ORDER BY id DESC LIMIT 1').get();
    res.json({ ok: true, release: row });
  });
});

app.get('/api/admin/app/releases', authMiddleware, adminMiddleware, async (req, res) => {
  const rows = await db.prepare('SELECT * FROM app_releases ORDER BY id DESC LIMIT 100').all();
  res.json({
    releases: rows.map((r) => ({
      id: r.id,
      version_code: r.version_code,
      version_name: r.version_name,
      notes: r.notes,
      force_update: r.force_update,
      size_bytes: r.size_bytes,
      created_at: r.created_at,
      created_by: r.created_by,
    })),
  });
});

app.get('/api/app/version', async (req, res) => {
  res.json(releasePublic(await latestRelease()));
});

app.get('/api/app/download', async (req, res) => {
  const row = await latestRelease();
  if (!row || !row.apk_path || !fs.existsSync(row.apk_path)) {
    return res.status(404).json({ error: '暂无安装包' });
  }
  const fname = '苏轼AI-' + (row.version_name || row.version_code) + '.apk';
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader(
    'Content-Disposition',
    "attachment; filename=\"sushi-ai.apk\"; filename*=UTF-8''" + encodeURIComponent(fname)
  );
  res.sendFile(path.resolve(row.apk_path));
});

app.get('/api/health', (req, res) => {
  const persistence = persistenceStatus();
  let warning;
  if (!persistence.durable) {
    warning = 'Vercel 临时盘不会持久保存会员数据，请配置 DATABASE_URL（Neon/Postgres）';
  } else if (persistence.persistence_flag_ignored) {
    warning = '已设置 SUSHI_DB_PERSISTENCE=external 但未启用 Postgres；请配置 DATABASE_URL';
  }
  res.status(200).json({
    ok: true,
    db: persistence,
    mail: smtpConfigured(),
    warning,
    chat: configuredChatChannels(process.env),
  });
});


app.patch('/api/admin/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const id = Number(req.params.id);
  const target = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  const body = req.body || {};
  const fields = [];
  const values = [];
  const allowed = ['plan', 'vip_until', 'gen_quota_daily', 'banned', 'role', 'display_name', 'email_verified'];
  for (const key of allowed) {
    if (body[key] === undefined) continue;
    fields.push(key + ' = ?');
    if (key === 'banned' || key === 'email_verified') values.push(body[key] ? 1 : 0);
    else if (key === 'gen_quota_daily') values.push(Number(body[key]));
    else values.push(body[key]);
  }
  if (!fields.length) return res.status(400).json({ error: '没有可更新的字段' });
  values.push(id);
  await db.prepare('UPDATE users SET ' + fields.join(', ') + ' WHERE id = ?').run(...values);
  persistSqlJs();
  await audit(req.user.id, 'patch_user', id, JSON.stringify(body));
  const updated = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json({ user: publicUser(updated) });
});

app.post('/api/admin/users/:id/verify', authMiddleware, adminMiddleware, async (req, res) => {
  const id = Number(req.params.id);
  const target = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  await db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(id);
  persistSqlJs();
  await audit(req.user.id, 'verify_user', id, 'manual');
  const updated = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json({ user: publicUser(updated) });
});

app.post('/api/admin/users/:id/grant-vip', authMiddleware, adminMiddleware, async (req, res) => {
  const id = Number(req.params.id);
  const days = Math.max(1, Number((req.body && req.body.days) || 30));
  const target = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  const base = target.vip_until && new Date(target.vip_until) > new Date()
    ? new Date(target.vip_until)
    : new Date();
  const until = new Date(base.getTime() + days * 86400000).toISOString();
  await db.prepare("UPDATE users SET plan = 'vip', vip_until = ?, gen_quota_daily = 9999 WHERE id = ?").run(
    until,
    id
  );
  persistSqlJs();
  await audit(req.user.id, 'grant_vip', id, days + ' days');
  const updated = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json({ user: publicUser(updated) });
});

app.get('/api/admin/logs', authMiddleware, adminMiddleware, async (req, res) => {
  const rows = await db.prepare(
      `SELECT a.*, u.email AS admin_email, t.email AS target_email
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.admin_id
       LEFT JOIN users t ON t.id = a.target_user_id
       ORDER BY a.id DESC LIMIT 100`
    )
    .all();
  res.json({ logs: rows });
});


const WORKSHOP_FILE = path.join(PUBLIC_DIR, 'workshop.html');
// The workshop is decrypted in the client, but image requests can legitimately
// wait several minutes in a public queue. Keep the short-lived ticket while
// allowing a normal generation round to finish.
const TICKET_TTL_MS = 10 * 60_000;
const workshopTickets = new Map();
const rateBuckets = new Map();

function rateLimit(bucket, max, windowMs) {
  return (req, res, next) => {
    const key = bucket + ':' + clientIp(req);
    const now = Date.now();
    const old = rateBuckets.get(key);
    const state = old && now - old.startedAt < windowMs
      ? old
      : { startedAt: now, count: 0 };
    state.count += 1;
    rateBuckets.set(key, state);
    if (state.count > max) return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
    next();
  };
}

setInterval(() => {
  const cutoff = Date.now() - 15 * 60_000;
  for (const [key, state] of rateBuckets) {
    if (state.startedAt < cutoff) rateBuckets.delete(key);
  }
}, 5 * 60_000).unref();

const WORKSHOP_401 = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>请先登录</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0c0e10;color:#d7f56a;font-family:system-ui,sans-serif}
  a{color:#d7f56a}
  .box{max-width:28rem;padding:2rem;text-align:center}
</style>
</head>
<body>
  <div class="box">
    <h1>请先登录苏轼AI</h1>
    <p><a href="/">返回首页</a></p>
  </div>
</body>
</html>`;

function sweepTickets() {
  const now = Date.now();
  for (const [id, ticket] of workshopTickets) {
    if (!ticket || ticket.exp <= now) workshopTickets.delete(id);
  }
}

// Memoize workshop.html bytes by mtime so ticket mint does not re-read ~150KB on every open.
let workshopPlainCache = { mtimeMs: -1, buf: null };

function readWorkshopPlaintext() {
  const st = fs.statSync(WORKSHOP_FILE);
  if (!workshopPlainCache.buf || workshopPlainCache.mtimeMs !== st.mtimeMs) {
    workshopPlainCache = { mtimeMs: st.mtimeMs, buf: fs.readFileSync(WORKSHOP_FILE) };
  }
  return workshopPlainCache.buf;
}

function encryptWorkshopHtml() {
  const plaintext = readWorkshopPlaintext();
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { key, iv, ct, tag };
}

function rowToTicket(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: row.user_id,
    key: row.key_hex,
    iv: row.iv_hex,
    ciphertext: row.ciphertext,
    tag: row.tag,
    exp: Number(row.exp_ms),
    keyUsed: !!Number(row.key_used),
    unlocks: Number(row.unlocks) || 0,
  };
}

async function persistTicket(ticket) {
  workshopTickets.set(String(ticket.id), ticket);
  try {
    await db.prepare(
      `INSERT INTO workshop_tickets
        (id, user_id, key_hex, iv_hex, ciphertext, tag, exp_ms, key_used, unlocks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         key_hex = excluded.key_hex,
         iv_hex = excluded.iv_hex,
         ciphertext = excluded.ciphertext,
         tag = excluded.tag,
         exp_ms = excluded.exp_ms,
         key_used = excluded.key_used,
         unlocks = excluded.unlocks`
    ).run(
      String(ticket.id),
      String(ticket.userId),
      ticket.key,
      ticket.iv,
      ticket.ciphertext,
      ticket.tag,
      ticket.exp,
      ticket.keyUsed ? 1 : 0,
      ticket.unlocks || 0
    );
  } catch (err) {
    // Persistence is best-effort; in-memory still works on single-instance hosts.
    console.warn('[workshop-ticket] persist failed:', err && err.message ? err.message : err);
  }
}

async function touchTicket(ticket) {
  workshopTickets.set(String(ticket.id), ticket);
  try {
    await db.prepare(
      'UPDATE workshop_tickets SET unlocks = ?, key_used = ? WHERE id = ?'
    ).run(ticket.unlocks || 0, ticket.keyUsed ? 1 : 0, String(ticket.id));
  } catch (err) {
    console.warn('[workshop-ticket] touch failed:', err && err.message ? err.message : err);
  }
}

async function getLiveTicket(id) {
  if (!id) return null;
  sweepTickets();
  const key = String(id);
  let ticket = workshopTickets.get(key);
  if (ticket && ticket.exp <= Date.now()) {
    workshopTickets.delete(key);
    ticket = null;
  }
  if (!ticket) {
    try {
      const row = await db.prepare('SELECT * FROM workshop_tickets WHERE id = ?').get(key);
      ticket = rowToTicket(row);
      if (ticket && ticket.exp <= Date.now()) {
        await db.prepare('DELETE FROM workshop_tickets WHERE id = ?').run(key);
        ticket = null;
      } else if (ticket) {
        workshopTickets.set(key, ticket);
      }
    } catch (err) {
      ticket = null;
    }
  }
  return ticket || null;
}


async function createWorkshopTicket(userId) {
  sweepTickets();
  const enc = encryptWorkshopHtml();
  const id = crypto.randomBytes(32).toString('hex');
  const ticket = {
    id,
    userId,
    key: enc.key.toString('hex'),
    iv: enc.iv.toString('hex'),
    ciphertext: enc.ct.toString('base64'),
    tag: enc.tag.toString('base64'),
    exp: Date.now() + TICKET_TTL_MS,
    keyUsed: false,
    unlocks: 0,
  };
  await persistTicket(ticket);
  return ticket;
}

async function getWorkshopAccess(req, ticketId) {
  const ticket = await getLiveTicket(ticketId);
  if (ticket) return ticket;
  // WebView/browser image requests cannot add the Android Bearer header after
  // the page is loaded. A valid login cookie is therefore a safe fallback for
  // an expired or lost query-string ticket; public requests remain blocked.
  const user = await userFromToken(extractToken(req));
  if (user && !user.banned) return { userId: user.id, authFallback: true };
  return null;
}

async function sendWorkshopLoader(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const k = String((req.query && req.query.k) || '');
  const user = await userFromToken(extractToken(req));

  // Best reliability for logged-in web: serve plaintext workshop.html directly.
  // Encrypted ticket loader remains available when ?k= is present and valid
  // (Android WebView / legacy clients).
  if (user && !user.banned && !k) {
    res.status(200).type('html').send(readWorkshopPlaintext());
    return;
  }

  const ticket = k ? await getLiveTicket(k) : null;
  if (!ticket) {
    if (user && !user.banned) {
      // Cross-instance / expired ticket but session still valid → open without AES.
      res.status(200).type('html').send(readWorkshopPlaintext());
      return;
    }
    res.status(401).type('html').send(WORKSHOP_401);
    return;
  }
  res.status(200).type('html').send(workshopLoaderHtml(ticket));
}

app.post('/api/workshop/ticket', authMiddleware, async (req, res) => {
  if (req.user.banned) return res.status(403).json({ error: '账号已被封禁' });
  const ticket = await createWorkshopTicket(req.user.id);
  res.json({
    ticket: ticket.id,
    key: ticket.key,
    iv: ticket.iv,
    expires_in: Math.floor(TICKET_TTL_MS / 1000),
  });
});

app.get('/api/workshop/blob', async (req, res) => {
  const ticket = await getLiveTicket(String((req.query && req.query.k) || ''));
  if (!ticket) return res.status(404).json({ error: 'not found' });
  res.json({ iv: ticket.iv, ct: ticket.ciphertext, tag: ticket.tag });
});

app.post('/api/workshop/session', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const ticket = await getLiveTicket(String((req.body && req.body.ticket) || ''));
  const key = String((req.body && req.body.key) || '');
  if (!ticket || !/^[0-9a-f]{64}$/i.test(key)) {
    return res.status(401).json({ error: '进入凭证已过期，请返回后重新进入' });
  }
  try {
    if (!crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(ticket.key, 'hex'))) {
      return res.status(401).json({ error: '进入凭证已过期，请返回后重新进入' });
    }
  } catch (e) {
    return res.status(401).json({ error: '进入凭证已过期，请返回后重新进入' });
  }
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(ticket.userId);
  if (!user || user.banned) return res.status(403).json({ error: '账号不可用' });
  if (!user.email_verified) return res.status(403).json({ error: '请先验证邮箱' });
  setAuthCookie(res, signToken(user));
  res.json({ ok: true });
});

app.post('/api/workshop/unlock', authMiddleware, async (req, res) => {
  const id = String((req.body && req.body.ticket) || '');
  const ticket = await getLiveTicket(id);
  if (!ticket) return res.status(404).json({ error: '工坊票据无效或已过期' });
  // Postgres BIGINT ids may arrive as string while JWT/other paths use number.
  if (String(ticket.userId) !== String(req.user.id)) {
    return res.status(403).json({ error: '无权解锁' });
  }
  if (ticket.unlocks >= 3) return res.status(403).json({ error: '解锁次数已用尽' });
  ticket.unlocks += 1;
  ticket.keyUsed = true;
  await touchTicket(ticket);
  res.json({ key: ticket.key, iv: ticket.iv });
});

const IMAGE_MODELS = new Set(['turbo', 'flux', 'flux-realism', 'sana', 'perchance']);
const CHAT_MODELS = new Set(['openai', 'openai-fast', 'turbo', 'deepseek', 'horde', 'grok', 'xai', 'groq', 'gemini', 'google', 'google-gemini', 'openrouter', 'open-router', 'glm', 'zhipu', 'zhipuai', 'chatglm', 'zai', 'z-ai']);
const DEEPSEEK_API_KEY = String(process.env.DEEPSEEK_API_KEY || '').trim();
const DEEPSEEK_MODEL = String(process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash').trim();
const XAI_API_KEY = String(process.env.XAI_API_KEY || process.env.GROK_API_KEY || '').trim();
const GROK_MODEL = String(process.env.GROK_MODEL || process.env.XAI_MODEL || 'grok-4-fast').trim() || 'grok-4-fast';
// Groq free-tier friendly default: openai/gpt-oss-20b (llama-3.1-8b-instant shut down for free/dev Aug 2026).
const GROQ_API_KEY = String(process.env.GROQ_API_KEY || '').trim();
const GROQ_MODEL = String(process.env.GROQ_MODEL || 'openai/gpt-oss-20b').trim() || 'openai/gpt-oss-20b';
const GEMINI_API_KEY = String(process.env.GEMINI_API_KEY || '').trim();
const GEMINI_MODEL = String(process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite').trim() || 'gemini-2.5-flash-lite';
const OPENROUTER_API_KEY = String(process.env.OPENROUTER_API_KEY || '').trim();
const OPENROUTER_MODEL = String(process.env.OPENROUTER_MODEL || 'openrouter/free').trim() || 'openrouter/free';
const GLM_API_KEY = String(process.env.GLM_API_KEY || process.env.ZHIPUAI_API_KEY || process.env.ZAI_API_KEY || process.env.ZHIPU_API_KEY || '').trim();
const GLM_MODEL = String(process.env.GLM_MODEL || 'glm-4.7-flash').trim() || 'glm-4.7-flash';
const GLM_BASE_URL = String(process.env.GLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4/chat/completions').trim() || 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const HORDE_TEXT_API_KEY = String(process.env.HORDE_API_KEY || '0000000000').trim() || '0000000000';
const HORDE_TEXT_CLIENT = 'sushi-club:1.1.21:https://aihorde.net';

function workshopImageError(res, status, error) {
  res.status(status).json({ error });
}

function messagesToHordePrompt(messages) {
  const parts = [];
  for (const item of messages) {
    if (!item || !item.content) continue;
    const role = String(item.role || 'user').toLowerCase();
    const content = String(item.content).trim();
    if (!content) continue;
    if (role === 'system') parts.push('### System:\n' + content);
    else if (role === 'assistant') parts.push('### Assistant:\n' + content);
    else parts.push('### Instruction:\n' + content);
  }
  parts.push('### Assistant:\n');
  return parts.join('\n\n').slice(0, 6000);
}

function openaiStyleChat(content, model) {
  return {
    id: 'sushi-horde-' + Date.now(),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model || 'horde',
    choices: [{
      index: 0,
      message: { role: 'assistant', content: String(content || '').trim() },
      finish_reason: 'stop',
    }],
  };
}

async function chatViaHordeText(messages, signal) {
  const prompt = messagesToHordePrompt(messages);
  if (!prompt.trim()) throw Object.assign(new Error('对话内容不能为空'), { status: 400 });
  const accepted = await fetch('https://aihorde.net/api/v2/generate/text/async', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      apikey: HORDE_TEXT_API_KEY,
      'Client-Agent': HORDE_TEXT_CLIENT,
    },
    body: JSON.stringify({
      prompt,
      params: {
        max_length: 220,
        max_context_length: 2048,
        temperature: 0.7,
      },
      nsfw: false,
    }),
  });
  const acceptedJson = await accepted.json().catch(() => ({}));
  if (!accepted.ok || !acceptedJson.id) {
    const detail = String((acceptedJson && (acceptedJson.message || acceptedJson.error)) || '').slice(0, 120);
    throw Object.assign(
      new Error(detail ? ('Horde 未受理：' + detail) : 'Horde 对话通道繁忙，请稍后重试'),
      { status: accepted.status === 429 ? 429 : 502 }
    );
  }
  for (let i = 0; i < 24; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (signal && signal.aborted) throw Object.assign(new Error('对话服务器超时'), { status: 504, name: 'AbortError' });
    const status = await fetch('https://aihorde.net/api/v2/generate/text/status/' + encodeURIComponent(acceptedJson.id), {
      signal,
      headers: {
        apikey: HORDE_TEXT_API_KEY,
        'Client-Agent': HORDE_TEXT_CLIENT,
      },
    });
    const statusJson = await status.json().catch(() => ({}));
    if (statusJson && statusJson.faulted) {
      throw Object.assign(new Error('Horde 对话生成失败'), { status: 502 });
    }
    const text = statusJson && statusJson.generations && statusJson.generations[0] && statusJson.generations[0].text;
    if (statusJson && statusJson.done && text) {
      const cleaned = collapseRepeatedText(String(text).replace(/^[\s\S]*### Assistant:\s*/m, '').trim());
      if (cleaned.length < 1) throw Object.assign(new Error('Horde 返回空回复'), { status: 502 });
      return openaiStyleChat(cleaned, 'horde');
    }
  }
  throw Object.assign(new Error('Horde 对话排队超时，请稍后重试'), { status: 504 });
}

function normalizeImageModel(raw) {
  const model = String(raw || 'turbo').trim().toLowerCase();
  if (model === 'flux-real' || model === 'flux_realism') return 'flux-realism';
  if (model === 'zimage' || model === 'sdxl' || model === 'krea2' || model === 'liblib') return 'flux';
  if (model === 'anishort') return 'sana';
  if (model === 'perch' || model === '官方') return 'perchance';
  return model;
}

function pollinationsModelFor(model) {
  // Perchance.org 被 Cloudflare + SAMEORIGIN 拦住，应用内 Perch 走 Flux 写实同源代理。
  if (model === 'perchance') return 'flux-realism';
  return model;
}

app.post('/api/workshop/chat', async (req, res) => {
  const access = await getWorkshopAccess(req, String((req.body && req.body.k) || ''));
  if (!access) return workshopImageError(res, 401, '未登录或工坊票据无效，请刷新后重试');
  const requestedRaw = String((req.body && req.body.model) || 'openai').trim();
  const requested = requestedRaw.toLowerCase();
  if (!CHAT_MODELS.has(requested)) {
    return workshopImageError(res, 400, '不支持的对话模型');
  }
  const model = normalizeChatModel(requested);
  if (!['deepseek', 'openai', 'horde', 'grok', 'groq', 'gemini', 'openrouter', 'glm'].includes(model)) {
    return workshopImageError(res, 400, '不支持的对话模型');
  }
  const messages = Array.isArray(req.body && req.body.messages) ? req.body.messages.slice(-48) : [];
  if (!messages.length) return workshopImageError(res, 400, '对话内容不能为空');
  if (model === 'deepseek' && !DEEPSEEK_API_KEY) {
    return workshopImageError(res, 503, missingChatApiKeyMessage('deepseek'));
  }
  if (model === 'grok' && !XAI_API_KEY) {
    return workshopImageError(res, 503, missingChatApiKeyMessage('grok'));
  }
  if (model === 'groq' && !GROQ_API_KEY) {
    return workshopImageError(res, 503, missingChatApiKeyMessage('groq'));
  }
  if (model === 'gemini' && !GEMINI_API_KEY) {
    return workshopImageError(res, 503, missingChatApiKeyMessage('gemini'));
  }
  if (model === 'openrouter' && !OPENROUTER_API_KEY) {
    return workshopImageError(res, 503, missingChatApiKeyMessage('openrouter'));
  }
  if (model === 'glm' && !GLM_API_KEY) {
    return workshopImageError(res, 503, missingChatApiKeyMessage('glm'));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), model === 'horde' ? 35_000 : 18_000);
  try {
    if (model === 'horde') {
      const payload = await chatViaHordeText(messages, controller.signal);
      return res.status(200).json(payload);
    }

    const keyed = buildKeyedChatRequest(model, messages, {
      groqKey: GROQ_API_KEY,
      groqModel: GROQ_MODEL,
      geminiKey: GEMINI_API_KEY,
      geminiModel: GEMINI_MODEL,
      openrouterKey: OPENROUTER_API_KEY,
      openrouterModel: OPENROUTER_MODEL,
      xaiKey: XAI_API_KEY,
      grokModel: GROK_MODEL,
      deepseekKey: DEEPSEEK_API_KEY,
      deepseekModel: DEEPSEEK_MODEL,
      glmKey: GLM_API_KEY,
      glmModel: GLM_MODEL,
      glmBase: GLM_BASE_URL,
    });
    const endpoint = keyed.endpoint;
    const requestBody = keyed.body;
    const authHeader = keyed.headers || {};
    let upstream = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Referer: 'https://sushi-ai-server.vercel.app/',
        ...authHeader,
      },
      body: JSON.stringify(requestBody),
    });
    let body = await upstream.text();
    // One short retry for transient Pollinations flaps (avoid long hangs on hard 402).
    if (model === 'openai' && (upstream.status === 429 || upstream.status >= 500)) {
      await new Promise((r) => setTimeout(r, 500));
      upstream = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Referer: 'https://sushi-ai-server.vercel.app/',
        },
        body: JSON.stringify(requestBody),
      });
      body = await upstream.text();
    }
    if (!upstream.ok) {
      let detail = '';
      try {
        const parsed = JSON.parse(body);
        detail = String((parsed && (parsed.error && (parsed.error.message || parsed.error.type) || parsed.error)) || '').slice(0, 160);
      } catch (error) {
        detail = String(body || '').replace(/\s+/g, ' ').slice(0, 160);
      }
      if (upstream.status === 402) {
        return workshopImageError(res, 402, '快速对话通道暂时需要付费额度，请改用 Horde 或其他通道');
      }
      if (upstream.status === 429) {
        return workshopImageError(res, 429, chatChannelLabel(model) + '通道繁忙，请稍后重试');
      }
      const label = chatChannelLabel(model);
      const status = upstream.status === 401 ? 401 : 502;
      return workshopImageError(res, status, `${label}暂时不可用${detail ? '：' + detail : ''}，请改用其他通道`);
    }
    const normalized = normalizeChatPayload(body, model);
    res.status(200).json(normalized);
  } catch (error) {
    if (error && error.status) return workshopImageError(res, error.status, error.message || '对话失败');
    return workshopImageError(res, 504, error && error.name === 'AbortError' ? '对话服务器超时，请稍后重试' : '对话服务器连接失败');
  } finally {
    clearTimeout(timer);
  }
});


// Homepage chat image: auth cookie/JWT only — never requires opening /workshop or minting an HTML ticket.
app.post('/api/chat/image', authMiddleware, async (req, res) => {
  if (req.user.banned) return workshopImageError(res, 403, '账号已被封禁');
  const model = normalizeImageModel((req.body && req.body.model) || 'flux-realism');
  if (!IMAGE_MODELS.has(model)) return workshopImageError(res, 400, '不支持的生图模型');
  const prompt = String((req.body && req.body.prompt) || '').trim().slice(0, 1600);
  if (!prompt) return workshopImageError(res, 400, '提示词不能为空');
  const width = Math.min(1024, Math.max(256, Number(req.body && req.body.width) || 768));
  const height = Math.min(1024, Math.max(256, Number(req.body && req.body.height) || 768));
  let seed = Number.isFinite(Number(req.body && req.body.seed)) ? Math.trunc(Number(req.body.seed)) : Math.floor(Math.random() * 2147483646);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  const tryOnce = async (attempt) => {
    const upstream = new URL(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`);
    upstream.searchParams.set('model', pollinationsModelFor(model));
    upstream.searchParams.set('width', String(width));
    upstream.searchParams.set('height', String(height));
    upstream.searchParams.set('seed', String(seed + attempt * 97));
    upstream.searchParams.set('nologo', 'true');
    upstream.searchParams.set('enhance', 'false');
    upstream.searchParams.set('safe', 'false');
    const upstreamResponse = await fetch(upstream, {
      signal: controller.signal,
      headers: {
        Accept: 'image/*',
        Referer: 'https://sushi-ai-server.vercel.app/',
      },
    });
    if (!upstreamResponse.ok || !upstreamResponse.body) {
      const err = new Error(upstreamResponse.status === 429 ? '生图通道繁忙，请稍后重试' : (`上游生图服务返回 ${upstreamResponse.status}`));
      err.status = upstreamResponse.status === 429 ? 429 : (upstreamResponse.status || 502);
      throw err;
    }
    const contentType = String(upstreamResponse.headers.get('content-type') || '');
    if (contentType && !contentType.includes('image/')) {
      const err = new Error('上游未返回图片');
      err.status = 502;
      throw err;
    }
    const buf = Buffer.from(await upstreamResponse.arrayBuffer());
    if (!buf.length || buf.length < 2500) {
      const err = new Error('上游图片过小或无效');
      err.status = 502;
      throw err;
    }
    return { buf, contentType: contentType || 'image/jpeg' };
  };
  try {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const got = await tryOnce(attempt);
        const mime = got.contentType.split(';')[0].trim() || 'image/jpeg';
        return res.status(200).json({
          ok: true,
          model,
          channel: model === 'flux-realism' ? 'Flux写实' : model,
          contentType: mime,
          url: 'data:' + mime + ';base64,' + got.buf.toString('base64'),
        });
      } catch (error) {
        lastError = error;
        if (error && error.name === 'AbortError') break;
        if (error && error.status === 429) {
          return workshopImageError(res, 429, '生图通道繁忙，请稍后重试');
        }
        if (attempt < 2) await new Promise((r) => setTimeout(r, 450 + attempt * 350));
      }
    }
    if (lastError && lastError.name === 'AbortError') {
      return workshopImageError(res, 504, '生图超时，请稍后重试');
    }
    return workshopImageError(res, (lastError && lastError.status) || 502, (lastError && lastError.message) || '生图失败，请换描述再试');
  } catch (error) {
    return workshopImageError(res, 504, error && error.name === 'AbortError' ? '生图超时，请稍后重试' : '生图服务连接失败');
  } finally {
    clearTimeout(timer);
  }
});

// Same-origin image proxy for the workshop fallback engines. Keeping this on
// the server avoids WebView CORS/referrer failures and prevents the browser
// from talking to an arbitrary URL supplied by page input.
app.get('/api/workshop/image', async (req, res) => {
  const access = await getWorkshopAccess(req, String((req.query && req.query.k) || ''));
  if (!access) return workshopImageError(res, 401, '未登录或工坊票据无效，请刷新后重试');

  const model = normalizeImageModel(req.query.model || 'turbo');
  if (!IMAGE_MODELS.has(model)) return workshopImageError(res, 400, '不支持的生图模型');

  const prompt = String(req.query.prompt || '').trim().slice(0, 1600);
  if (!prompt) return workshopImageError(res, 400, '提示词不能为空');

  const width = Math.min(1024, Math.max(256, Number(req.query.width) || 768));
  const height = Math.min(1024, Math.max(256, Number(req.query.height) || 768));
  let seed = Number.isFinite(Number(req.query.seed)) ? Math.trunc(Number(req.query.seed)) : Math.floor(Math.random() * 2147483646);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  const tryOnce = async (attempt) => {
    const upstream = new URL(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`);
    upstream.searchParams.set('model', pollinationsModelFor(model));
    upstream.searchParams.set('width', String(width));
    upstream.searchParams.set('height', String(height));
    upstream.searchParams.set('seed', String(seed + attempt * 97));
    upstream.searchParams.set('nologo', 'true');
    upstream.searchParams.set('enhance', 'false');
    upstream.searchParams.set('safe', 'false');
    const upstreamResponse = await fetch(upstream, {
      signal: controller.signal,
      headers: {
        Accept: 'image/*',
        Referer: 'https://sushi-ai-server.vercel.app/',
      },
    });
    if (!upstreamResponse.ok || !upstreamResponse.body) {
      const err = new Error(`上游生图服务返回 ${upstreamResponse.status}`);
      err.status = upstreamResponse.status;
      throw err;
    }
    const contentType = String(upstreamResponse.headers.get('content-type') || '');
    if (contentType && !contentType.includes('image/')) {
      const err = new Error('上游未返回图片');
      err.status = 502;
      throw err;
    }
    const buf = Buffer.from(await upstreamResponse.arrayBuffer());
    // Reject tiny / queue-placeholder payloads that look successful but are unusable.
    if (!buf.length || buf.length < 2500) {
      const err = new Error('上游图片过小或无效');
      err.status = 502;
      throw err;
    }
    return { buf, contentType: contentType || 'image/jpeg' };
  };
  try {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const got = await tryOnce(attempt);
        res.status(200);
        res.set('Content-Type', got.contentType);
        res.set('Cache-Control', 'no-store');
        res.set('X-Sushi-Image-Proxy', model === 'perchance' ? 'perchance' : 'pollinations');
        res.set('X-Sushi-Image-Model', model);
        return res.end(got.buf);
      } catch (error) {
        lastError = error;
        if (error && error.name === 'AbortError') break;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 450 + attempt * 350));
      }
    }
    if (lastError && lastError.name === 'AbortError') {
      return workshopImageError(res, 504, '备用生图服务超时');
    }
    return workshopImageError(res, (lastError && lastError.status) || 502, (lastError && lastError.message) || '备用生图失败');
  } catch (error) {
    if (!res.headersSent) workshopImageError(res, 504, error && error.name === 'AbortError' ? '备用生图服务超时' : '备用生图服务连接失败');
    else res.destroy(error);
  } finally {
    clearTimeout(timer);
  }
});

app.post('/api/workshop/horde-image', async (req, res) => {
  const access = await getWorkshopAccess(req, String((req.body && req.body.k) || ''));
  if (!access) return workshopImageError(res, 401, '工坊票据无效或已过期，请刷新工坊');
  const prompt = String((req.body && req.body.prompt) || '').trim().slice(0, 1600);
  if (!prompt) return workshopImageError(res, 400, '提示词不能为空');
  const width = Math.min(768, Math.max(512, Number(req.body.width) || 512));
  const height = Math.min(768, Math.max(512, Number(req.body.height) || 512));
  const seed = Number.isFinite(Number(req.body.seed)) ? Math.trunc(Number(req.body.seed)) : undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const accepted = await fetch('https://aihorde.net/api/v2/generate/async', {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', apikey: '0000000000', 'Client-Agent': 'woshisushi:1.1.24:server-horde-image' },
      body: JSON.stringify({ prompt, nsfw: true, censor_nsfw: false, params: { n: 1, width, height, steps: 15, ...(seed === undefined ? {} : { seed: String(seed) }) } }),
    });
    const acceptedJson = await accepted.json().catch(() => ({}));
    if (!accepted.ok || !acceptedJson.id) return workshopImageError(res, accepted.status === 429 ? 429 : 502, 'Horde 生图服务器未受理请求');
    for (let i = 0; i < 48; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (controller.signal.aborted) break;
      const status = await fetch('https://aihorde.net/api/v2/generate/status/' + encodeURIComponent(acceptedJson.id), { signal: controller.signal, headers: { apikey: '0000000000', 'Client-Agent': 'woshisushi:1.1.24:server-horde-image' } });
      const statusJson = await status.json().catch(() => ({}));
      if (statusJson && statusJson.faulted) return workshopImageError(res, 502, 'Horde 生图服务器生成失败');
      const image = statusJson && statusJson.generations && statusJson.generations[0] && statusJson.generations[0].img;
      if (image) { res.set('Cache-Control', 'no-store'); return res.json({ url: image, provider: 'aihorde' }); }
    }
    return workshopImageError(res, 504, 'Horde 生图服务器排队超时');
  } catch (error) {
    return workshopImageError(res, 504, error && error.name === 'AbortError' ? 'Horde 生图服务器超时' : 'Horde 生图服务器连接失败');
  } finally { clearTimeout(timer); }
});

function decodeImageDataUrl(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=\s]+)$/i);
  return match ? match[1].replace(/\s+/g, '') : '';
}

app.post('/api/workshop/img2img', async (req, res) => {
  const access = await getWorkshopAccess(req, String((req.body && req.body.k) || ''));
  if (!access) return workshopImageError(res, 401, '工坊票据无效或已过期，请刷新工坊');

  const sourceImage = decodeImageDataUrl(req.body && req.body.image);
  if (!sourceImage || sourceImage.length > 5_000_000) {
    return workshopImageError(res, 400, '参考图无效或过大，请重新选择图片');
  }
  const prompt = String((req.body && req.body.prompt) || '').trim().slice(0, 1600);
  if (!prompt) return workshopImageError(res, 400, '提示词不能为空');
  const width = Math.min(1024, Math.max(256, Number(req.body.width) || 768));
  const height = Math.min(1024, Math.max(256, Number(req.body.height) || 768));
  const strength = Math.min(0.95, Math.max(0.05, Number(req.body.strength) || 0.52));
  const seed = Number.isFinite(Number(req.body.seed)) ? Math.trunc(Number(req.body.seed)) : undefined;
  const body = {
    prompt,
    source_image: sourceImage,
    source_processing: 'img2img',
    nsfw: false,
    censor_nsfw: true,
    params: {
      n: 1,
      width,
      height,
      steps: 20,
      denoising_strength: strength,
      ...(seed === undefined ? {} : { seed: String(seed) }),
    },
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const accepted = await fetch('https://aihorde.net/api/v2/generate/async', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        apikey: '0000000000',
        'Client-Agent': 'woshisushi:1.0:server-img2img',
      },
      body: JSON.stringify(body),
    });
    const acceptedJson = await accepted.json().catch(() => ({}));
    if (!accepted.ok || !acceptedJson.id) {
      return workshopImageError(res, 502, '图生图服务器未受理请求');
    }
    for (let i = 0; i < 75; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const status = await fetch(`https://aihorde.net/api/v2/generate/status/${encodeURIComponent(acceptedJson.id)}`, {
        signal: controller.signal,
        headers: {
          apikey: '0000000000',
          'Client-Agent': 'woshisushi:1.0:server-img2img',
        },
      });
      const statusJson = await status.json().catch(() => ({}));
      const image = statusJson && statusJson.generations && statusJson.generations[0] && statusJson.generations[0].img;
      if (statusJson.faulted) return workshopImageError(res, 502, '图生图服务器生成失败');
      if (image) {
        res.set('Cache-Control', 'no-store');
        return res.json({ url: image, provider: 'aihorde' });
      }
    }
    return workshopImageError(res, 504, '图生图服务器排队超时');
  } catch (error) {
    return workshopImageError(res, 504, error && error.name === 'AbortError' ? '图生图服务器超时' : '图生图服务器连接失败');
  } finally {
    clearTimeout(timer);
  }
});

app.get('/workshop', sendWorkshopLoader);
app.get('/workshop/', sendWorkshopLoader);
app.get('/workshop.html', sendWorkshopLoader);

app.get('/admin', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin', 'index.html'));
});
app.use('/admin', express.static(path.join(PUBLIC_DIR, 'admin')));
app.use('/', express.static(path.join(PUBLIC_DIR, 'app')));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: '接口不存在' });
  res.sendFile(path.join(PUBLIC_DIR, 'app', 'index.html'));
});

async function initialize() {
  await openDatabase();
  await migrate();
  await seedAdmin();
  try { await db.prepare("DELETE FROM gen_logs WHERE kind = 'image_pending'").run(); } catch (e) {}
  persistSqlJs();
}

async function main() {
  await initialize();
  return new Promise((resolve, reject) => {
    const maintenance = setInterval(() => { try { void images.sweep(); } catch (e) {} }, 30_000);
    if (maintenance.unref) maintenance.unref();
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log('[sushi-club] listening on http://0.0.0.0:' + PORT);
      console.log('[sushi-club] db mode:', dbMode);
      console.log('[sushi-club] JWT_SECRET is', process.env.JWT_SECRET ? 'from env' : 'default sushi-dev-secret (override in production)');
      console.log('[sushi-club] SMTP is', smtpConfigured() ? 'configured' : 'missing (codes stored, email skipped)');
      resolve(server);
    });
    server.once('error', reject);
  });
}

process.on('SIGINT', () => {
  persistSqlJs();
  if (sqlJsSaveTimer) clearInterval(sqlJsSaveTimer);
  process.exit(0);
});

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  let ready = null;
  const vercelHandler = async function vercelHandler(req, res) {
    if (!ready) ready = initialize();
    try {
      await ready;
    } catch (error) {
      ready = null;
      console.error('[vercel] startup failed:', error && error.stack ? error.stack : error);
      return res.status(500).json({
        error: '服务启动失败，请稍后重试',
        detail: String(error && error.message ? error.message : error).slice(0, 240),
      });
    }
    return app(req, res);
  };
  // Keep the HTTP function as the default export while retaining the local
  // server entrypoint used by tests and start.js.
  vercelHandler.main = main;
  vercelHandler.app = app;
  module.exports = vercelHandler;
}
