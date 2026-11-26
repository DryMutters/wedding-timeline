// Wedding timeline app: Mary's builder under /admin (behind Cloudflare Access),
// couples' private pages under /t/<token>, data in D1.
import { jwtVerify, createRemoteJWKSet } from 'jose';

const NO_INDEX = { 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' };
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...NO_INDEX } });
const text = (message, status) => new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...NO_INDEX } });

const MAX_BODY = 300000; // bytes; a full draft is a few kilobytes
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN = /^[0-9a-f]{32}$/;

let keySet = null, keySetFor = '';

// Who is signed in, or null. Cloudflare Access sits in front of /admin, and this checks
// its signed token on every request so the builder stays closed even if Access is misconfigured.
async function signedIn(request, env, url) {
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (env.DEV_SKIP_ACCESS === '1' && local) return { email: 'dev@localhost' };
  if (!env.TEAM_DOMAIN || !env.POLICY_AUD) return null;
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return null;
  try {
    if (!keySet || keySetFor !== env.TEAM_DOMAIN) {
      keySet = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', env.TEAM_DOMAIN));
      keySetFor = env.TEAM_DOMAIN;
    }
    const { payload } = await jwtVerify(token, keySet, { issuer: env.TEAM_DOMAIN, audience: env.POLICY_AUD, algorithms: ['RS256'] });
    return { email: typeof payload.email === 'string' ? payload.email : '' };
  } catch {
    return null;
  }
}

