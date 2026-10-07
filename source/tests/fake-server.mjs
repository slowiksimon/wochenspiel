// Fake "Firebase" for the browser tests: serves the built app and a tiny Firestore-like API (/__fake/…).
// It enforces the same rule as the real security rules shown in the wizard, and can simulate failures per project:
//   mode 'ok' | 'denied' | 'nodb' | 'apioff' | 'quota' (writes only) | 'down' (connections are dropped) | 'hang' (no answer at all) | 'nowrite' (reads work, every write connection dies unanswered) | 'batchfail' (single writes work, multi-document writes fail)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.ics': 'text/calendar; charset=utf-8' };

// same condition as FIRESTORE_RULES: match /rooms/{room}/{coll}/{id} { allow read, write: if room.size() >= 16 && coll in [...] }
export function allowed(p) {
  const s = p.split('/');
  return s[0] === 'rooms' && s.length >= 3 && s.length <= 4 && s[1].length >= 16 && ['tasks', 'slots', 'settings'].includes(s[2]);
}
const parentOf = p => p.slice(0, p.lastIndexOf('/'));
const OPS = { '==': (a, b) => a === b, '!=': (a, b) => a !== b, '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b };
const matches = (data, filters) => filters.every(f => (OPS[f.op] || OPS['=='])(data[f.field], f.value));

export async function startServer({ dir, port = 0, host = '127.0.0.1', prefix = '' }) {
  const projects = new Map();
  const P = name => {
    if (!projects.has(name)) projects.set(name, { docs: new Map(), listeners: new Set(), mode: 'ok', stats: { writes: 0, gets: 0, listens: 0, docsSent: 0 }, log: [] });
    return projects.get(name);
  };
  const modeError = (pr, project, isWrite) => {
    if (pr.mode === 'denied') return { code: 'permission-denied', message: 'Missing or insufficient permissions.' };
    if (pr.mode === 'apioff') return { code: 'permission-denied', message: 'Cloud Firestore API has not been used in project ' + project + ' before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/firestore.googleapis.com/overview?project=' + project };
    if (pr.mode === 'nodb') return { code: 'not-found', message: 'The database (default) does not exist for project ' + project };
    if (pr.mode === 'quota' && isWrite) return { code: 'resource-exhausted', message: 'Quota exceeded.' };
    return null;
  };
  const snapOf = (pr, l) => {
    if (l.kind === 'doc') { const d = pr.docs.get(l.path); return d === undefined ? { exists: false } : { exists: true, data: d }; }
    const docs = [];
    for (const [p, d] of pr.docs) if (parentOf(p) === l.path && matches(d, l.filters)) docs.push({ id: p.split('/').pop(), data: d });
    docs.sort((a, b) => (a.id < b.id ? -1 : 1));
    return { docs };
  };
  const send = (l, event, obj) => {
    try { l.res.write('event: ' + event + '\ndata: ' + JSON.stringify(obj) + '\n\n'); } catch (e) { /* closed */ }
  };
  const push = (pr, l) => { const s = snapOf(pr, l); pr.stats.docsSent += s.docs ? s.docs.length : (s.exists ? 1 : 0); send(l, 'snap', s); };
  const notify = (pr, paths) => {
    for (const l of pr.listeners) {
      if (l.kind === 'doc' ? paths.has(l.path) : Array.from(paths).some(p => parentOf(p) === l.path)) push(pr, l);
    }
  };
  const readBody = req => new Promise((resolve, reject) => {
    let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } }); req.on('error', reject);
  });
  const json = (res, obj, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };

  const api = {
    setMode(project, mode) {
      const pr = P(project);
      pr.mode = mode;
      for (const l of Array.from(pr.listeners)) {
        if (mode === 'down') { l.res.destroy(); pr.listeners.delete(l); }
        else { const err = modeError(pr, project, false); if (err) { send(l, 'fail', err); l.res.end(); pr.listeners.delete(l); } }
      }
    },
    dump(project) { return Object.fromEntries(P(project).docs); },
    put(project, p, data) { const pr = P(project); pr.docs.set(p, data); notify(pr, new Set([p])); },
    stats(project) { return P(project).stats; },
    reset() { for (const pr of projects.values()) { for (const l of pr.listeners) l.res.destroy(); } projects.clear(); },
    projects
  };

  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://x');
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    try {
      if (url.pathname.startsWith('/__fake/')) {
        const op = url.pathname.slice(8);
        if (op === 'write' && req.method === 'POST') {
          const body = await readBody(req);
          const pr = P(body.project);
          if (pr.mode === 'down') { req.socket.destroy(); return; }
          if (pr.mode === 'hang') return;
          if (pr.mode === 'nowrite') { setTimeout(() => req.socket.destroy(), 400); return; }      // the connection dies before any answer
          if (pr.delay) await new Promise(r => setTimeout(r, pr.delay));
          const me = modeError(pr, body.project, true);
          if (me) { json(res, { error: me }); return; }
          if (pr.mode === 'batchfail' && body.ops.length > 1) { json(res, { error: { code: 'internal', message: 'simulated failure of a multi-document write' } }); return; }
          for (const o of body.ops) if (!allowed(o.path)) { json(res, { error: { code: 'permission-denied', message: 'Missing or insufficient permissions.' } }); return; }
          for (const o of body.ops) if (o.op === 'update' && !pr.docs.has(o.path)) { json(res, { error: { code: 'not-found', message: 'No document to update: ' + o.path } }); return; }
          const touched = new Set();
          for (const o of body.ops) {
            if (o.op === 'set') pr.docs.set(o.path, o.data);
            else if (o.op === 'update') pr.docs.set(o.path, Object.assign({}, pr.docs.get(o.path), o.data));
            else pr.docs.delete(o.path);
            touched.add(o.path);
          }
          pr.stats.writes += body.ops.length;
          notify(pr, touched);
          json(res, { ok: true });
          return;
        }
        if (op === 'get') {
          const project = url.searchParams.get('project'), pr = P(project);
          if (pr.mode === 'down') { req.socket.destroy(); return; }
          if (pr.mode === 'hang') return;
          const me = modeError(pr, project, false);
          const p = url.searchParams.get('path'), kind = url.searchParams.get('kind');
          if (me) { json(res, { error: me }); return; }
          if (!allowed(p)) { json(res, { error: { code: 'permission-denied', message: 'Missing or insufficient permissions.' } }); return; }
          pr.stats.gets++;
          const l = { kind, path: p, filters: JSON.parse(url.searchParams.get('filters') || '[]') };
          const s = snapOf(pr, l);
          pr.stats.docsSent += s.docs ? s.docs.length : (s.exists ? 1 : 0);
          json(res, s);
          return;
        }
        if (op === 'listen') {
          const project = url.searchParams.get('project'), pr = P(project);
          if (pr.mode === 'down') { req.socket.destroy(); return; }
          if (pr.mode === 'hang') return;
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
          res.write('retry: 250\n\n');
          const l = { res, kind: url.searchParams.get('kind'), path: url.searchParams.get('path'), filters: JSON.parse(url.searchParams.get('filters') || '[]') };
          const me = modeError(pr, project, false);
          if (me) { send(l, 'fail', me); res.end(); return; }
          if (!allowed(l.path)) { send(l, 'fail', { code: 'permission-denied', message: 'Missing or insufficient permissions.' }); res.end(); return; }
          pr.stats.listens++;
          pr.listeners.add(l);
          req.on('close', () => pr.listeners.delete(l));
          push(pr, l);
          return;
        }
        if (op === 'admin' && req.method === 'POST') {
          const b = await readBody(req);
          if (b.mode) api.setMode(b.project, b.mode);
          if (b.delay != null) P(b.project).delay = b.delay;
          json(res, { ok: true });
          return;
        }
        if (op === 'dump') { json(res, api.dump(url.searchParams.get('project'))); return; }
        json(res, { error: 'unknown' }, 404);
        return;
      }
      // static files. A phone can be cut off from them (cookie set by the test): the page's own requests are failed by the browser's
      // offline mode, but that mode does not reach service workers, so the server drops these connections instead.
      const ck = req.headers.cookie || '';
      if (/(^|;\s*)ws_offline=1/.test(ck)) { req.socket.destroy(); return; }
      if (/(^|;\s*)ws_hang=1/.test(ck)) return;
      if (/(^|;\s*)ws_503=1/.test(ck)) { res.writeHead(503, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Service Unavailable</title><p>503</p>'); return; }
      let rel = decodeURIComponent(url.pathname);
      if (prefix) {                                           // like GitHub Pages: the site lives under /<repository>/
        if (rel === prefix) { res.writeHead(301, { location: prefix + '/' }); res.end(); return; }
        if (!rel.startsWith(prefix + '/')) { res.writeHead(404); res.end('not found'); return; }
        rel = rel.slice(prefix.length);
      }
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.join(dir, rel);
      if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      fs.createReadStream(file).pipe(res);
    } catch (e) { try { res.writeHead(500); res.end(String(e && e.stack || e)); } catch (e2) { /* ignore */ } }
  };
  // two origins, like production: the app is served from one, the "Firebase" API lives on another (so the service worker never sees it)
  const server = http.createServer(handler), apiServer = http.createServer(handler);
  await new Promise(r => server.listen(port, host, r));
  await new Promise(r => apiServer.listen(0, host, r));
  return Object.assign(api, {
    url: 'http://' + host + ':' + server.address().port + (prefix ? prefix + '/' : '/'),
    apiUrl: 'http://' + host + ':' + apiServer.address().port + '/__fake',
    port: server.address().port,
    close: () => new Promise(r => { api.reset(); for (const s of [server, apiServer]) s.closeAllConnections && s.closeAllConnections(); server.close(() => apiServer.close(r)); })
  });
}
