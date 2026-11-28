'use strict';
/*
 * Impresoras de otras marcas en la red de casa (además de las Bambu Lab de bambu.js).
 * Se pregunta a la impresora cada pocos segundos por HTTP y se devuelve el estado con la MISMA
 * forma que BambuLink (summary(), state.print.gcode_state, command()), así la granja, el historial
 * y el bot de Telegram funcionan igual con todas.
 *
 *   moonraker  · Klipper con Moonraker (Mainsail / Fluidd): Creality K1/K2 rooteada, Voron, Qidi,
 *                Sovol, Elegoo Neptune 4, Anycubic Kobra con Klipper…   Puerto 7125 (o el 80 de Mainsail).
 *                Clave API opcional (solo si has activado la autorización en Moonraker).
 *   octoprint  · OctoPrint (OctoPi en una Raspberry junto a la impresora). Necesita su clave API
 *                (OctoPrint → Ajustes → Application Keys o API).
 *   prusalink  · PrusaLink de Prusa (MK4/MK4S, MK3.9, XL, MINI+, CORE One). Usuario «maker» y la
 *                contraseña que sale en la impresora (Ajustes → Red → PrusaLink), o una clave API.
 *
 * Estados que se devuelven: IDLE, PREPARE, RUNNING, PAUSE, FINISH, FAILED.
 * Sin dependencias: solo fetch de Node 22.
 */
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const KINDS = {
  moonraker: { name: 'Klipper (Moonraker)', port: 7125 },
  octoprint: { name: 'OctoPrint', port: 80 },
  prusalink: { name: 'PrusaLink', port: 80 },
};

