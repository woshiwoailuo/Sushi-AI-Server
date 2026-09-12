'use strict';

const NLS_SQL = `
  CREATE TABLE IF NOT EXISTS nls_attempts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    room_id TEXT,
    question_ids TEXT NOT NULL,
    option_key TEXT NOT NULL,
    started_at BIGINT NOT NULL,
    finished_at BIGINT,
    score INTEGER,
    payload TEXT
  );
  CREATE INDEX IF NOT EXISTS nls_attempts_user_idx ON nls_attempts (user_id, started_at);
  CREATE TABLE IF NOT EXISTS nls_daily (
    id TEXT PRIMARY KEY,
    day TEXT NOT NULL,
    user_id TEXT NOT NULL,
    nickname TEXT NOT NULL,
    score INTEGER NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS nls_daily_score_idx ON nls_daily (day, score, created_at);
  CREATE TABLE IF NOT EXISTS nls_rooms (
    id TEXT PRIMARY KEY,
    question_ids TEXT NOT NULL,
    option_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS nls_room_players (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    nickname TEXT NOT NULL,
    score INTEGER,
    correct INTEGER,
    done INTEGER NOT NULL DEFAULT 0,
    answers TEXT,
    payload TEXT,
    joined_at TEXT NOT NULL,
    UNIQUE (room_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS nls_room_players_room_idx ON nls_room_players (room_id, joined_at);
`;

async function migrateNls(db) {
  await db.exec(NLS_SQL);
}

module.exports = { migrateNls, NLS_SQL };