async function shell(env, url, name) {
  const res = await env.ASSETS.fetch(new Request(new URL('/_shell/' + name, url)));
  if (!res.ok) return text('Page not found', 404);
  return new Response(res.body, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', ...NO_INDEX } });
}

async function readBody(request) {
  if (!(request.headers.get('content-type') || '').includes('application/json')) return null;
  const raw = await request.text();
  if (raw.length > MAX_BODY) return null;
  try {
    const data = JSON.parse(raw);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

async function adminApi(request, env, url, user, parts) {
  // parts: ['admin', 'api', 'weddings', id?, 'publish'?]
  if (parts[2] !== 'weddings') return json({ error: 'Not found' }, 404);
  const method = request.method, id = parts[3], now = new Date().toISOString();
  // Every record belongs to an account. Today there is one; sign-up for other photographers comes later.
  const account = env.ACCOUNT_ID || 'default';

  // Changes must come from this site's own pages.
  if (method !== 'GET' && request.headers.get('origin') !== url.origin) return json({ error: 'Cross-site request refused' }, 403);

  if (!id) {
    if (method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT w.id, w.couple, w.wedding_date, w.updated_at, (SELECT MAX(n) FROM versions v WHERE v.wedding_id = w.id) AS version
         FROM weddings w WHERE w.account_id = ? ORDER BY CASE WHEN w.wedding_date = '' THEN 1 ELSE 0 END, w.wedding_date, w.created_at`).bind(account).all();
      return json({ weddings: results });
    }
    if (method === 'POST') {
      const newId = crypto.randomUUID();
      await env.DB.prepare('INSERT INTO weddings (id, account_id, token, couple, wedding_date, draft, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(newId, account, newToken(), '', '', '{}', now, now, user.email).run();
      return json({ id: newId }, 201);
    }
    return json({ error: 'Method not allowed' }, 405);
  }

  if (!ID.test(id)) return json({ error: 'Not found' }, 404);
  const wedding = await env.DB.prepare('SELECT id, token, draft FROM weddings WHERE id = ? AND account_id = ?').bind(id, account).first();
  if (!wedding) return json({ error: 'Not found' }, 404);

  if (!parts[4]) {
    if (method === 'GET') {
      const latest = await env.DB.prepare('SELECT n, snapshot, published_at FROM versions WHERE wedding_id = ? ORDER BY n DESC LIMIT 1').bind(id).first();
      let versions = [];
      if (latest) {
        const snap = JSON.parse(latest.snapshot);
        versions = [{ n: latest.n, blocks: snap.blocks || [], changes: snap.changes || { byId: {}, lines: [] }, at: latest.published_at }];
      }
      return json({ id, token: wedding.token, draft: JSON.parse(wedding.draft || '{}'), versions });
    }
    if (method === 'PUT') {
      const body = await readBody(request);
      if (!body || typeof body.a !== 'object' || !Array.isArray(body.items)) return json({ error: 'Invalid draft' }, 400);
      await env.DB.prepare('UPDATE weddings SET draft = ?, couple = ?, wedding_date = ?, updated_at = ?, updated_by = ? WHERE id = ?')
        .bind(JSON.stringify({ a: body.a, m: body.m || {}, items: body.items, seq: body.seq || 1 }), str(body.a.couple, 200), str(body.a.date, 10), now, user.email, id).run();
      return json({ ok: true });
    }
    return json({ error: 'Method not allowed' }, 405);
  }

  if (parts[4] === 'publish' && method === 'POST') {
    const body = await readBody(request);
    if (!body || typeof body.a !== 'object' || !Array.isArray(body.items) || !Array.isArray(body.blocks)) return json({ error: 'Invalid version' }, 400);
    const snapshot = JSON.stringify({ a: body.a, m: body.m || {}, items: body.items, blocks: body.blocks, changes: body.changes || { byId: {}, lines: [] } });
    // A published version is never edited afterwards. The number is assigned here, in one statement.
    const row = await env.DB.prepare(
      `INSERT INTO versions (wedding_id, n, snapshot, published_at, published_by)
       VALUES (?1, (SELECT COALESCE(MAX(n), 0) + 1 FROM versions WHERE wedding_id = ?1), ?2, ?3, ?4) RETURNING n`)
      .bind(id, snapshot, now, user.email).first();
    return json({ n: row.n, url: url.origin + '/t/' + wedding.token }, 201);
  }
  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    try {
      if (parts.length === 0) return Response.redirect(url.origin + '/admin', 302);

      if (parts[0] === 'admin') {
        const user = await signedIn(request, env, url);
        if (!user) return text('Sign-in required. Open this page through Cloudflare Access.', 403);
        if (parts[1] === 'api') return await adminApi(request, env, url, user, parts);
        if (request.method !== 'GET') return text('Method not allowed', 405);
        if (parts.length === 1) return shell(env, url, 'weddings');
        if (parts[1] === 'w' && parts.length === 3 && ID.test(parts[2])) return shell(env, url, 'builder');
        return text('Page not found', 404);
      }

      if (parts[0] === 't' && parts.length === 2 && request.method === 'GET') return shell(env, url, 'timeline');

      if (parts[0] === 'api' && parts[1] === 't' && parts.length === 3 && request.method === 'GET') {
        if (!TOKEN.test(parts[2])) return json({ error: 'Not found' }, 404);
        const row = await env.DB.prepare(
          `SELECT v.n, v.snapshot, v.published_at FROM versions v JOIN weddings w ON w.id = v.wedding_id
           WHERE w.token = ? ORDER BY v.n DESC LIMIT 1`).bind(parts[2]).first();
        if (!row) return json({ error: 'Not found' }, 404);
        const snap = JSON.parse(row.snapshot);
        // The couple gets only what their page shows: no coverage hours, planner contact or private notes.
        const a = snap.a || {};
        const pub = { couple: a.couple, date: a.date, cerVenue: a.cerVenue, place: a.place, cerStart: a.cerStart, cerLen: a.cerLen, recEnd: a.recEnd, exit: a.exit };
        return json({ n: row.n, published_at: row.published_at,
          snapshot: { a: pub, m: { sunsetPortraits: (snap.m || {}).sunsetPortraits }, items: snap.items, changes: snap.changes } });
      }

      return text('Page not found', 404);
    } catch (err) {
      console.error(err);
      return text('Something went wrong. Please try again.', 500);
    }
  },
};
