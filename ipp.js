'use strict';
/* Taller3D Panel · imprimir por CUPS (IPP) sin dependencias.
   El servidor corre en Docker; CUPS está en la Raspberry (lo instala etiquetas.sh) y escucha en el puerto 631.
   Desde el contenedor se llega a la Raspberry por la puerta de enlace de la red de Docker (o por CUPS_HOST).
   Print a PDF through CUPS (IPP), list printers and read their paper. No dependencies. */
const http = require('node:http');
const fs = require('node:fs');
const dns = require('node:dns').promises;
const net = require('node:net');

const T = { op: 0x01, job: 0x02, end: 0x03, printer: 0x04, int: 0x21, bool: 0x22, enum: 0x23, text: 0x41, name: 0x42, keyword: 0x44, uri: 0x45, charset: 0x47, lang: 0x48, mime: 0x49 };
const OP = { print: 0x0002, cancel: 0x0008, job: 0x0009, printer: 0x000B, list: 0x4002 };
const JOB_STATE = { 3: 'pending', 4: 'held', 5: 'processing', 6: 'stopped', 7: 'canceled', 8: 'aborted', 9: 'completed' };

function attr(tag, name, values) {
  const out = [];
  (Array.isArray(values) ? values : [values]).forEach((v, i) => {
    let b;
    if (tag === T.int || tag === T.enum) { b = Buffer.alloc(4); b.writeInt32BE(v | 0); }
    else if (tag === T.bool) b = Buffer.from([v ? 1 : 0]);
    else b = Buffer.from(String(v), 'utf8');
    const n = i ? Buffer.alloc(0) : Buffer.from(name, 'utf8');
    const h = Buffer.alloc(3); h[0] = tag; h.writeUInt16BE(n.length, 1);
    const l = Buffer.alloc(2); l.writeUInt16BE(b.length);
    out.push(h, n, l, b);
  });
  return Buffer.concat(out);
}
let reqId = 1;
function request(op, opAttrs, jobAttrs = []) {
  const head = Buffer.alloc(8); head.writeUInt16BE(0x0200, 0); head.writeUInt16BE(op, 2); head.writeUInt32BE(reqId++ & 0x7fffffff, 4);
  const parts = [head, Buffer.from([T.op]), attr(T.charset, 'attributes-charset', 'utf-8'), attr(T.lang, 'attributes-natural-language', 'en'), ...opAttrs];
  if (jobAttrs.length) parts.push(Buffer.from([T.job]), ...jobAttrs);
  parts.push(Buffer.from([T.end]));
  return Buffer.concat(parts);
}
// Respuesta IPP → { status, groups: [{ tag, attrs: { nombre: [valores] } }] }
function parse(buf) {
  if (buf.length < 8) throw new Error('Respuesta IPP vacía');
  const status = buf.readUInt16BE(2); let i = 8; const groups = []; let g = null, last = null;
  while (i < buf.length) {
    const tag = buf[i++];
    if (tag === T.end) break;
    if (tag < 0x10) { g = { tag, attrs: {} }; groups.push(g); last = null; continue; }
    const nl = buf.readUInt16BE(i); i += 2; const name = buf.toString('utf8', i, i + nl); i += nl;
    const vl = buf.readUInt16BE(i); i += 2; const raw = buf.subarray(i, i + vl); i += vl;
    let v;
    if ((tag === T.int || tag === T.enum) && vl === 4) v = raw.readInt32BE(0);
    else if (tag === T.bool) v = !!raw[0];
    else if (tag >= 0x40 && tag < 0x60) v = raw.toString('utf8');
    else v = null; // colecciones, fechas, resoluciones: no nos hacen falta
    if (!g) continue;
    if (nl) { last = name; g.attrs[name] = []; }
    if (last && v !== null) g.attrs[last].push(v);
  }
  return { status, groups };
}
const first = (r, tag) => (r.groups.find(g => g.tag === tag) || { attrs: {} }).attrs;

