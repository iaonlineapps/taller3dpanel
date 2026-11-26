#!/usr/bin/env node
/*
 * Taller3D Panel · servidor
 * Un solo archivo, sin dependencias: Node 22+ con su SQLite integrado (node:sqlite).
 * Sirve la web (public/), guarda todo en una base de datos SQLite dentro de la carpeta de datos
 * y avisa a todos los dispositivos conectados cuando algo cambia (Server-Sent Events).
 *
 * Variables de entorno:
 *   PORT            puerto (8095)
 *   DATA_DIR        carpeta de datos (./data)  -> taller3d.db
 *   ADMIN_USER / ADMIN_PASSWORD   crea este administrador al arrancar si no existe
 *   ALLOW_REGISTER  1 = cualquiera puede pedir cuenta (el admin la activa); 0 = solo el admin crea cuentas
 *   REQUIRE_EMAIL   1 = pedir email al crear cuentas (recomendado si la usa más gente); 0 = solo usuario y contraseña
 *   SEED_FILE       JSON con ajustes iniciales (impresoras, categorías...) que se aplica la primera vez
 *   TRUST_PROXY     1 = detrás de un proxy (Nginx, Pangolin, Cloudflare): usa X-Forwarded-For / -Proto
 *   FARM_LAN        0 = desactiva la conexión LAN con impresoras Bambu Lab (granja). Por defecto activa.
 */
'use strict';
process.removeAllListeners('warning');
process.on('warning', w => { if (w.name !== 'ExperimentalWarning') console.warn(w); });
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { BambuLink } = require('./bambu');

const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
const PORT = +process.env.PORT || 8095;
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const ALLOW_REGISTER = (process.env.ALLOW_REGISTER ?? '1') === '1';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const REQUIRE_EMAIL = process.env.REQUIRE_EMAIL === '1';
const VERSION = (process.env.TALLER3D_VERSION || '').replace(/^v/i, '').trim() ||
  (() => { try { return fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim(); } catch { return '?'; } })();
const COLLECTIONS = new Set(['products', 'customers', 'collabs', 'sales', 'expenses', 'prints', 'moves', 'spools', 'jobs', 'quotes', 'config', 'profiles', 'farm']);
const MAX_BODY = 3 * 1024 * 1024; // fotos y logos van como imagen reducida dentro del documento
const SESSION_DAYS = 60;
const FARM_LAN = process.env.FARM_LAN !== '0';

