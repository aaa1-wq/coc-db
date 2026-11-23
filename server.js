/*
 * 部落冲突阵型数据库 · 后端服务
 * - 本机：node server.js  → 用 SQLite（文件 coc.db），http://localhost:8899
 * - 云端：设置 DATABASE_URL（Postgres，如 Neon）→ 用 Postgres，自动适配 Render/Railway 等
 * 功能：阵型数据存储、点赞/踩、评论/防守效果反馈、克制流派统计、转发计数
 */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.PORT ? Number(process.env.PORT) : 8899;
const ROOT = __dirname;
const DATABASE_URL = process.env.DATABASE_URL || '';
const USE_PG = !!DATABASE_URL;

/* ================= 数据库抽象层 =================
 * 提供统一接口：get(sql,params) / all(sql,params) / run(sql,params)
 * 底层：Postgres（pg）或 SQLite（node:sqlite）
 */
let db;
if (USE_PG) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  // Postgres 用 $1,$2 占位符；我们的 SQL 统一写 ? → 转成 $n
  function pgify(sql) {
    let i = 0;
    return sql.replace(/\?/g, () => '$' + (++i));
  }
  db = {
    mode: 'pg',
    async get(sql, params = []) { const r = await pool.query(pgify(sql), params); return r.rows[0]; },
    async all(sql, params = []) { const r = await pool.query(pgify(sql), params); return r.rows; },
    async run(sql, params = []) { return pool.query(pgify(sql), params); },
    async init(stmts) { for (const s of stmts) { await pool.query(s); } },
  };
} else {
  const { DatabaseSync } = require('node:sqlite');
  const DB_PATH = path.join(ROOT, 'coc.db');
  const sqlite = new DatabaseSync(DB_PATH);
  db = {
    mode: 'sqlite',
    async get(sql, params = []) { return sqlite.prepare(sql).get(...params); },
    async all(sql, params = []) { return sqlite.prepare(sql).all(...params); },
    async run(sql, params = []) { return sqlite.prepare(sql).run(...params); },
    async init(stmts) { for (const s of stmts) { sqlite.exec(s); } },
  };
}

/* ================= 建表（PG 与 SQLite 兼容写法） ================= */
const INIT_STMTS = USE_PG ? [
  `CREATE TABLE IF NOT EXISTS votes (baseKey TEXT PRIMARY KEY, up INTEGER DEFAULT 0, down INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS feedback (id SERIAL PRIMARY KEY, baseKey TEXT, clientId TEXT, text TEXT, defenseResult TEXT, stream TEXT, ts BIGINT)`,
  `CREATE TABLE IF NOT EXISTS counters (baseKey TEXT, stream TEXT, cnt INTEGER DEFAULT 0, PRIMARY KEY(baseKey, stream))`,
  `CREATE TABLE IF NOT EXISTS shares (baseKey TEXT PRIMARY KEY, cnt INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS client_votes (clientId TEXT, baseKey TEXT, dir TEXT, PRIMARY KEY(clientId, baseKey))`,
  // 用户上传的阵型（别人也能在公网看到）
  `CREATE TABLE IF NOT EXISTS customs (
     id TEXT PRIMARY KEY, name TEXT, th TEXT, type TEXT, link TEXT, tags TEXT, note TEXT,
     img TEXT, owner TEXT, ts BIGINT, pending BOOLEAN DEFAULT false
   )`,
] : [
  `CREATE TABLE IF NOT EXISTS votes (baseKey TEXT PRIMARY KEY, up INTEGER DEFAULT 0, down INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, baseKey TEXT, clientId TEXT, text TEXT, defenseResult TEXT, stream TEXT, ts INTEGER)`,
  `CREATE TABLE IF NOT EXISTS counters (baseKey TEXT, stream TEXT, cnt INTEGER DEFAULT 0, PRIMARY KEY(baseKey, stream))`,
  `CREATE TABLE IF NOT EXISTS shares (baseKey TEXT PRIMARY KEY, cnt INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS client_votes (clientId TEXT, baseKey TEXT, dir TEXT, PRIMARY KEY(clientId, baseKey))`,
  `CREATE TABLE IF NOT EXISTS customs (id TEXT PRIMARY KEY, name TEXT, th TEXT, type TEXT, link TEXT, tags TEXT, note TEXT, img TEXT, owner TEXT, ts INTEGER, pending INTEGER DEFAULT 0)`,
];