// ----- dónde está CUPS -----
function gateway() { // puerta de enlace del contenedor = la Raspberry
  try {
    for (const l of fs.readFileSync('/proc/net/route', 'utf8').split('\n').slice(1)) {
      const c = l.trim().split(/\s+/); if (c[1] === '00000000' && c[2] && c[2] !== '00000000') {
        const h = c[2]; return [6, 4, 2, 0].map(k => parseInt(h.slice(k, k + 2), 16)).join('.');
      }
    }
  } catch { }
  return '';
}
async function toIp(h) { if (!h) return ''; if (net.isIP(h)) return h; try { return (await dns.lookup(h, { family: 4 })).address; } catch { return ''; } }
// Lista de sitios donde probar, por orden. CUPS solo acepta como «Host» una IP o localhost, por eso se resuelve a IP.
async function hosts(pref) {
  const c = [pref, process.env.CUPS_HOST, 'host.docker.internal', gateway(), '127.0.0.1'].map(x => String(x || '').trim()).filter(Boolean);
  const out = [];
  for (const h of c) { const [name, port] = h.replace(/^\w+:\/\//, '').replace(/\/.*$/, '').split(':'); const ip = await toIp(name); if (ip && !out.some(o => o.ip === ip)) out.push({ ip, port: +port || 631 }); }
  return out;
}
function post(h, path, body, ms = 6000) {
  return new Promise((ok, ko) => {
    const r = http.request({ host: h.ip, port: h.port, path, method: 'POST', headers: { 'Content-Type': 'application/ipp', 'Content-Length': body.length, Host: h.ip + ':' + h.port }, timeout: ms }, res => {
      const ch = []; res.on('data', c => ch.push(c)); res.on('end', () => {
        if (res.statusCode !== 200) return ko(Object.assign(new Error('CUPS respondió ' + res.statusCode), { http: res.statusCode }));
        try { ok(parse(Buffer.concat(ch))); } catch (e) { ko(e); }
      });
    });
    r.on('timeout', () => r.destroy(new Error('CUPS no responde'))); r.on('error', ko); r.end(body);
  });
}
const queueUri = (h, q) => `ipp://${h.ip}:${h.port}/printers/${encodeURIComponent(q)}`;
const cleanQueue = q => String(q || '').replace(/[^\w.@-]/g, '').slice(0, 127);

// Busca un CUPS que conteste (y lo recuerda unos minutos)
let found = null;
async function cups(pref) {
  if (found && found.pref === (pref || '') && Date.now() - found.t < 3e5) return found.h;
  let err = null;
  for (const h of await hosts(pref)) {
    try { await post(h, '/', request(OP.list, [attr(T.keyword, 'requested-attributes', 'printer-name'), attr(T.int, 'limit', 1)]), 2500); found = { pref: pref || '', h, t: Date.now() }; return h; }
    catch (e) { err = e; }
  }
  if (err) console.log('CUPS:', err.message);
  throw Object.assign(new Error('No encuentro CUPS en la Raspberry. Instálalo con etiquetas.sh'), { nocups: true });
}

// Lee el papel: «62x29mm», «Custom.62x100mm», «iso_a4_210x297mm», «A4», «na_letter_8.5x11in»… → { w, h } en mm (h = 0 si es continuo)
function paperOf(m) {
  m = String(m || '');
  if (/(^|_)a4\b|^A4/i.test(m)) return { w: 210, h: 297, a4: true, name: m };
  if (/letter/i.test(m)) return { w: 216, h: 279, a4: true, name: m };
  let x = m.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)mm/i);
  if (x) { const w = +x[1], h = +x[2]; return { w, h: /cont|roll/i.test(m) ? 0 : h, a4: w >= 200, name: m }; }
  x = m.match(/^(?:roll_\w+_)?(\d+(?:\.\d+)?)mm/i) || m.match(/(\d+(?:\.\d+)?)\s*mm\b/i);
  if (x) return { w: +x[1], h: 0, a4: false, name: m };
  return null;
}
// Nombre del papel para IPP (PWG): «Custom.62x153mm» → custom_62x153mm_62x153mm, «A4» → iso_a4_210x297mm
function pwg(m) { if (m === 'A4') return 'iso_a4_210x297mm'; const x = m.match(/^(?:Custom\.)?(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)mm$/); return x ? `custom_${x[1]}x${x[2]}mm_${x[1]}x${x[2]}mm` : m; }
const PR_ATTRS = ['printer-name', 'printer-info', 'printer-make-and-model', 'printer-state', 'printer-state-reasons', 'printer-is-accepting-jobs', 'media-default', 'media-ready', 'printer-location', 'device-uri'];
function view(a) {
  const make = (a['printer-make-and-model'] || [''])[0], reasons = a['printer-state-reasons'] || [];
  const media = (a['media-ready'] || [])[0] || (a['media-default'] || [])[0] || '';
  const label = /\bQL-|ptouch|P-touch|label|etiquet|DYMO|Zebra|thermal|TSC|Xprinter|POS-?\d|receipt/i.test(make + ' ' + (a['printer-name'] || [''])[0]);
  return {
    name: (a['printer-name'] || [''])[0], info: (a['printer-info'] || [''])[0], make, location: (a['printer-location'] || [''])[0],
    state: { 3: 'idle', 4: 'processing', 5: 'stopped' }[(a['printer-state'] || [0])[0]] || 'unknown', reasons: reasons.filter(r => r !== 'none'),
    accepting: (a['printer-is-accepting-jobs'] || [true])[0] !== false, media, paper: paperOf(media), label,
    offline: reasons.some(r => /offline|connecting-to-device|shutdown/.test(r)),
  };
}
async function list(pref) {
  const h = await cups(pref);
  const r = await post(h, '/', request(OP.list, [attr(T.keyword, 'requested-attributes', PR_ATTRS)]));
  return { host: h.ip, printers: r.groups.filter(g => g.tag === T.printer).map(g => view(g.attrs)) };
}
async function status(queue, pref) {
  const h = await cups(pref), q = cleanQueue(queue);
  const r = await post(h, '/printers/' + encodeURIComponent(q), request(OP.printer, [attr(T.uri, 'printer-uri', queueUri(h, q)), attr(T.keyword, 'requested-attributes', PR_ATTRS)]));
  if (r.status >= 0x400) throw Object.assign(new Error('No existe la impresora «' + q + '» en la Raspberry'), { noqueue: true });
  return { host: h.ip, ...view(first(r, T.printer)) };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* Manda un PDF. media: nombre del papel para el driver («Custom.62x153mm», «62x29mm», «A4»).
   Espera un poco a ver si sale: si la impresora no está (desenchufada o apagada) cancela el trabajo y avisa,
   para que la web abra el diálogo normal de imprimir. */
async function print({ queue, host, pdf, media, kind, title, user, copies }) {
  const st = await status(queue, host);
  if (st.state === 'stopped' || !st.accepting) throw Object.assign(new Error('La impresora «' + st.name + '» está parada en CUPS'), { offline: true });
  const h = await cups(host), q = cleanQueue(queue), path = '/printers/' + encodeURIComponent(q);
  const job = [];
  if (media) job.push(attr(T.keyword, 'media', pwg(media)), attr(T.name, 'PageSize', media));
  // Brother QL (driver ptouch): rollo continuo o etiquetas troqueladas
  if (kind === 'roll' || kind === 'label') job.push(attr(T.name, 'MediaType', kind === 'roll' ? 'Tape' : 'Labels'));
  job.push(attr(T.keyword, 'print-scaling', 'none'), attr(T.int, 'copies', Math.max(1, Math.min(9, copies | 0 || 1))));
  // request() ya termina con «end-of-attributes»: el PDF va pegado justo detrás
  const body = ja => Buffer.concat([request(OP.print, [attr(T.uri, 'printer-uri', queueUri(h, q)), attr(T.name, 'requesting-user-name', String(user || 'taller3d').slice(0, 60)), attr(T.name, 'job-name', String(title || 'Ticket').slice(0, 120)), attr(T.mime, 'document-format', 'application/pdf')], ja), pdf]);
  let r = await post(h, path, body(job), 20000);
  // CUPS antiguos o colas sin papel a medida: se reintenta solo con el tamaño para el driver (PageSize)
  if (r.status >= 0x400 && media) r = await post(h, path, body([attr(T.name, 'PageSize', media)]), 20000);
  if (r.status >= 0x400) r = await post(h, path, body([]), 20000);
  if (r.status >= 0x400) throw new Error('CUPS no aceptó el trabajo (código 0x' + r.status.toString(16) + ')');
  const ja = first(r, T.job), id = (ja['job-id'] || [0])[0];
  // Seguimiento: hasta 12 s
  for (let i = 0; i < 12; i++) {
    await sleep(1000);
    let s, why = [];
    try {
      const jr = await post(h, path, request(OP.job, [attr(T.uri, 'printer-uri', queueUri(h, q)), attr(T.int, 'job-id', id), attr(T.keyword, 'requested-attributes', ['job-state', 'job-state-reasons'])]));
      const a = first(jr, T.job); s = JOB_STATE[(a['job-state'] || [0])[0]]; why = a['job-state-reasons'] || [];
    } catch { break; }
    if (s === 'completed') return { ok: true, job: id, done: true };
    if (s === 'canceled' || s === 'aborted' || s === 'stopped') throw Object.assign(new Error('La impresora no ha podido imprimir (' + (why[0] || s) + ')'), { offline: true });
    let p = null; try { p = await status(q, host); } catch { }
    if (p && (p.offline || p.state === 'stopped') && i >= 2) {
      try { await post(h, path, request(OP.cancel, [attr(T.uri, 'printer-uri', queueUri(h, q)), attr(T.int, 'job-id', id), attr(T.name, 'requesting-user-name', String(user || 'taller3d').slice(0, 60))])); } catch { }
      throw Object.assign(new Error('La impresora no responde: ¿está enchufada y encendida?'), { offline: true });
    }
  }
  return { ok: true, job: id, done: false };
}
module.exports = { list, status, print, paperOf, _parse: parse, _request: request, _attr: attr, T, OP };