fs.mkdirSync(DATA, { recursive: true });
const db = new DatabaseSync(path.join(DATA, 'taller3d.db'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS docs(col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL, by_user TEXT, PRIMARY KEY(col,id));
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL COLLATE NOCASE, name TEXT, pass TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'editor', active INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS farm_secret(id TEXT PRIMARY KEY, access TEXT NOT NULL);`);
try { db.exec('ALTER TABLE users ADD COLUMN email TEXT'); } catch { /* ya existe */ }
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users(email COLLATE NOCASE) WHERE email IS NOT NULL AND email<>\'\'');

const q = {
  allDocs: db.prepare('SELECT col,id,data FROM docs'),
  getDoc: db.prepare('SELECT data FROM docs WHERE col=? AND id=?'),
  putDoc: db.prepare('INSERT INTO docs(col,id,data,updated,by_user) VALUES(?,?,?,?,?) ON CONFLICT(col,id) DO UPDATE SET data=excluded.data,updated=excluded.updated,by_user=excluded.by_user'),
  delDoc: db.prepare('DELETE FROM docs WHERE col=? AND id=?'),
  userByName: db.prepare('SELECT * FROM users WHERE username=?'),
  userByLogin: db.prepare('SELECT * FROM users WHERE username=? OR (email<>\'\' AND email=? COLLATE NOCASE)'),
  userByEmail: db.prepare('SELECT * FROM users WHERE email=? COLLATE NOCASE'),
  setEmail: db.prepare('UPDATE users SET email=? WHERE id=?'),
  setName: db.prepare('UPDATE users SET name=? WHERE id=?'),
  userById: db.prepare('SELECT * FROM users WHERE id=?'),
  users: db.prepare('SELECT id,username,name,email,role,active,created FROM users ORDER BY created'),
  countUsers: db.prepare('SELECT COUNT(*) n FROM users'),
  countAdmins: db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1"),
  addUser: db.prepare('INSERT INTO users(id,username,name,pass,role,active,created,email) VALUES(?,?,?,?,?,?,?,?)'),
  setUser: db.prepare('UPDATE users SET name=?,role=?,active=? WHERE id=?'),
  setPass: db.prepare('UPDATE users SET pass=? WHERE id=?'),
  delUser: db.prepare('DELETE FROM users WHERE id=?'),
  addSess: db.prepare('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)'),
  getSess: db.prepare('SELECT s.user_id,s.expires,u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?'),
  delSess: db.prepare('DELETE FROM sessions WHERE token=?'),
  delUserSess: db.prepare('DELETE FROM sessions WHERE user_id=?'),
  gcSess: db.prepare('DELETE FROM sessions WHERE expires<?'),
  getMeta: db.prepare('SELECT v FROM meta WHERE k=?'),
  setMeta: db.prepare('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v'),
};

// ---------- contraseñas y sesiones ----------
const hashPass = pw => { const salt = crypto.randomBytes(16); const h = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 }); return 'scrypt$' + salt.toString('hex') + '$' + h.toString('hex'); };
const checkPass = (pw, stored) => { try { const [, s, h] = stored.split('$'); const c = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64, { N: 16384, r: 8, p: 1 }); return crypto.timingSafeEqual(c, Buffer.from(h, 'hex')); } catch { return false; } };
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const newId = () => crypto.randomBytes(9).toString('base64url');
const pubUser = u => u && ({ id: u.id, username: u.username, name: u.name || u.username, email: u.email || '', role: u.role, active: !!u.active });
const validEmail = e => /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i.test(e || '');
function checkEmail(e, required, exceptId) {
  e = String(e || '').trim();
  if (!e) { if (required) throw httpErr(400, 'Escribe tu email'); return ''; }
  if (!validEmail(e)) throw httpErr(400, 'El email no es válido');
  const o = q.userByEmail.get(e); if (o && o.id !== exceptId) throw httpErr(409, 'Ese email ya lo usa otra cuenta');
  return e;
}
const validName = s => /^[a-zA-Z0-9._-]{3,32}$/.test(s || '');

function createUser({ username, name, password, email, role = 'editor', active = true, needEmail = false }) {
  if (!validName(username)) throw httpErr(400, 'El usuario debe tener de 3 a 32 letras, números, punto, guion o guion bajo');
  if (!password || String(password).length < 4) throw httpErr(400, 'La contraseña debe tener al menos 4 caracteres');
  if (q.userByName.get(username)) throw httpErr(409, 'Ese usuario ya existe');
  const em = checkEmail(email, needEmail);
  if (!['admin', 'editor', 'lector'].includes(role)) role = 'editor';
  const id = newId();
  q.addUser.run(id, username, String(name || username).slice(0, 80), hashPass(String(password)), role, active ? 1 : 0, Date.now(), em);
  return q.userById.get(id);
}
if (process.env.ADMIN_USER && process.env.ADMIN_PASSWORD && !q.userByName.get(process.env.ADMIN_USER)) {
  try { createUser({ username: process.env.ADMIN_USER, name: process.env.ADMIN_USER, password: process.env.ADMIN_PASSWORD, role: 'admin' }); console.log('Administrador creado:', process.env.ADMIN_USER); }
  catch (e) { console.error('No se pudo crear el administrador:', e.message); }
}
// Ajustes iniciales (impresoras, categorías, nombre...) solo la primera vez
if (!q.getMeta.get('seeded')) {
  const f = process.env.SEED_FILE || path.join(ROOT, 'seed.json');
  try { if (fs.existsSync(f)) { const s = JSON.parse(fs.readFileSync(f, 'utf8')); if (s && typeof s === 'object') { q.putDoc.run('config', 'main', JSON.stringify(s), Date.now(), 'seed'); console.log('Ajustes iniciales aplicados desde', path.basename(f)); } } }
  catch (e) { console.error('seed.json no válido:', e.message); }
  q.setMeta.run('seeded', '1');
}

function httpErr(code, msg) { const e = new Error(msg); e.code = code; return e; }
function cookies(req) { const o = {}; (req.headers.cookie || '').split(';').forEach(c => { const i = c.indexOf('='); if (i > 0) o[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); }); return o; }
function isHttps(req) { return req.socket.encrypted || (TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').startsWith('https')); }
function clientIp(req) { return (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?'; }
function auth(req) {
  const t = cookies(req).t3d; if (!t) return null;
  const s = q.getSess.get(sha(t)); if (!s || s.expires < Date.now() || !s.active) return null;
  return s;
}
function startSession(req, res, user) {
  const t = crypto.randomBytes(32).toString('base64url');
  q.addSess.run(sha(t), user.id, Date.now() + SESSION_DAYS * 864e5);
  res.setHeader('Set-Cookie', `t3d=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${isHttps(req) ? '; Secure' : ''}`);
}
setInterval(() => q.gcSess.run(Date.now()), 36e5).unref();

// Freno a los intentos de contraseña: 10 fallos en 15 minutos por IP
const fails = new Map();
function tooMany(ip) { const f = fails.get(ip); return f && f.n >= 10 && Date.now() - f.t < 9e5; }
function failed(ip) { const f = fails.get(ip); if (!f || Date.now() - f.t > 9e5) fails.set(ip, { n: 1, t: Date.now() }); else f.n++; }

// ---------- tiempo real ----------
const clients = new Set();
function broadcast(msg) { const s = `data: ${JSON.stringify(msg)}\n\n`; for (const c of clients) { try { c.write(s); } catch { } } }
setInterval(() => { for (const c of clients) { try { c.write(': ping\n\n'); } catch { } } }, 25e3).unref();
// ---------- granja de impresoras (Bambu Lab por LAN) ----------
// El código de acceso de cada impresora se guarda SOLO aquí (tabla farm_secret) y nunca se manda a la web.
const links = new Map(); // id -> { link, key }
const liveTimers = new Map();
const getSecret = db.prepare('SELECT access FROM farm_secret WHERE id=?');
const putSecret = db.prepare('INSERT INTO farm_secret(id,access) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET access=excluded.access');
const delSecret = db.prepare('DELETE FROM farm_secret WHERE id=?');
const farmDocs = db.prepare("SELECT id,data FROM docs WHERE col='farm'");
function pushLive(id) {
  if (liveTimers.has(id)) return; // como mucho un aviso por segundo y por impresora
  liveTimers.set(id, setTimeout(() => { liveTimers.delete(id); const l = links.get(id); broadcast({ farm: { id, live: l ? l.link.summary() : null } }); }, 1000));
}
function farmSync() {
  if (!FARM_LAN) return;
  const want = new Map();
  for (const r of farmDocs.all()) {
    let d; try { d = JSON.parse(r.data); } catch { continue; }
    const sec = getSecret.get(r.id);
    if (d.lan && d.ip && d.serial && sec) want.set(r.id, { host: String(d.ip).trim(), serial: String(d.serial).trim(), code: sec.access, port: +d.port || 8883 });
  }
  for (const [id, l] of links) { const w = want.get(id); if (!w || JSON.stringify(w) !== l.key) { l.link.close(); links.delete(id); broadcast({ farm: { id, live: null } }); } }
  for (const [id, w] of want) if (!links.has(id)) { const link = new BambuLink(w); link.on('update', () => pushLive(id)); links.set(id, { link, key: JSON.stringify(w) }); }
}
function farmLive() { const o = {}; for (const r of farmDocs.all()) { const l = links.get(r.id); o[r.id] = { hasAccess: !!getSecret.get(r.id), live: l ? l.link.summary() : null }; } return o; }


// ---------- utilidades HTTP ----------
const SEC = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
  'Permissions-Policy': 'camera=(self), microphone=()',
};
function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  if (type.startsWith('application/json') && typeof body !== 'string') body = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...SEC, ...extra }); res.end(body);
}
function readBody(req) {
  return new Promise((ok, ko) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > MAX_BODY) { ko(httpErr(413, 'Demasiado grande')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { if (!n) return ok({}); try { ok(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { ko(httpErr(400, 'JSON no válido')); } });
    req.on('error', ko);
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
function serveStatic(req, res, p) {
  if (p === '/' || p === '') p = '/index.html';
  const f = path.join(PUB, path.normalize(decodeURIComponent(p)).replace(/^([/\\])+/, ''));
  if (!f.startsWith(PUB + path.sep) || p.includes('\0')) return send(res, 404, 'No encontrado', 'text/plain');
  fs.stat(f, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'No encontrado', 'text/plain');
    const ext = path.extname(f).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400', ...SEC });
    fs.createReadStream(f).pipe(res);
  });
}
function allData() {
  const out = {}; for (const r of q.allDocs.all()) { (out[r.col] = out[r.col] || {})[r.id] = JSON.parse(r.data); } return out;
}
const canWrite = u => u && (u.role === 'admin' || u.role === 'editor');
function cleanDoc(d) { if (!d || typeof d !== 'object' || Array.isArray(d)) throw httpErr(400, 'Documento no válido'); return d; }

// ---------- rutas ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  // Funciona también publicado en una subcarpeta del proxy (por ejemplo /taller): se usa el final de la ruta
  const ai = url.pathname.indexOf('/api/');
  const p = ai >= 0 ? url.pathname.slice(ai) : url.pathname;
  const M = req.method;
  try {
    if (p === '/health') return send(res, 200, 'ok', 'text/plain');
    if (!p.startsWith('/api/')) { if (M !== 'GET' && M !== 'HEAD') return send(res, 405, 'Método no permitido', 'text/plain'); return serveStatic(req, res, url.pathname); }
    // Protección CSRF: las peticiones que cambian algo deben venir de la propia web
    if (M !== 'GET') {
      const o = req.headers.origin; const host = req.headers['x-forwarded-host'] || req.headers.host;
      if (o && host && new URL(o).host !== String(host).split(',')[0].trim()) return send(res, 403, { error: 'Origen no permitido' });
    }
    const me = auth(req);
    if (p === '/api/me' && M === 'GET') return send(res, 200, { user: pubUser(me), needSetup: q.countUsers.get().n === 0, allowRegister: ALLOW_REGISTER, requireEmail: REQUIRE_EMAIL, version: VERSION });
    if (p === '/api/setup' && M === 'POST') {
      if (q.countUsers.get().n > 0) return send(res, 403, { error: 'Ya hay usuarios creados' });
      const b = await readBody(req); const u = createUser({ ...b, role: 'admin', active: true, needEmail: REQUIRE_EMAIL }); startSession(req, res, u); return send(res, 200, { user: pubUser(u) });
    }
    if (p === '/api/login' && M === 'POST') {
      const ip = clientIp(req); if (tooMany(ip)) return send(res, 429, { error: 'Demasiados intentos. Espera 15 minutos.' });
      const b = await readBody(req); const login = String(b.username || '').trim(); const u = q.userByLogin.get(login, login);
      if (!u || !checkPass(String(b.password || ''), u.pass)) { failed(ip); return send(res, 401, { error: 'Usuario o contraseña incorrectos' }); }
      if (!u.active) return send(res, 403, { error: 'Tu cuenta está pendiente de que un administrador la active' });
      fails.delete(ip); startSession(req, res, u); return send(res, 200, { user: pubUser(u) });
    }
    if (p === '/api/register' && M === 'POST') {
      if (!ALLOW_REGISTER) return send(res, 403, { error: 'El registro está cerrado. Pide una cuenta al administrador.' });
      const ip = clientIp(req); if (tooMany(ip)) return send(res, 429, { error: 'Demasiados intentos' }); failed(ip);
      const b = await readBody(req); createUser({ username: b.username, name: b.name, email: b.email, password: b.password, role: 'editor', active: false, needEmail: REQUIRE_EMAIL }); return send(res, 200, { ok: true });
    }
    if (!me) return send(res, 401, { error: 'Inicia sesión' });
    if (p === '/api/logout' && M === 'POST') { q.delSess.run(sha(cookies(req).t3d || '')); res.setHeader('Set-Cookie', 't3d=; Path=/; Max-Age=0'); return send(res, 200, { ok: true }); }
    if (p === '/api/password' && M === 'POST') {
      const b = await readBody(req); if (!checkPass(String(b.old || ''), me.pass)) return send(res, 400, { error: 'La contraseña actual no es correcta' });
      if (String(b.password || '').length < 4) return send(res, 400, { error: 'Mínimo 4 caracteres' });
      q.setPass.run(hashPass(String(b.password)), me.id); return send(res, 200, { ok: true });
    }
    if (p === '/api/me' && M === 'PATCH') {
      const b = await readBody(req);
      if (b.name !== undefined) q.setName.run(String(b.name || me.username).slice(0, 80), me.id);
      if (b.email !== undefined) q.setEmail.run(checkEmail(b.email, REQUIRE_EMAIL, me.id), me.id);
      return send(res, 200, { user: pubUser(q.userById.get(me.id)) });
    }
    if (p === '/api/data' && M === 'GET') return send(res, 200, allData());
    if (p === '/api/stream' && M === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive', ...SEC });
      res.write('retry: 3000\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return;
    }
    let m = p.match(/^\/api\/doc\/([a-z]+)\/([A-Za-z0-9._~:@+-]{1,120})$/);
    if (m) {
      const [, col, id] = m; if (!COLLECTIONS.has(col)) return send(res, 400, { error: 'Colección no válida' });
      if (M === 'GET') { const r = q.getDoc.get(col, id); return r ? send(res, 200, r.data) : send(res, 404, { error: 'No existe' }); }
      if (!canWrite(me)) return send(res, 403, { error: 'Tu usuario solo puede ver, no cambiar datos' });
      if (col === 'config' && me.role !== 'admin') return send(res, 403, { error: 'Solo un administrador puede cambiar los ajustes' });
      if (M === 'PUT' || M === 'PATCH') {
        let d = cleanDoc(await readBody(req));
        if (M === 'PATCH') { const r = q.getDoc.get(col, id); if (!r) return send(res, 404, { error: 'No existe' }); d = { ...JSON.parse(r.data), ...d }; }
        q.putDoc.run(col, id, JSON.stringify(d), Date.now(), me.id); broadcast({ col, id, data: d }); if (col === 'farm') farmSync(); return send(res, 200, { ok: true });
      }
      if (M === 'DELETE') { q.delDoc.run(col, id); broadcast({ col, id, data: null }); if (col === 'farm') { delSecret.run(id); farmSync(); } return send(res, 200, { ok: true }); }
    }
    if (p === '/api/backup' && M === 'GET') {
      if (me.role !== 'admin') return send(res, 403, { error: 'Solo administradores' });
      const name = `taller3d-copia-${new Date().toISOString().slice(0, 10)}.json`;
      return send(res, 200, JSON.stringify({ app: 'taller3dpanel', version: VERSION, date: new Date().toISOString(), data: allData() }), 'application/json; charset=utf-8', { 'Content-Disposition': `attachment; filename="${name}"` });
    }
    if (p === '/api/restore' && M === 'POST') {
      if (me.role !== 'admin') return send(res, 403, { error: 'Solo administradores' });
      const b = await readBody(req); const d = b && b.data; if (!d || typeof d !== 'object') return send(res, 400, { error: 'Copia no válida' });
      db.exec('BEGIN'); try { db.exec('DELETE FROM docs'); for (const [col, docs] of Object.entries(d)) { if (!COLLECTIONS.has(col)) continue; for (const [id, doc] of Object.entries(docs || {})) q.putDoc.run(col, id, JSON.stringify(doc), Date.now(), me.id); } db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
      broadcast({ reload: true }); farmSync(); return send(res, 200, { ok: true });
    }
    // Descargas generadas por la web (tickets, CSV, etiquetas): la app de Android las guarda con su gestor de descargas
    if (p === '/api/export' && M === 'POST') {
      const b = await readBody(req); const tok = crypto.randomBytes(18).toString('base64url');
      const isImg = /^image\/(jpeg|png|webp)$/.test(b.type) && typeof b.b64 === 'string';
      exportsMap.set(tok, { name: String(b.filename || 'archivo.txt').replace(/[^\w.\-ñÑáéíóúÁÉÍÓÚ ]/g, '_').slice(0, 100), type: isImg ? b.type : /^(text\/(html|csv|plain)|application\/json)$/.test(b.type) ? b.type : 'text/plain', body: isImg ? Buffer.from(b.b64, 'base64') : String(b.content || ''), t: Date.now(), user: me.id });
      return send(res, 200, { url: 'api/export/' + tok });
    }
    m = p.match(/^\/api\/export\/([\w-]+)$/);
    if (m && M === 'GET') {
      const x = exportsMap.get(m[1]); if (!x || x.user !== me.id) return send(res, 404, { error: 'Caducado' });
      return send(res, 200, x.body, x.type.startsWith('image/') ? x.type : x.type + '; charset=utf-8', { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(x.name)}` });
    }
    // ----- granja -----
    if (p === '/api/farm/live' && M === 'GET') return send(res, 200, { enabled: FARM_LAN, printers: farmLive() });
    m = p.match(/^\/api\/farm\/([A-Za-z0-9._~:@+-]{1,120})\/(access|cmd)$/);
    if (m && M === 'POST') {
      const [, id, what] = m; const b = await readBody(req);
      if (!q.getDoc.get('farm', id)) return send(res, 404, { error: 'No existe esa impresora' });
      if (what === 'access') {
        if (me.role !== 'admin') return send(res, 403, { error: 'Solo un administrador puede guardar el código de acceso' });
        const code = String(b.code || '').trim();
        if (!code) delSecret.run(id); else if (!/^[A-Za-z0-9]{4,32}$/.test(code)) return send(res, 400, { error: 'El código de acceso son 8 caracteres (letras y números) que salen en la pantalla de la impresora' }); else putSecret.run(id, code);
        farmSync(); pushLive(id); return send(res, 200, { ok: true, hasAccess: !!code });
      }
      if (!canWrite(me)) return send(res, 403, { error: 'Tu usuario solo puede ver' });
      if (!FARM_LAN) return send(res, 400, { error: 'El control LAN está desactivado en este servidor (FARM_LAN=0)' });
      const l = links.get(id); if (!l || !l.link.online) return send(res, 409, { error: (l && l.link.error) || 'La impresora no está conectada' });
      if (!['pause', 'resume', 'stop', 'light', 'speed', 'refresh'].includes(b.cmd)) return send(res, 400, { error: 'Orden no válida' });
      if (['stop'].includes(b.cmd) && me.role === 'lector') return send(res, 403, { error: 'No permitido' });
      l.link.command(b.cmd, b.value); setTimeout(() => l.link.command('refresh'), 800);
      return send(res, 200, { ok: true });
    }
    // ----- usuarios -----
    if (p === '/api/users' && M === 'GET') { if (me.role !== 'admin') return send(res, 403, { error: 'Solo administradores' }); return send(res, 200, q.users.all().map(pubUser)); }
    if (p === '/api/users' && M === 'POST') { if (me.role !== 'admin') return send(res, 403, { error: 'Solo administradores' }); const b = await readBody(req); return send(res, 200, pubUser(createUser({ ...b, needEmail: false }))); }
    m = p.match(/^\/api\/users\/([\w-]+)$/);
    if (m) {
      if (me.role !== 'admin') return send(res, 403, { error: 'Solo administradores' });
      const u = q.userById.get(m[1]); if (!u) return send(res, 404, { error: 'No existe' });
      if (M === 'PATCH') {
        const b = await readBody(req); const role = ['admin', 'editor', 'lector'].includes(b.role) ? b.role : u.role; const active = b.active === undefined ? !!u.active : !!b.active;
        if (u.role === 'admin' && (role !== 'admin' || !active) && q.countAdmins.get().n <= 1) return send(res, 400, { error: 'Tiene que quedar al menos un administrador activo' });
        q.setUser.run(String(b.name || u.name).slice(0, 80), role, active ? 1 : 0, u.id);
        if (b.email !== undefined) q.setEmail.run(checkEmail(b.email, false, u.id), u.id);
        if (b.password) { if (String(b.password).length < 4) return send(res, 400, { error: 'Mínimo 4 caracteres' }); q.setPass.run(hashPass(String(b.password)), u.id); q.delUserSess.run(u.id); }
        if (!active) q.delUserSess.run(u.id);
        return send(res, 200, pubUser(q.userById.get(u.id)));
      }
      if (M === 'DELETE') { if (u.id === me.id) return send(res, 400, { error: 'No puedes borrarte a ti mismo' }); if (u.role === 'admin' && q.countAdmins.get().n <= 1) return send(res, 400, { error: 'Tiene que quedar al menos un administrador' }); q.delUser.run(u.id); return send(res, 200, { ok: true }); }
    }
    return send(res, 404, { error: 'No encontrado' });
  } catch (e) {
    const code = typeof e.code === 'number' ? e.code : 500; if (code === 500) console.error(e);
    if (!res.headersSent) send(res, code, { error: code === 500 ? 'Error interno' : e.message });
  }
});
const exportsMap = new Map();
setInterval(() => { const lim = Date.now() - 6e5; for (const [k, v] of exportsMap) if (v.t < lim) exportsMap.delete(k); }, 6e4).unref();

server.listen(PORT, () => { console.log(`Taller3D Panel ${VERSION} en http://0.0.0.0:${PORT}  ·  datos en ${DATA}`); farmSync(); });
const bye = () => { for (const l of links.values()) l.link.close(); try { db.close(); } catch { } process.exit(0); };
process.on('SIGTERM', bye); process.on('SIGINT', bye);