/* ================= 工具 ================= */
function json(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = '', size = 0;
    req.on('data', (c) => { size += c.length; if (size > 8e6) req.destroy(); d += c; });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
async function baseStats(key) {
  await db.run('INSERT INTO votes(baseKey,up,down) VALUES(?,0,0) ON CONFLICT(baseKey) DO NOTHING', [key]);
  const v = (await db.get('SELECT up,down FROM votes WHERE baseKey=?', [key])) || { up: 0, down: 0 };
  const sh = (await db.get('SELECT cnt FROM shares WHERE baseKey=?', [key])) || { cnt: 0 };
  const counters = await db.all('SELECT stream,cnt FROM counters WHERE baseKey=? ORDER BY cnt DESC', [key]);
  const fbs = await db.all('SELECT text,defenseResult,stream,ts FROM feedback WHERE baseKey=? ORDER BY ts DESC LIMIT 50', [key]);
  return { up: v.up, down: v.down, shares: sh.cnt, counters, feedback: fbs };
}

/* ================= 路由 ================= */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });

  if (p.startsWith('/api/')) {
    try {
      // 全量统计
      if (p === '/api/all' && req.method === 'GET') {
        const out = {};
        for (const r of await db.all('SELECT baseKey,up,down FROM votes')) out[r.baseKey] = { up: r.up, down: r.down, shares: 0, counters: [], feedback: [] };
        for (const r of await db.all('SELECT baseKey,cnt FROM shares')) (out[r.baseKey] = out[r.baseKey] || { up:0,down:0,shares:0,counters:[],feedback:[] }).shares = r.cnt;
        for (const r of await db.all('SELECT baseKey,stream,cnt FROM counters')) (out[r.baseKey] = out[r.baseKey] || { up:0,down:0,shares:0,counters:[],feedback:[] }).counters.push({ stream: r.stream, cnt: r.cnt });
        for (const k in out) out[k].counters.sort((a, b) => b.cnt - a.cnt);
        return json(res, 200, { ok: true, stats: out });
      }

      // 全部自定义阵型（公网展示用）
      if (p === '/api/customs' && req.method === 'GET') {
        const rows = await db.all('SELECT * FROM customs ORDER BY ts DESC');
        const list = rows.map(r => ({ ...r, tags: r.tags ? safeJson(r.tags) : [], pending: !!r.pending }));
        return json(res, 200, { ok: true, items: list });
      }
      // 上传自定义阵型（单个或批量）
      if (p === '/api/customs' && req.method === 'POST') {
        const b = await readBody(req);
        const arr = Array.isArray(b.items) ? b.items : [b];
        const seen = new Set((await db.all('SELECT link FROM customs')).map(r => normLink(r.link)));
        let added = 0, skip = 0;
        for (const it of arr) {
          if (!it || !it.name) continue;
          const link = String(it.link || '').trim();
          const nk = normLink(link);
          if (nk && seen.has(nk)) { skip++; continue; }
          const id = it.id || ('c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
          await db.run(
            'INSERT INTO customs(id,name,th,type,link,tags,note,img,owner,ts,pending) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
            [id, String(it.name).slice(0, 200), String(it.th || ''), String(it.type || ''), link.slice(0, 2000),
             JSON.stringify(it.tags || []), String(it.note || '').slice(0, 1000), String(it.img || '').slice(0, 4000000),
             String(it.owner || '').slice(0, 64), Number(it.ts) || Date.now(), it.pending ? 1 : 0]
          );
          if (nk) seen.add(nk);
          added++;
        }
        return json(res, 200, { ok: true, added, skip });
      }
      // 删除自定义阵型
      let md = p.match(/^\/api\/customs\/(.+)$/);
      if (md && req.method === 'DELETE') {
        await db.run('DELETE FROM customs WHERE id=?', [decodeURIComponent(md[1])]);
        return json(res, 200, { ok: true });
      }

      let m = p.match(/^\/api\/base\/(.+)$/);
      if (m && req.method === 'GET') return json(res, 200, { ok: true, key: decodeURIComponent(m[1]), stats: await baseStats(decodeURIComponent(m[1])) });

      if (p === '/api/vote' && req.method === 'POST') {
        const { key, dir, clientId } = await readBody(req);
        if (!key || (dir !== 'up' && dir !== 'down') || !clientId) return json(res, 400, { ok: false, error: 'bad params' });
        await db.run('INSERT INTO votes(baseKey,up,down) VALUES(?,0,0) ON CONFLICT(baseKey) DO NOTHING', [key]);
        const prev = await db.get('SELECT dir FROM client_votes WHERE clientId=? AND baseKey=?', [clientId, key]);
        const inc = dir === 'up' ? 'UPDATE votes SET up=up+1 WHERE baseKey=?' : 'UPDATE votes SET down=down+1 WHERE baseKey=?';
        const dec = dir === 'up' ? 'UPDATE votes SET up=CASE WHEN up>0 THEN up-1 ELSE 0 END WHERE baseKey=?' : 'UPDATE votes SET down=CASE WHEN down>0 THEN down-1 ELSE 0 END WHERE baseKey=?';
        if (prev && prev.dir === dir) {
          await db.run('DELETE FROM client_votes WHERE clientId=? AND baseKey=?', [clientId, key]);
          await db.run(dec, [key]);
        } else {
          if (prev) { await db.run(prev.dir === 'up' ? 'UPDATE votes SET up=CASE WHEN up>0 THEN up-1 ELSE 0 END WHERE baseKey=?' : 'UPDATE votes SET down=CASE WHEN down>0 THEN down-1 ELSE 0 END WHERE baseKey=?', [key]); }
          await db.run('INSERT INTO client_votes(clientId,baseKey,dir) VALUES(?,?,?) ON CONFLICT(clientId,baseKey) DO UPDATE SET dir=?', [clientId, key, dir, dir]);
          await db.run(inc, [key]);
        }
        return json(res, 200, { ok: true, stats: await baseStats(key) });
      }

      if (p === '/api/feedback' && req.method === 'POST') {
        const { key, text, defenseResult, stream, clientId } = await readBody(req);
        if (!key) return json(res, 400, { ok: false, error: 'no key' });
        const cl = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');
        await db.run('INSERT INTO feedback(baseKey,clientId,text,defenseResult,stream,ts) VALUES(?,?,?,?,?,?)',
          [key, cl(clientId, 64), cl(text, 500), cl(defenseResult, 20), cl(stream, 40), Date.now()]);
        return json(res, 200, { ok: true, stats: await baseStats(key) });
      }

      if (p === '/api/counter' && req.method === 'POST') {
        const { key, stream } = await readBody(req);
        if (!key || !stream) return json(res, 400, { ok: false, error: 'bad params' });
        await db.run('INSERT INTO counters(baseKey,stream,cnt) VALUES(?,?,1) ON CONFLICT(baseKey,stream) DO UPDATE SET cnt=cnt+1', [key, String(stream).slice(0, 40)]);
        return json(res, 200, { ok: true, stats: await baseStats(key) });
      }

      if (p === '/api/share' && req.method === 'POST') {
        const { key } = await readBody(req);
        if (!key) return json(res, 400, { ok: false, error: 'no key' });
        await db.run('INSERT INTO shares(baseKey,cnt) VALUES(?,1) ON CONFLICT(baseKey) DO UPDATE SET cnt=cnt+1', [key]);
        return json(res, 200, { ok: true, stats: await baseStats(key) });
      }

      return json(res, 404, { ok: false, error: 'not found' });
    } catch (err) {
      console.error('[API ERR]', err);
      return json(res, 500, { ok: false, error: String(err && err.message || err) });
    }
  }

  /* 静态文件 */
  let rel = decodeURIComponent(p);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      fs.readFile(path.join(ROOT, 'index.html'), (e, data) => {
        if (e) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(data);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext.match(/\.(js|css|png|jpg|jpeg|webp|ico)$/) ? 'max-age=86400' : 'no-cache' });
    fs.createReadStream(filePath).pipe(res);
  });
});

function safeJson(s) { try { return JSON.parse(s); } catch (e) { return []; } }
function normLink(l) { return String(l || '').trim().replace(/\/+$/, '').toLowerCase(); }

(async () => {
  await db.init(INIT_STMTS);
  server.listen(PORT, () => {
    console.log('=============================================');
    console.log(' COC Base DB backend started');
    console.log(' http://localhost:' + PORT);
    console.log(' DB mode: ' + db.mode + (USE_PG ? ' (Postgres)' : ' (SQLite)'));
    console.log('=============================================');
  });
})();

