'use strict';

const path = require('path');
const crypto = require('crypto');
const {
  QUESTIONS,
  beijingDate,
  evaluate,
  nicknameFor,
  optionSeedFor,
  pickDaily,
  pickPractice,
  publicize,
  roomCode,
} = require('./nls-engine');

function parseIds(raw) {
  const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'number')) {
    throw new Error('题目数据损坏');
  }
  return v;
}

function publicQuestions(ids, optionKey) {
  return ids.map((id) => {
    const q = QUESTIONS.find((x) => x.id === id);
    if (!q) throw new Error('题目不存在');
    return publicize(q, optionSeedFor(optionKey, id));
  });
}

function uidOf(user) {
  return String(user.id);
}

function nickOf(user) {
  const name = String(user.display_name || '').trim();
  if (name) return name.slice(0, 24);
  const email = String(user.email || '');
  if (email.includes('@')) return email.split('@')[0].slice(0, 24);
  return nicknameFor(uidOf(user));
}

function asyncRoute(fn) {
  return (req, res) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      const msg = err && err.message ? String(err.message) : '请求失败';
      if (!res.headersSent) res.status(400).json({ error: msg });
    });
  };
}

function sendErr(res, status, message) {
  return res.status(status).json({ error: message });
}

function registerNls(app, deps) {
  const persistSqlJs = () => deps.persistSqlJs();
  const db = () => deps.db;
  async function loadRoom(roomId, uid) {
    const room = await db().prepare(
      'SELECT id, question_ids, option_key, expires_at FROM nls_rooms WHERE id = ?'
    ).get(roomId);
    if (!room) throw new Error('房间不存在或链接无效。');
    const players = await db().prepare(
      'SELECT user_id, nickname, score, done FROM nls_room_players WHERE room_id = ? ORDER BY joined_at ASC'
    ).all(roomId);
    const expired = Date.parse(String(room.expires_at)) <= Date.now();
    const complete = players.length >= 2 && players.every((p) => Number(p.done) === 1);
    const joined = players.some((p) => String(p.user_id) === uid);
    return {
      room,
      players,
      view: {
        id: room.id,
        complete,
        expired,
        full: players.length >= 2,
        joined,
        players: players.map((p) => ({
          name: p.nickname,
          me: String(p.user_id) === uid,
          done: Number(p.done) === 1,
          score: complete ? p.score : null,
        })),
      },
    };
  }

  app.get('/nls', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'app', 'nls', 'index.html'));
  });
  app.get('/nls/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'app', 'nls', 'index.html'));
  });

  app.get(
    '/api/nls/me',
    deps.authMiddleware,
    asyncRoute(async (req, res) => {
      res.json({ name: nickOf(req.user), email: req.user.email || '' });
    }),
  );

  app.get(
    '/api/nls/board',
    deps.authMiddleware,
    asyncRoute(async (req, res) => {
      const day = beijingDate();
      const rows = await db().prepare(
        'SELECT nickname, score FROM nls_daily WHERE day = ? ORDER BY score DESC, created_at ASC LIMIT 50'
      ).all(day);
      let last = -1;
      let rank = 0;
      const ranked = rows.map((r, i) => {
        if (r.score !== last) {
          rank = i + 1;
          last = r.score;
        }
        return { rank, name: r.nickname, score: r.score };
      });
      res.json({ date: day, rows: ranked });
    }),
  );

  app.post(
    '/api/nls/room',
    deps.authMiddleware,
    asyncRoute(async (req, res) => {
      const uid = uidOf(req.user);
      const name = nickOf(req.user);
      const id = roomCode();
      const optionKey = 'pk:' + id;
      const ids = pickPractice(optionKey);
      const now = new Date();
      const expires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      await db().prepare(
        'INSERT INTO nls_rooms (id, question_ids, option_key, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
      ).run(id, JSON.stringify(ids), optionKey, now.toISOString(), expires);
      await db().prepare(
        'INSERT INTO nls_room_players (id, room_id, user_id, nickname, done, joined_at) VALUES (?, ?, ?, ?, 0, ?)'
      ).run(id + ':' + uid, id, uid, name, now.toISOString());
      persistSqlJs();
      const packed = await loadRoom(id, uid);
      res.json(packed.view);
    }),
  );

  app.post(
    '/api/nls/room/fetch',
    deps.authMiddleware,
    asyncRoute(async (req, res) => {
      const roomId = String((req.body && req.body.roomId) || '').trim().toUpperCase();
      if (roomId.length < 4 || roomId.length > 12) return sendErr(res, 400, '房间号无效');
      const packed = await loadRoom(roomId, uidOf(req.user));
      res.json(packed.view);
    }),
  );

  app.post(
    '/api/nls/start',
    deps.authMiddleware,
    asyncRoute(async (req, res) => {
      const uid = uidOf(req.user);
      const name = nickOf(req.user);
      const mode = String((req.body && req.body.mode) || '');
      const roomId = req.body && req.body.roomId ? String(req.body.roomId).trim().toUpperCase() : '';
      const now = Date.now();
      if (mode !== 'practice' && mode !== 'daily' && mode !== 'pk') {
        return sendErr(res, 400, '模式无效');
      }

      if (mode === 'daily') {
        const day = beijingDate(now);
        const existing = await db().prepare(
          'SELECT id, payload FROM nls_daily WHERE day = ? AND user_id = ? LIMIT 1'
        ).get(day, uid);
        if (existing && existing.payload) {
          return res.json(JSON.parse(existing.payload));
        }
      }

      if (mode === 'pk') {
        if (!roomId) return sendErr(res, 400, '缺少房间号');
        const packed = await loadRoom(roomId, uid);
        if (packed.view.expired && !packed.view.joined) return sendErr(res, 400, '房间已过期。');
        if (packed.view.full && !packed.view.joined) return sendErr(res, 400, '房间已满，两位玩家已经入场。');
        const mine = packed.players.find((p) => String(p.user_id) === uid);
        if (mine && Number(mine.done) === 1) {
          const rows = await db().prepare(
            'SELECT payload FROM nls_room_players WHERE room_id = ? AND user_id = ?'
          ).get(roomId, uid);
          if (rows && rows.payload) {
            const prev = JSON.parse(rows.payload);
            prev.room = packed.view;
            return res.json(prev);
          }
        }
        if (!packed.view.joined) {
          await db().prepare(
            'INSERT INTO nls_room_players (id, room_id, user_id, nickname, done, joined_at) VALUES (?, ?, ?, ?, 0, ?)'
          ).run(roomId + ':' + uid, roomId, uid, name, new Date().toISOString());
          persistSqlJs();
        }
        const ids = parseIds(packed.room.question_ids);
        const optionKey = packed.room.option_key;
        const id = crypto.randomUUID();
        await db().prepare(
          'INSERT INTO nls_attempts (id, user_id, mode, room_id, question_ids, option_key, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(id, uid, 'pk', roomId, JSON.stringify(ids), optionKey, now);
        persistSqlJs();
        const room = (await loadRoom(roomId, uid)).view;
        return res.json({
          id,
          mode: 'pk',
          roomId,
          score: null,
          startedAt: now,
          finishedAt: null,
          questions: publicQuestions(ids, optionKey),
          answers: null,
          room,
        });
      }

      const optionKey = mode === 'daily' ? 'daily:' + beijingDate(now) : 'practice:' + crypto.randomUUID();
      const ids = mode === 'daily' ? pickDaily(beijingDate(now)) : pickPractice(optionKey);
      const id = crypto.randomUUID();
      await db().prepare(
        'INSERT INTO nls_attempts (id, user_id, mode, room_id, question_ids, option_key, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(id, uid, mode, null, JSON.stringify(ids), optionKey, now);
      persistSqlJs();
      res.json({
        id,
        mode,
        roomId: null,
        score: null,
        startedAt: now,
        finishedAt: null,
        questions: publicQuestions(ids, optionKey),
        answers: null,
      });
    }),
  );

  app.post(
    '/api/nls/submit',
    deps.authMiddleware,
    asyncRoute(async (req, res) => {
      const uid = uidOf(req.user);
      const attemptId = String((req.body && req.body.attemptId) || '');
      const answers = req.body && req.body.answers;
      if (!attemptId) return sendErr(res, 400, '缺少答题编号');
      if (!Array.isArray(answers) || answers.length !== 10) return sendErr(res, 400, '本轮应为 10 道题');
      const att = await db().prepare(
        'SELECT id, user_id, mode, room_id, question_ids, option_key, started_at, finished_at, score, payload FROM nls_attempts WHERE id = ?'
      ).get(attemptId);
      if (!att || String(att.user_id) !== uid) return sendErr(res, 400, '本轮答题已失效，请返回首页重开。');
      if (att.finished_at && att.payload) return res.json(JSON.parse(att.payload));

      const ids = parseIds(att.question_ids);
      const result = evaluate(ids, answers, att.option_key);
      const finishedAt = Date.now();
      const view = {
        id: att.id,
        mode: att.mode,
        roomId: att.room_id,
        score: result.score,
        startedAt: Number(att.started_at),
        finishedAt,
        questions: publicQuestions(ids, att.option_key),
        answers,
        assessment: result.assessment,
        review: result.review,
      };

      if (att.mode === 'daily') {
        const day = beijingDate(Number(att.started_at));
        const existing = await db().prepare(
          'SELECT user_id FROM nls_daily WHERE day = ? AND user_id = ?'
        ).get(day, uid);
        if (existing) {
          const prev = await db().prepare(
            'SELECT payload FROM nls_daily WHERE day = ? AND user_id = ?'
          ).get(day, uid);
          return res.json(JSON.parse(prev.payload));
        }
        await db().prepare(
          'INSERT INTO nls_daily (id, day, user_id, nickname, score, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(day + ':' + uid, day, uid, nickOf(req.user), result.score, JSON.stringify(view), new Date().toISOString());
      }

      if (att.mode === 'pk' && att.room_id) {
        await db().prepare(
          'UPDATE nls_room_players SET done = 1, score = ?, correct = ?, answers = ?, payload = ? WHERE room_id = ? AND user_id = ?'
        ).run(result.score, result.assessment.correct, JSON.stringify(answers), JSON.stringify(view), att.room_id, uid);
        view.room = (await loadRoom(att.room_id, uid)).view;
      }

      await db().prepare(
        'UPDATE nls_attempts SET finished_at = ?, score = ?, payload = ? WHERE id = ?'
      ).run(finishedAt, result.score, JSON.stringify(view), att.id);
      persistSqlJs();
      res.json(view);
    }),
  );

  app.post(
    '/api/nls/refresh',
    deps.authMiddleware,
    asyncRoute(async (req, res) => {
      const uid = uidOf(req.user);
      const attemptId = String((req.body && req.body.attemptId) || '');
      const att = await db().prepare(
        'SELECT payload, room_id, user_id FROM nls_attempts WHERE id = ?'
      ).get(attemptId);
      if (!att || String(att.user_id) !== uid || !att.payload) {
        return sendErr(res, 400, '还没有可刷新的成绩。');
      }
      const view = JSON.parse(att.payload);
      if (att.room_id) view.room = (await loadRoom(att.room_id, uid)).view;
      res.json(view);
    }),
  );
}

module.exports = { registerNls };
