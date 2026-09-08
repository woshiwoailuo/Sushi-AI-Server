'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  toPgParams,
  createPostgresAdapter,
  persistenceFromMode,
} = require('../lib/db-postgres');

test('toPgParams rewrites SQLite placeholders to Postgres $n', () => {
  assert.equal(toPgParams('SELECT * FROM users WHERE id = ?'), 'SELECT * FROM users WHERE id = $1');
  assert.equal(
    toPgParams('UPDATE users SET a = ?, b = ? WHERE id = ?'),
    'UPDATE users SET a = $1, b = $2 WHERE id = $3'
  );
});

test('createPostgresAdapter maps prepare/get/run over a fake query', async () => {
  const calls = [];
  const adapter = createPostgresAdapter(async (text, params) => {
    calls.push({ text, params });
    if (/RETURNING id/i.test(text)) return [{ id: 42 }];
    if (/SELECT \* FROM users/i.test(text)) return [{ id: 7, email: 'a@b.c' }];
    return [];
  });

  const inserted = await adapter.prepare('INSERT INTO users (email) VALUES (?)').run('a@b.c');
  assert.equal(inserted.lastInsertRowid, 42);
  assert.equal(calls[0].text, 'INSERT INTO users (email) VALUES ($1) RETURNING id');
  assert.deepEqual(calls[0].params, ['a@b.c']);

  const row = await adapter.prepare('SELECT * FROM users WHERE id = ?').get(7);
  assert.equal(row.email, 'a@b.c');
  assert.equal(calls[1].text, 'SELECT * FROM users WHERE id = $1');
});

test('persistenceFromMode: durable only when postgres is actually active', () => {
  assert.deepEqual(
    persistenceFromMode('sql.js', { VERCEL: '1', SUSHI_DB_PERSISTENCE: 'external' }),
    {
      durable: false,
      mode: 'sql.js',
      provider: 'vercel-tmp',
      external_flag: true,
      persistence_flag_ignored: true,
    }
  );
  assert.equal(persistenceFromMode('postgres', { VERCEL: '1' }).durable, true);
  assert.equal(persistenceFromMode('postgres', { VERCEL: '1' }).provider, 'postgres');
  assert.equal(persistenceFromMode('better-sqlite3', {}).durable, true);
  assert.equal(persistenceFromMode('better-sqlite3', {}).provider, 'local-disk');
});

test('openPostgres path is skipped when DATABASE_URL is unset (smoke)', async () => {
  // Integration / live Neon coverage requires DATABASE_URL; without it we only
  // assert the module still loads and helpers above remain usable.
  assert.equal(typeof toPgParams, 'function');
  assert.equal(typeof createPostgresAdapter, 'function');
});