/** "192.168.1.60", "192.168.1.60:7125" o "http://impresora.local" -> URL base sin barra final. */
function baseUrl(addr, kind) {
  let a = String(addr || '').trim().replace(/\/+$/, '');
  if (!a) return '';
  if (!/^https?:\/\//i.test(a)) a = 'http://' + a;
  try {
    const u = new URL(a);
    if (!u.port && kind === 'moonraker' && u.protocol === 'http:' && u.pathname === '/') u.port = String(KINDS.moonraker.port);
    return u.toString().replace(/\/+$/, '');
  } catch { return ''; }
}

const md5 = s => crypto.createHash('md5').update(s).digest('hex');
const num = v => (v == null || v === '' || isNaN(+v)) ? null : +v;

class NetLink extends EventEmitter {
  constructor({ kind, url, user = '', secret = '' }) {
    super();
    Object.assign(this, { kind, url: baseUrl(url, kind), user: String(user || '').trim(), secret: String(secret || '').trim() });
    this.online = false; this.error = ''; this.sm = null; this.closed = false; this.fails = 0;
    this.digest = null; this.nc = 0; this.wasRunning = false; this.lastPct = 0; this.ended = '';
    this.jobId = null; this.timer = null; this.loop();
  }
  /** Estado con la forma de las Bambu (track() de server.js mira state.print.gcode_state). */
  get state() { return this.online && this.sm ? { print: { gcode_state: this.sm.state } } : {}; }
  summary() {
    if (this.online && this.sm) return { ...this.sm, online: true, error: '', updated: Date.now() };
    return { online: false, error: this.error, state: '', percent: null, remaining: null, layer: null, layers: null, file: '', nozzle: null, nozzleT: null, bed: null, bedT: null, chamber: null, speed: null, light: null, trays: [], ams: [], wifi: '', errors: 0, printError: 0, updated: Date.now() };
  }
  async loop() {
    if (this.closed) return;
    let wait = 5000;
    try {
      const sm = await this.poll();
      const changed = !this.online || JSON.stringify(sm) !== JSON.stringify(this.sm);
      this.sm = sm; this.online = true; this.error = ''; this.fails = 0;
      if (changed) this.emit('update');
    } catch (e) {
      this.fails++;
      const msg = e.message || 'Error de conexión';
      // dos fallos seguidos = sin conexión (un fallo suelto de la Wi-Fi no cuenta)
      if (this.fails >= 2 || !this.online) { const was = this.online || this.error !== msg; this.online = false; this.error = msg; if (was) this.emit('update'); }
      wait = Math.min(60000, 5000 * this.fails);
    }
    if (!this.closed) this.timer = setTimeout(() => this.loop(), wait);
  }
  /** Petición HTTP con la clave o la contraseña que toque. */
  async req(path, { method = 'GET', body } = {}) {
    if (!this.url) throw new Error('Falta la dirección de la impresora');
    const headers = { accept: 'application/json' };
    if (body) headers['content-type'] = 'application/json';
    if (this.secret && (this.kind === 'octoprint' || this.kind === 'moonraker' || (this.kind === 'prusalink' && !this.user))) headers['X-Api-Key'] = this.secret;
    if (this.digest) headers.authorization = this.digestHeader(method, path);
    let r;
    try {
      r = await fetch(this.url + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
    } catch (e) {
      const c = (e.cause && e.cause.code) || e.name;
      throw new Error(c === 'TimeoutError' || c === 'ETIMEDOUT' || c === 'EHOSTUNREACH' ? 'No se encuentra la impresora en la red' : c === 'ECONNREFUSED' ? 'Conexión rechazada: ¿es correcta la dirección y el puerto?' : 'No se puede conectar con la impresora');
    }
    if (r.status === 401 && this.kind === 'prusalink' && this.user && !this.digestRetry) {
      const h = r.headers.get('www-authenticate') || '';
      if (/^digest/i.test(h)) {
        const p = {}; h.replace(/(\w+)="?([^",]+)"?/g, (_, k, v) => { p[k] = v; });
        this.digest = { realm: p.realm || '', nonce: p.nonce || '', qop: p.qop ? 'auth' : '', opaque: p.opaque || '' }; this.nc = 0;
        this.digestRetry = true;
        try { return await this.req(path, { method, body }); } finally { this.digestRetry = false; }
      }
    }
    if (r.status === 401 || r.status === 403) throw new Error(this.kind === 'prusalink' ? 'Usuario o contraseña de PrusaLink incorrectos' : 'Clave API incorrecta o que falta');
    if (r.status === 204) return {};
    if (r.status === 409 && method === 'GET') return { _conflict: true };
    if (!r.ok) throw new Error('La impresora ha respondido con un error (' + r.status + ')');
    const t = await r.text(); if (!t) return {};
    try { return JSON.parse(t); } catch { throw new Error('La impresora no ha respondido como ' + KINDS[this.kind].name); }
  }
  digestHeader(method, uri) {
    const d = this.digest, nc = (++this.nc).toString(16).padStart(8, '0'), cn = crypto.randomBytes(8).toString('hex');
    const ha1 = md5(`${this.user}:${d.realm}:${this.secret}`), ha2 = md5(`${method}:${uri}`);
    const resp = d.qop ? md5(`${ha1}:${d.nonce}:${nc}:${cn}:auth:${ha2}`) : md5(`${ha1}:${d.nonce}:${ha2}`);
    return `Digest username="${this.user}", realm="${d.realm}", nonce="${d.nonce}", uri="${uri}", response="${resp}"` + (d.qop ? `, qop=auth, nc=${nc}, cnonce="${cn}"` : '') + (d.opaque ? `, opaque="${d.opaque}"` : '');
  }
  /** Las que no dicen «terminado» (OctoPrint) vuelven a «libre» al acabar: aquí se deduce si terminó o se canceló. */
  ending(state, pct) {
    if (state === 'RUNNING' || state === 'PAUSE' || state === 'PREPARE') { this.wasRunning = true; this.lastPct = pct || 0; this.ended = ''; return state; }
    if (state === 'IDLE' && this.wasRunning) { this.wasRunning = false; this.ended = this.lastPct >= 99 ? 'FINISH' : 'FAILED'; }
    if (state === 'FINISH' || state === 'FAILED') { this.wasRunning = false; this.ended = state; }
    return state === 'IDLE' && this.ended ? this.ended : state;
  }
  async poll() { return this['poll_' + this.kind](); }

  async poll_moonraker() {
    const j = await this.req('/printer/objects/query?print_stats&display_status&virtual_sdcard&extruder&heater_bed&heater_generic%20chamber&temperature_sensor%20chamber');
    const s = (j.result || {}).status || {};
    const ps = s.print_stats || {}, info = ps.info || {};
    const st = { standby: 'IDLE', printing: 'RUNNING', paused: 'PAUSE', complete: 'FINISH', cancelled: 'FAILED', error: 'FAILED' }[ps.state] || 'IDLE';
    const prog = num((s.display_status || {}).progress) || num((s.virtual_sdcard || {}).progress) || 0;
    const pct = Math.round(prog * 100);
    const dur = num(ps.print_duration) || 0;
    const remaining = st === 'RUNNING' || st === 'PAUSE' ? (prog > 0.01 ? Math.max(0, Math.round((dur / prog - dur) / 60)) : null) : null;
    const ex = s.extruder || {}, bed = s.heater_bed || {}, ch = s['heater_generic chamber'] || s['temperature_sensor chamber'] || {};
    return {
      state: this.ending(st, pct), percent: st === 'IDLE' ? null : pct, remaining,
      layer: num(info.current_layer), layers: num(info.total_layer), file: ps.filename || '',
      nozzle: num(ex.temperature), nozzleT: num(ex.target), bed: num(bed.temperature), bedT: num(bed.target), chamber: num(ch.temperature),
      speed: null, light: null, trays: [], ams: [], wifi: '', errors: ps.state === 'error' ? 1 : 0, printError: 0, nozzleDia: null, nozzleType: '',
    };
  }

  async poll_octoprint() {
    const job = await this.req('/api/job');
    let pr = {};
    try { pr = await this.req('/api/printer?exclude=sd,state'); } catch { /* sin impresora conectada a OctoPrint */ }
    const t = String(job.state || '');
    if (/^Offline|^Closed|^Error: |Connecting/i.test(t) && !/Printing/i.test(t)) throw new Error('OctoPrint no está conectado a la impresora');
    const st = /Paus/i.test(t) ? 'PAUSE' : /Printing|Starting|Resuming|Finishing/i.test(t) ? 'RUNNING' : /Cancelling/i.test(t) ? 'FAILED' : /Error/i.test(t) ? 'FAILED' : 'IDLE';
    const p = job.progress || {}, pct = num(p.completion) == null ? null : Math.round(+p.completion);
    const left = num(p.printTimeLeft), tp = (pr.temperature || {});
    const f = (job.job || {}).file || {};
    return {
      state: this.ending(st, pct), percent: st === 'IDLE' ? null : pct, remaining: left == null ? null : Math.round(left / 60),
      layer: null, layers: null, file: f.display || f.name || '',
      nozzle: num((tp.tool0 || {}).actual), nozzleT: num((tp.tool0 || {}).target), bed: num((tp.bed || {}).actual), bedT: num((tp.bed || {}).target), chamber: num((tp.chamber || {}).actual),
      speed: null, light: null, trays: [], ams: [], wifi: '', errors: st === 'FAILED' && /Error/i.test(t) ? 1 : 0, printError: 0, nozzleDia: null, nozzleType: '',
    };
  }

  async poll_prusalink() {
    const j = await this.req('/api/v1/status');
    const pr = j.printer || {}, jb = j.job || {};
    const t = String(pr.state || '').toUpperCase();
    const st = { PRINTING: 'RUNNING', PAUSED: 'PAUSE', FINISHED: 'FINISH', STOPPED: 'FAILED', ERROR: 'FAILED', BUSY: 'PREPARE', ATTENTION: 'PAUSE' }[t] || 'IDLE';
    this.jobId = jb.id != null ? jb.id : this.jobId;
    let file = this.file || '';
    if (jb.id != null && jb.id !== this.fileFor) {
      try { const d = await this.req('/api/v1/job'); file = ((d.file || {}).display_name) || ((d.file || {}).name) || ''; this.file = file; this.fileFor = jb.id; } catch { }
    }
    if (jb.id == null && st === 'IDLE') { file = ''; }
    const pct = num(jb.progress) == null ? null : Math.round(+jb.progress);
    return {
      state: this.ending(st, pct), percent: st === 'IDLE' ? null : pct, remaining: num(jb.time_remaining) == null ? null : Math.round(jb.time_remaining / 60),
      layer: null, layers: null, file,
      nozzle: num(pr.temp_nozzle), nozzleT: num(pr.target_nozzle), bed: num(pr.temp_bed), bedT: num(pr.target_bed), chamber: null,
      speed: null, light: null, trays: [], ams: [], wifi: '', errors: t === 'ERROR' || t === 'ATTENTION' ? 1 : 0, printError: 0, nozzleDia: num(pr.nozzle_diameter), nozzleType: '',
    };
  }

  /** Pausar, seguir, parar y refrescar. La luz y la velocidad solo en las Bambu. */
  command(cmd) {
    const go = p => p.then(() => setTimeout(() => this.refresh(), 800)).catch(e => { this.error = e.message; this.emit('update'); });
    if (cmd === 'refresh') { this.refresh(); return true; }
    if (!['pause', 'resume', 'stop'].includes(cmd) || !this.online) return false;
    if (this.kind === 'moonraker') return go(this.req('/printer/print/' + (cmd === 'stop' ? 'cancel' : cmd), { method: 'POST' })), true;
    if (this.kind === 'octoprint') return go(this.req('/api/job', { method: 'POST', body: cmd === 'stop' ? { command: 'cancel' } : { command: 'pause', action: cmd } })), true;
    if (this.kind === 'prusalink') {
      if (this.jobId == null) return false;
      return go(cmd === 'stop' ? this.req('/api/v1/job/' + this.jobId, { method: 'DELETE' }) : this.req('/api/v1/job/' + this.jobId + '/' + cmd, { method: 'PUT' })), true;
    }
    return false;
  }
  refresh() { if (this.closed) return; clearTimeout(this.timer); this.loop(); }
  close() { this.closed = true; clearTimeout(this.timer); }
}

module.exports = { NetLink, KINDS, baseUrl };
