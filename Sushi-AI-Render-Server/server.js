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

const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

const SMTP_SECRET_FILE =
  process.env.SMTP_PASS_FILE || '';

function loadSmtpPass() {
  if (process.env.SMTP_PASS) return process.env.SMTP_PASS;
  if (!SMTP_SECRET_FILE) return '';
  try {
    const parsed = JSON.parse(fs.readFileSync(SMTP_SECRET_FILE, 'utf8'));
    return parsed && typeof parsed.pass === 'string' ? parsed.pass : '';
  } catch (err) {
    console.warn('[mail] smtp secret file unreadable:', err.message);
    return '';
  }
}

const SMTP_HOST = process.env.SMTP_HOST || '';
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
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
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

function persistSqlJs() {
  if (dbMode !== 'sql.js') return;
  const data = db.database.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

async function openDatabase() {
  try {
    const Database = require('better-sqlite3');
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    dbMode = 'better-sqlite3';
    return;
  } catch (err) {
    console.warn('[db] better-sqlite3 unavailable, falling back to sql.js:', err.message);
  }
  const walPath = DB_PATH + '-wal';
  if (fs.existsSync(walPath) && fs.statSync(walPath).size > 0) {
    throw new Error('数据库有尚未合并的 WAL 文件。请先用原 SQLite 驱动正常关闭数据库并完成 checkpoint，再使用 sql.js；不要删除 WAL 文件。');
  }
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  let fileBuf = null;
  if (fs.existsSync(DB_PATH)) {
    fileBuf = fs.readFileSync(DB_PATH);
  }
  const raw = fileBuf ? new SQL.Database(fileBuf) : new SQL.Database();
  db = new SqlJsAdapter(raw);
  dbMode = 'sql.js';
  sqlJsSaveTimer = setInterval(persistSqlJs, 2000);
}

function exec(sql) {
  if (dbMode === 'sql.js') db.exec(sql);
  else db.exec(sql);
}

function migrate() {
  exec(`
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
    const cols = db.prepare('PRAGMA table_info(users)').all();
    const names = new Set((cols || []).map((c) => c.name));
    if (!names.has('email_verified')) {
      exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
    }
    if (!names.has('last_login_at')) {
      exec('ALTER TABLE users ADD COLUMN last_login_at TEXT');
    }
    if (!names.has('last_ip')) {
      exec('ALTER TABLE users ADD COLUMN last_ip TEXT');
    }
  } catch (err) {
    try {
      exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
    } catch (err2) {
      /* column already exists */
    }
    try { exec('ALTER TABLE users ADD COLUMN last_login_at TEXT'); } catch (e) {}
    try { exec('ALTER TABLE users ADD COLUMN last_ip TEXT'); } catch (e) {}
  }
  exec(`
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

function recordLogin(userId, req) {
  db.prepare('UPDATE users SET last_login_at = ?, last_ip = ? WHERE id = ?').run(
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
    return;
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
}

function genSixDigit() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function lastCodeCreatedAt(email) {
  const row = db
    .prepare('SELECT created_at FROM email_codes WHERE email = ? ORDER BY id DESC LIMIT 1')
    .get(email);
  return row && row.created_at ? Date.parse(row.created_at) : 0;
}

function resendTooSoon(email) {
  const t = lastCodeCreatedAt(email);
  return t && Date.now() - t < 60000;
}

function storeVerifyCode(email) {
  const code = genSixDigit();
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  db.prepare(
    'INSERT INTO email_codes (email, code, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).run(email, code, expires, nowIso());
  persistSqlJs();
  sendVerifyEmail(email, code).catch((err) => {
    console.warn('[mail] send failed:', err.message);
  });
  return code;
}

function seedAdmin() {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL);
  if (existing) {
    db.prepare('UPDATE users SET email_verified = 1 WHERE email = ?').run(ADMIN_EMAIL);
    persistSqlJs();
    return;
  }
  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  db.prepare(
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

function userFromToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.uid);
    return user || null;
  } catch {
    return null;
  }
}

function setAuthCookie(res, token) {
  res.setHeader('Set-Cookie', 'sushi_token=' + token + '; HttpOnly; Path=/; SameSite=Lax' + (res.req.secure ? '; Secure' : ''));
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

function usedToday(userId) {
  const prefix = todayPrefix();
  const row = db
    .prepare('SELECT COUNT(*) AS c FROM gen_logs WHERE user_id = ? AND created_at LIKE ?')
    .get(userId, prefix + '%');
  return Number(row && row.c ? row.c : 0);
}

function remainingQuota(user) {
  const used = usedToday(user.id);
  return Math.max(0, Number(user.gen_quota_daily) - used);
}

function authMiddleware(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: '未登录' });
  const user = userFromToken(token);
  if (!user) return res.status(401).json({ error: '登录已过期' });
  req.user = user;
  next();
}

function adminMiddleware(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
}

function audit(adminId, action, targetUserId, note) {
  db.prepare(
    'INSERT INTO audit_logs (admin_id, action, target_user_id, note, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(adminId, action, targetUserId || null, note || '', nowIso());
  persistSqlJs();
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(cors({ origin: true, credentials: true, allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use('/api/images', express.json({ limit: '12mb' }));
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.post('/api/auth/register', (req, res) => {
  const email = String((req.body && req.body.email) || '')
    .trim()
    .toLowerCase();
  const password = String((req.body && req.body.password) || '');
  const display_name = String((req.body && req.body.display_name) || '').trim();
  if (!email || !email.includes('@')) return res.status(400).json({ error: '邮箱格式不正确' });
  if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  if (!display_name) return res.status(400).json({ error: '请填写显示名' });
  const dup = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (dup) return res.status(409).json({ error: '该邮箱已注册' });
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(
    `INSERT INTO users (email, password_hash, display_name, role, plan, vip_until, gen_quota_daily, banned, email_verified, created_at)
       VALUES (?, ?, ?, 'user', 'free', NULL, 10, 0, 0, ?)`
  ).run(email, hash, display_name, nowIso());
  persistSqlJs();
  storeVerifyCode(email);
  res.json({ ok: true, need_verify: true, email });
});

app.post('/api/auth/verify', (req, res) => {
  const email = String((req.body && req.body.email) || '')
    .trim()
    .toLowerCase();
  const code = String((req.body && req.body.code) || '').trim();
  if (!email || !code) return res.status(400).json({ error: '请填写邮箱和验证码' });
  const row = db
    .prepare('SELECT * FROM email_codes WHERE email = ? AND code = ? ORDER BY id DESC LIMIT 1')
    .get(email, code);
  if (!row) return res.status(400).json({ error: '验证码错误' });
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return res.status(400).json({ error: '验证码已过期' });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(400).json({ error: '验证码错误' });
  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(user.id);
  db.prepare('DELETE FROM email_codes WHERE email = ?').run(email);
  persistSqlJs();
  recordLogin(user.id, req);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  const token = signToken(updated);
  setAuthCookie(res, token);
  res.json({ token, user: publicUser(updated) });
});

app.post('/api/auth/resend', (req, res) => {
  const email = String((req.body && req.body.email) || '')
    .trim()
    .toLowerCase();
  const user = email ? db.prepare('SELECT * FROM users WHERE email = ?').get(email) : null;
  if (user && !user.email_verified) {
    if (resendTooSoon(email)) {
      return res.status(429).json({ error: '请 60 秒后再试' });
    }
    storeVerifyCode(email);
  }
  res.json({ ok: true });
});

app.post('/api/auth/login', (req, res) => {
  const email = String((req.body && req.body.email) || '')
    .trim()
    .toLowerCase();
  const password = String((req.body && req.body.password) || '');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '邮箱或密码错误' });
  }
  if (user.banned) return res.status(403).json({ error: '账号已被封禁' });
  if (!user.email_verified) {
    return res.status(403).json({ error: '请先验证邮箱', need_verify: true });
  }
  recordLogin(user.id, req);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  const token = signToken(updated);
  setAuthCookie(res, token);
  res.json({ token, user: publicUser(updated) });
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ user: publicUser(req.user), remaining: remainingQuota(req.user) });
});

app.post('/api/me/password', authMiddleware, (req, res) => {
  const current = String((req.body && req.body.current_password) || '');
  const next = String((req.body && req.body.new_password) || '');
  if (!bcrypt.compareSync(current, req.user.password_hash)) {
    return res.status(400).json({ error: '当前密码不正确' });
  }
  if (next.length < 6) return res.status(400).json({ error: '新密码至少 6 位' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(next, 10), req.user.id);
  persistSqlJs();
  res.json({ ok: true });
});

app.get('/api/me/quota', authMiddleware, (req, res) => {
  const used = usedToday(req.user.id);
  const remaining = remainingQuota(req.user);
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
  reserve(userId) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user || user.banned) throw new ImageError('账号不可用', 403, 'ACCOUNT_DISABLED');
    if (!user.email_verified) throw new ImageError('请先验证邮箱', 403, 'VERIFY_EMAIL');
    if (remainingQuota(user) <= 0) throw new ImageError('今日额度已用尽', 402, 'QUOTA_EMPTY');
    const result = db.prepare('INSERT INTO gen_logs (user_id, created_at, kind) VALUES (?, ?, ?)')
      .run(userId, nowIso(), 'image_pending');
    persistSqlJs();
    return Number(result.lastInsertRowid);
  },
  refund(id, userId) {
    db.prepare("DELETE FROM gen_logs WHERE id = ? AND user_id = ? AND kind = 'image_pending'").run(id, userId);
    persistSqlJs();
  },
  commit(id, userId) {
    db.prepare("UPDATE gen_logs SET kind = 'image' WHERE id = ? AND user_id = ? AND kind = 'image_pending'").run(id, userId);
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
  let official = 'https://perchance.org/ai-text-to-image-generator';
  try {
    const configured = new URL(process.env.PERCHANCE_URL || official);
    if (configured.protocol === 'https:' && configured.hostname === 'perchance.org' && !configured.username && !configured.password) official = configured.href;
  } catch { /* keep the official generator */ }
  res.json({ provider: 'horde', free: true, maxWaitSeconds: 600, perchanceUrl: official });
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

app.post('/api/gen/check', authMiddleware, (req, res) => {
  if (req.user.banned) return res.status(403).json({ error: '账号已被封禁' });
  const remaining = remainingQuota(req.user);
  if (remaining <= 0) return res.status(402).json({ error: '今日额度已用尽', remaining: 0 });
  db.prepare('INSERT INTO gen_logs (user_id, created_at, kind) VALUES (?, ?, ?)').run(
    req.user.id,
    nowIso(),
    'image'
  );
  persistSqlJs();
  res.json({ ok: true, remaining: remaining - 1 });
});

app.get('/api/admin/stats', authMiddleware, adminMiddleware, (req, res) => {
  const users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const vip = db.prepare("SELECT COUNT(*) AS c FROM users WHERE plan = 'vip'").get().c;
  const banned = db.prepare('SELECT COUNT(*) AS c FROM users WHERE banned = 1').get().c;
  const gensToday = db
    .prepare('SELECT COUNT(*) AS c FROM gen_logs WHERE created_at LIKE ?')
    .get(todayPrefix() + '%').c;
  res.json({
    users: Number(users),
    vip: Number(vip),
    banned: Number(banned),
    gens_today: Number(gensToday),
  });
});

app.get('/api/admin/users', authMiddleware, adminMiddleware, (req, res) => {
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
  const total = db.prepare('SELECT COUNT(*) AS c FROM users WHERE ' + where).get(...params).c;
  const rows = db
    .prepare(
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


app.get('/api/admin/users/:id', authMiddleware, adminMiddleware, (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  const gen_logs = db
    .prepare('SELECT * FROM gen_logs WHERE user_id = ? ORDER BY id DESC LIMIT 50')
    .all(id);
  const audit_logs = db
    .prepare(
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
    remaining: remainingQuota(target),
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

function latestRelease() {
  return db.prepare('SELECT * FROM app_releases ORDER BY version_code DESC, id DESC LIMIT 1').get();
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
  apkUpload.single('file')(req, res, (err) => {
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
    db.prepare(
      `INSERT INTO app_releases (version_code, version_name, notes, force_update, apk_path, size_bytes, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(version_code, version_name, notes, force, dest, size_bytes, nowIso(), req.user.id);
    persistSqlJs();
    audit(req.user.id, 'app_release', null, version_name + ' (' + version_code + ')');
    const row = db.prepare('SELECT * FROM app_releases ORDER BY id DESC LIMIT 1').get();
    res.json({ ok: true, release: row });
  });
});

app.get('/api/admin/app/releases', authMiddleware, adminMiddleware, (req, res) => {
  const rows = db.prepare('SELECT * FROM app_releases ORDER BY id DESC LIMIT 100').all();
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

app.get('/api/app/version', (req, res) => {
  res.json(releasePublic(latestRelease()));
});

app.get('/api/app/download', (req, res) => {
  const row = latestRelease();
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


app.patch('/api/admin/users/:id', authMiddleware, adminMiddleware, (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
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
  db.prepare('UPDATE users SET ' + fields.join(', ') + ' WHERE id = ?').run(...values);
  persistSqlJs();
  audit(req.user.id, 'patch_user', id, JSON.stringify(body));
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json({ user: publicUser(updated) });
});

app.post('/api/admin/users/:id/verify', authMiddleware, adminMiddleware, (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(id);
  persistSqlJs();
  audit(req.user.id, 'verify_user', id, 'manual');
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json({ user: publicUser(updated) });
});

app.post('/api/admin/users/:id/grant-vip', authMiddleware, adminMiddleware, (req, res) => {
  const id = Number(req.params.id);
  const days = Math.max(1, Number((req.body && req.body.days) || 30));
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: '用户不存在' });
  const base = target.vip_until && new Date(target.vip_until) > new Date()
    ? new Date(target.vip_until)
    : new Date();
  const until = new Date(base.getTime() + days * 86400000).toISOString();
  db.prepare("UPDATE users SET plan = 'vip', vip_until = ?, gen_quota_daily = 9999 WHERE id = ?").run(
    until,
    id
  );
  persistSqlJs();
  audit(req.user.id, 'grant_vip', id, days + ' days');
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.json({ user: publicUser(updated) });
});

app.get('/api/admin/logs', authMiddleware, adminMiddleware, (req, res) => {
  const rows = db
    .prepare(
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
const TICKET_TTL_MS = 90_000;
const workshopTickets = new Map();

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

function encryptWorkshopHtml() {
  const plaintext = fs.readFileSync(WORKSHOP_FILE);
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { key, iv, ct, tag };
}

function getLiveTicket(id) {
  if (!id) return null;
  sweepTickets();
  const ticket = workshopTickets.get(String(id));
  if (!ticket || ticket.exp <= Date.now()) {
    if (ticket) workshopTickets.delete(String(id));
    return null;
  }
  return ticket;
}

const workshopLoaderHtml = require('./lib/workshop-loader');

function sendWorkshopLoader(req, res) {
  const k = String((req.query && req.query.k) || '');
  const ticket = getLiveTicket(k);
  if (!ticket) {
    res.status(401).type('html').send(WORKSHOP_401);
    return;
  }
  res.status(200).type('html').send(workshopLoaderHtml(ticket));
}

app.post('/api/workshop/ticket', authMiddleware, (req, res) => {
  if (req.user.banned) return res.status(403).json({ error: '账号已被封禁' });
  sweepTickets();
  const enc = encryptWorkshopHtml();
  const id = crypto.randomBytes(32).toString('hex');
  workshopTickets.set(id, {
    id,
    userId: req.user.id,
    key: enc.key.toString('hex'),
    iv: enc.iv.toString('hex'),
    ciphertext: enc.ct.toString('base64'),
    tag: enc.tag.toString('base64'),
    exp: Date.now() + TICKET_TTL_MS,
    keyUsed: false,
    unlocks: 0,
  });
  res.json({
    ticket: id,
    key: enc.key.toString('hex'),
    iv: enc.iv.toString('hex'),
    expires_in: 90,
  });
});

app.get('/api/workshop/blob', (req, res) => {
  const ticket = getLiveTicket(String((req.query && req.query.k) || ''));
  if (!ticket) return res.status(404).json({ error: 'not found' });
  res.json({ iv: ticket.iv, ct: ticket.ciphertext, tag: ticket.tag });
});

app.post('/api/workshop/unlock', authMiddleware, (req, res) => {
  const id = String((req.body && req.body.ticket) || '');
  const ticket = getLiveTicket(id);
  if (!ticket) return res.status(404).json({ error: '工坊票据无效或已过期' });
  if (ticket.userId !== req.user.id) return res.status(403).json({ error: '无权解锁' });
  if (ticket.unlocks >= 3) return res.status(403).json({ error: '解锁次数已用尽' });
  ticket.unlocks += 1;
  ticket.keyUsed = true;
  res.json({ key: ticket.key, iv: ticket.iv });
});

app.post('/api/workshop/session', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const ticket = getLiveTicket(String((req.body && req.body.ticket) || ''));
  const key = String((req.body && req.body.key) || '');
  if (!ticket || !/^[0-9a-f]{64}$/i.test(key) || !crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(ticket.key, 'hex'))) {
    return res.status(401).json({ error: '进入凭证已过期，请返回后重新进入' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(ticket.userId);
  if (!user || user.banned) return res.status(403).json({ error: '账号不可用' });
  if (!user.email_verified) return res.status(403).json({ error: '请先验证邮箱' });
  setAuthCookie(res, signToken(user));
  res.json({ ok: true });
});

app.get('/workshop', sendWorkshopLoader);
app.get('/workshop/', sendWorkshopLoader);

app.get('/admin', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin', 'index.html'));
});
app.use('/admin', express.static(path.join(PUBLIC_DIR, 'admin')));
app.use('/', express.static(path.join(PUBLIC_DIR, 'app')));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: '接口不存在' });
  res.sendFile(path.join(PUBLIC_DIR, 'app', 'index.html'));
});

async function main() {
  await openDatabase();
  migrate();
  seedAdmin();
  db.prepare("DELETE FROM gen_logs WHERE kind = 'image_pending'").run();
  persistSqlJs();
  const maintenance = setInterval(() => { void images.sweep(); }, 30_000);
  maintenance.unref();
  const server = app.listen(PORT, process.env.HOST || '0.0.0.0', () => {
    console.log('[sushi-club] listening on port ' + server.address().port);
    console.log('[sushi-club] db mode:', dbMode);
    console.log('[sushi-club] JWT_SECRET is', process.env.JWT_SECRET ? 'from env' : 'default sushi-dev-secret (override in production)');
    console.log('[sushi-club] SMTP is', smtpConfigured() ? 'configured' : 'missing (codes stored, email skipped)');
  });
  server.on('close', () => {
    clearInterval(maintenance);
    if (sqlJsSaveTimer) clearInterval(sqlJsSaveTimer);
    persistSqlJs();
    if (dbMode === 'better-sqlite3') db.close();
    else db.database.close();
  });
  return server;
}

process.on('SIGINT', () => {
  persistSqlJs();
  if (sqlJsSaveTimer) clearInterval(sqlJsSaveTimer);
  process.exit(0);
});

if (require.main === module) main().catch((err) => {
  console.error(err);
  process.exit(1);
});

module.exports = { app, main };
