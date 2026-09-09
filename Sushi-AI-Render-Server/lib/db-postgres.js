'use strict';

/**
 * Neon/Postgres adapter that mirrors the better-sqlite3 / SqlJsAdapter surface:
 *   db.exec(sql) -> Promise
 *   db.prepare(sql).run/get/all(...params) -> Promise
 * Placeholders use SQLite-style `?` and are rewritten to `$1..$n`.
 */

function toPgParams(sql) {
  let index = 0;
  return String(sql).replace(/\?/g, () => '$' + (++index));
}

function splitStatements(sql) {
  return String(sql)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
}

function createPostgresAdapter(query) {
  return {
    async exec(sql) {
      for (const statement of splitStatements(sql)) {
        await query(statement, []);
      }
    },
    prepare(sql) {
      const text = String(sql);
      const pgSql = toPgParams(text);
      const isInsert = /^\s*insert\b/i.test(text);
      return {
        async run(...params) {
          let finalSql = pgSql;
          if (isInsert && !/\breturning\b/i.test(pgSql)) {
            finalSql = pgSql.replace(/;?\s*$/i, '') + ' RETURNING id';
          }
          const rows = await query(finalSql, params);
          const first = rows && rows[0] ? rows[0] : null;
          const lastInsertRowid = first && first.id != null ? Number(first.id) : 0;
          return {
            lastInsertRowid,
            changes: Array.isArray(rows) ? rows.length : 0,
          };
        },
        async get(...params) {
          const rows = await query(pgSql, params);
          return rows && rows[0] ? rows[0] : undefined;
        },
        async all(...params) {
          const rows = await query(pgSql, params);
          return Array.isArray(rows) ? rows : [];
        },
      };
    },
  };
}

async function openPostgres(databaseUrl) {
  if (!databaseUrl || typeof databaseUrl !== 'string') {
    throw new Error('DATABASE_URL is required for Postgres mode');
  }
  const { neon } = require('@neondatabase/serverless');
  const sql = neon(databaseUrl, { fullResults: false });

  async function query(text, params) {
    const rows = await sql.query(text, params || []);
    return Array.isArray(rows) ? rows : [];
  }

  return createPostgresAdapter(query);
}

async function migratePostgres(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      plan TEXT NOT NULL DEFAULT 'free',
      vip_until TEXT,
      gen_quota_daily INTEGER NOT NULL DEFAULT 10,
      banned INTEGER NOT NULL DEFAULT 0,
      email_verified INTEGER NOT NULL DEFAULT 0,
      last_login_at TEXT,
      last_ip TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gen_logs (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      kind TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      admin_id BIGINT NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      target_user_id BIGINT,
      note TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS email_codes (
      id BIGSERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_releases (
      id BIGSERIAL PRIMARY KEY,
      version_code INTEGER NOT NULL,
      version_name TEXT NOT NULL,
      notes TEXT,
      force_update INTEGER NOT NULL DEFAULT 0,
      apk_path TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      created_by BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_gen_logs_user_day ON gen_logs(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_email_codes_email ON email_codes(email);
    CREATE INDEX IF NOT EXISTS idx_app_releases_code ON app_releases(version_code);
    CREATE TABLE IF NOT EXISTS workshop_tickets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      key_hex TEXT NOT NULL,
      iv_hex TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      tag TEXT NOT NULL,
      exp_ms BIGINT NOT NULL,
      key_used INTEGER NOT NULL DEFAULT 0,
      unlocks INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_workshop_tickets_exp ON workshop_tickets(exp_ms);
  `);

  // Idempotent column adds for databases created before optional fields existed.
  const needed = [
    ['email_verified', 'INTEGER NOT NULL DEFAULT 0'],
    ['last_login_at', 'TEXT'],
    ['last_ip', 'TEXT'],
  ];
  for (const [name, ddl] of needed) {
    const rows = await db
      .prepare(
        `SELECT 1 AS ok FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'users' AND column_name = ?`
      )
      .all(name);
    if (!rows.length) {
      await db.exec('ALTER TABLE users ADD COLUMN ' + name + ' ' + ddl);
    }
  }
}

function persistenceFromMode(dbMode, env = process.env) {
  const isVercel = Boolean(env.VERCEL);
  const usingPostgres = dbMode === 'postgres';
  const externalFlag = String(env.SUSHI_DB_PERSISTENCE || '').toLowerCase() === 'external';
  // durable requires a real external Postgres adapter. SUSHI_DB_PERSISTENCE=external
  // alone must never claim durability on Vercel tmp / SQLite.
  let durable;
  let provider;
  if (usingPostgres) {
    durable = true;
    provider = 'postgres';
  } else if (isVercel) {
    durable = false;
    provider = 'vercel-tmp';
  } else {
    durable = true;
    provider = 'local-disk';
  }
  return {
    durable,
    mode: dbMode,
    provider,
    external_flag: externalFlag,
    persistence_flag_ignored: externalFlag && !usingPostgres,
  };
}

module.exports = {
  toPgParams,
  createPostgresAdapter,
  openPostgres,
  migratePostgres,
  persistenceFromMode,
};
