'use strict';
/*
 * Conexión LAN con impresoras Bambu Lab (P1P, P1S, P2S, X1C, X1E, A1, A1 mini, H2D, H2S...).
 * Requisitos en la impresora: modo "Solo LAN" (LAN Only) + "Modo desarrollador" (Developer Mode).
 * Protocolo: MQTT 3.1.1 sobre TLS, puerto 8883, usuario "bblp", contraseña = código de acceso,
 * temas device/<serie>/report (estado) y device/<serie>/request (órdenes).
 * Cliente MQTT mínimo hecho a mano: sin dependencias.
 */
const tls = require('node:tls');
const { EventEmitter } = require('node:events');

function varint(n) { const b = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; b.push(d); } while (n > 0); return Buffer.from(b); }
const str = s => { const b = Buffer.from(s, 'utf8'); const l = Buffer.alloc(2); l.writeUInt16BE(b.length); return Buffer.concat([l, b]); };
function packet(type, body) { return Buffer.concat([Buffer.from([type]), varint(body.length), body]); }

function deepMerge(a, b) {
  for (const k of Object.keys(b || {})) {
    const v = b[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) deepMerge(a[k], v);
    else a[k] = v;
  }
  return a;
}

function summarize(state, online, error) {
    const p = (state || {}).print || {};
    const amsUnits = (p.ams && Array.isArray(p.ams.ams)) ? p.ams.ams : [];
    const trays = [];
    for (const u of amsUnits) for (const t of (u.tray || [])) if (t && (t.tray_type || t.tray_color)) trays.push({ type: t.tray_type || '', color: t.tray_color ? '#' + String(t.tray_color).slice(0, 6) : '', remain: t.remain != null ? +t.remain : null });
    if (p.vt_tray && (p.vt_tray.tray_type || p.vt_tray.tray_color)) trays.push({ type: p.vt_tray.tray_type || '', color: p.vt_tray.tray_color ? '#' + String(p.vt_tray.tray_color).slice(0, 6) : '', remain: null, ext: true });
    const light = (p.lights_report || []).find(l => l.node === 'chamber_light');
    const num = v => v == null || v === '' ? null : +v;
    return {
      online, error,
      state: p.gcode_state || (online ? 'IDLE' : ''), percent: num(p.mc_percent), remaining: num(p.mc_remaining_time),
      layer: num(p.layer_num), layers: num(p.total_layer_num), file: p.subtask_name || p.gcode_file || '',
      nozzle: num(p.nozzle_temper), nozzleT: num(p.nozzle_target_temper), bed: num(p.bed_temper), bedT: num(p.bed_target_temper), chamber: num(p.chamber_temper),
      speed: num(p.spd_lvl), light: light ? light.mode === 'on' : null, trays, wifi: p.wifi_signal || '', errors: Array.isArray(p.hms) ? p.hms.length : 0,
      nozzleDia: num(p.nozzle_diameter), nozzleType: p.nozzle_type || '',
      printError: num(p.print_error) || 0, updated: Date.now(),
    };
  }

class BambuLink extends EventEmitter {
  constructor({ host, serial, code, port = 8883 }) {
    super();
    Object.assign(this, { host, serial: String(serial).trim(), code: String(code).trim(), port });
    this.state = {}; this.online = false; this.error = ''; this.buf = Buffer.alloc(0); this.seq = 1;
    this.closed = false; this.retry = 2000; this.sock = null; this.ping = null; this.connect();
  }
  connect() {
    if (this.closed) return;
    this.error = '';
    const s = tls.connect({ host: this.host, port: this.port, rejectUnauthorized: false, timeout: 10000 });
    this.sock = s;
    s.on('secureConnect', () => {
      const clientId = 'taller3d_' + Math.random().toString(36).slice(2, 10);
      const vh = Buffer.concat([str('MQTT'), Buffer.from([4, 0xC2, 0, 30])]);
      s.write(packet(0x10, Buffer.concat([vh, str(clientId), str('bblp'), str(this.code)])));
    });
    s.on('data', d => this.onData(d));
    s.on('timeout', () => { this.error = 'La impresora no responde'; s.destroy(); });
    s.on('error', e => { this.error = e.code === 'ECONNREFUSED' ? 'Conexión rechazada: ¿está en modo LAN + desarrollador?' : e.code === 'EHOSTUNREACH' || e.code === 'ETIMEDOUT' ? 'No se encuentra la impresora en la red' : (e.message || 'Error de conexión'); });
    s.on('close', () => {
      clearInterval(this.ping); this.ping = null;
      const was = this.online; this.online = false; if (was || this.error) this.emit('update');
      if (!this.closed) { setTimeout(() => this.connect(), this.retry); this.retry = Math.min(this.retry * 2, 60000); }
    });
  }
  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      if (this.buf.length < 2) return;
      let mult = 1, len = 0, i = 1, byte;
      do { if (i >= this.buf.length) return; byte = this.buf[i++]; len += (byte & 127) * mult; mult *= 128; } while (byte & 128);
      if (this.buf.length < i + len) return;
      const type = this.buf[0] >> 4, body = this.buf.subarray(i, i + len);
      this.buf = this.buf.subarray(i + len);
      if (type === 2) { // CONNACK
        if (body[1] !== 0) { this.error = body[1] === 4 || body[1] === 5 ? 'Código de acceso incorrecto' : 'La impresora rechazó la conexión (' + body[1] + ')'; this.sock.destroy(); return; }
        this.online = true; this.retry = 2000; this.error = '';
        const topic = `device/${this.serial}/report`;
        this.sock.write(packet(0x82, Buffer.concat([Buffer.from([0, 1]), str(topic), Buffer.from([0])])));
        this.send({ pushing: { command: 'pushall', version: 1, push_target: 1 } });
        this.ping = setInterval(() => { try { this.sock.write(Buffer.from([0xC0, 0])); } catch { } }, 20000);
        this.emit('update');
      } else if (type === 3) { // PUBLISH (QoS 0)
        const tl = body.readUInt16BE(0); const qos = (this.buf[0] >> 1) & 3;
        const payload = body.subarray(2 + tl + (qos ? 2 : 0)).toString('utf8');
        try { const j = JSON.parse(payload); deepMerge(this.state, j); this.emit('update'); } catch { }
      }
    }
  }
  send(obj) {
    if (!this.online || !this.sock) return false;
    const k = Object.keys(obj)[0]; obj[k].sequence_id = String(this.seq++);
    const topic = `device/${this.serial}/request`;
    this.sock.write(packet(0x30, Buffer.concat([str(topic), Buffer.from(JSON.stringify(obj))])));
    return true;
  }
  command(cmd, value) {
    switch (cmd) {
      case 'pause': case 'resume': case 'stop': return this.send({ print: { command: cmd, param: '' } });
      case 'light': return this.send({ system: { command: 'ledctrl', led_node: 'chamber_light', led_mode: value ? 'on' : 'off', led_on_time: 500, led_off_time: 500, loop_times: 0, interval_time: 0 } });
      case 'speed': { const v = Math.max(1, Math.min(4, +value || 2)); return this.send({ print: { command: 'print_speed', param: String(v) } }); }
      case 'refresh': return this.send({ pushing: { command: 'pushall', version: 1, push_target: 1 } });
      default: return false;
    }
  }
  /** Resumen del estado para la web (sin datos sensibles). */
  summary() { return summarize(this.state, this.online, this.error); }
  close() { this.closed = true; clearInterval(this.ping); try { this.sock && this.sock.destroy(); } catch { } }
}


/* ----------------------------------------------------------------------------------------------
 * Nube de Bambu Lab (SOLO VER). Para impresoras en modo nube (Wi-Fi normal, sin modo LAN).
 * Bambu permite a programas de terceros leer el estado (temperaturas, progreso…) con moderación;
 * las órdenes (empezar, pausar…) van por Bambu Connect, así que aquí no se manda ninguna.
 * Una sola conexión MQTT por cuenta, se escucha lo que mandan las impresoras y solo se pide el
 * estado completo (pushall) una vez al conectar. Si la sesión caduca, no se reintenta en bucle.
 * ---------------------------------------------------------------------------------------------- */
const REGIONS = {
  global: { api: 'https://api.bambulab.com', mqtt: 'us.mqtt.bambulab.com' },
  china: { api: 'https://api.bambulab.cn', mqtt: 'cn.mqtt.bambulab.com' },
};
function regionOf(r) { const o = REGIONS[r] || REGIONS.global; return { api: process.env.BAMBU_API || o.api, mqtt: process.env.BAMBU_MQTT || o.mqtt, port: +process.env.BAMBU_MQTT_PORT || 8883 }; }
async function cloudReq(region, path, { method = 'GET', body, token } = {}) {
  const r = await fetch(regionOf(region).api + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  let j = {}; try { j = await r.json(); } catch { }
  if (!r.ok) { const e = new Error(j.message || j.error || ('Bambu respondió ' + r.status)); e.status = r.status; throw e; }
  return j;
}
const BambuCloud = {
  /** Paso 1: email + contraseña. Devuelve {needCode:true} si Bambu pide el código del email. */
  async login(region, account, password) {
    const j = await cloudReq(region, '/v1/user-service/user/login', { method: 'POST', body: { account, password } });
    if (j.accessToken) return j;
    if (j.loginType === 'verifyCode') { await cloudReq(region, '/v1/user-service/user/sendemail/code', { method: 'POST', body: { email: account, type: 'codeLogin' } }).catch(() => { }); return { needCode: true }; }
    if (j.loginType === 'tfa') return { needTfa: true };
    throw new Error('Bambu no ha aceptado el inicio de sesión');
  },
  /** Paso 2: código que llega por email. */
  async loginCode(region, account, code) {
    const j = await cloudReq(region, '/v1/user-service/user/login', { method: 'POST', body: { account, code: String(code).trim() } });
    if (!j.accessToken) throw new Error('Código incorrecto o caducado');
    return j;
  },
  async refresh(region, refreshToken) { return cloudReq(region, '/v1/user-service/user/refreshtoken', { method: 'POST', body: { refreshToken } }); },
  async uid(region, token) { const j = await cloudReq(region, '/v1/design-user-service/my/preference', { token }); if (!j.uid) throw new Error('No se pudo leer tu cuenta de Bambu'); return String(j.uid); },
  /** Impresoras vinculadas a la cuenta (sin códigos de acceso). */
  async devices(region, token) {
    const j = await cloudReq(region, '/v1/iot-service/api/user/bind', { token });
    return (j.devices || []).map(d => ({ serial: d.dev_id, name: d.name || d.dev_id, model: d.dev_product_name || d.dev_model_name || '', online: !!d.online, status: d.print_status || '', nozzle: d.nozzle_diameter || null }));
  },
};

class BambuCloudLink extends EventEmitter {
  constructor({ region, uid, token }) {
    super(); const r = regionOf(region);
    Object.assign(this, { host: r.mqtt, port: r.port, user: 'u_' + uid, token });
    this.serials = new Set(); this.states = new Map(); this.online = false; this.error = ''; this.buf = Buffer.alloc(0);
    this.seq = 1; this.closed = false; this.retry = 5000; this.sock = null; this.ping = null; this.subscribed = new Set(); this.connect();
  }
  setSerials(list) {
    this.serials = new Set(list.map(s => String(s).trim()).filter(Boolean));
    if (this.online) for (const sn of this.serials) if (!this.subscribed.has(sn)) this.subscribe(sn);
  }
  connect() {
    if (this.closed) return;
    const s = tls.connect({ host: this.host, port: this.port, servername: this.host, timeout: 15000, rejectUnauthorized: !process.env.BAMBU_MQTT_INSECURE });
    this.sock = s; this.subscribed = new Set();
    s.on('secureConnect', () => {
      const vh = Buffer.concat([str('MQTT'), Buffer.from([4, 0xC2, 0, 60])]);
      s.write(packet(0x10, Buffer.concat([vh, str('taller3d_' + Math.random().toString(36).slice(2, 10)), str(this.user), str(this.token)])));
    });
    s.on('data', d => this.onData(d));
    s.on('timeout', () => { this.error = 'La nube de Bambu no responde'; s.destroy(); });
    s.on('error', e => { this.error = 'Sin conexión con la nube de Bambu (' + (e.code || e.message) + ')'; });
    s.on('close', () => {
      clearInterval(this.ping); this.ping = null; const was = this.online; this.online = false; if (was) this.emit('update', null);
      if (!this.closed) { setTimeout(() => this.connect(), this.retry); this.retry = Math.min(this.retry * 2, 300000); }
    });
  }
  subscribe(sn) {
    this.subscribed.add(sn);
    this.sock.write(packet(0x82, Buffer.concat([Buffer.from([0, this.seq++ & 255 || 1]), str(`device/${sn}/report`), Buffer.from([0])])));
    // estado completo una sola vez al conectar (las P1/A1 solo mandan cambios); escalonado para no saturar
    const i = this.subscribed.size; setTimeout(() => this.publish(sn, { pushing: { command: 'pushall', version: 1, push_target: 1 } }), 1500 * i);
  }
  publish(sn, obj) { if (!this.online) return; const k = Object.keys(obj)[0]; obj[k].sequence_id = String(this.seq++); this.sock.write(packet(0x30, Buffer.concat([str(`device/${sn}/request`), Buffer.from(JSON.stringify(obj))]))); }
  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      if (this.buf.length < 2) return;
      let mult = 1, len = 0, i = 1, byte;
      do { if (i >= this.buf.length) return; byte = this.buf[i++]; len += (byte & 127) * mult; mult *= 128; } while (byte & 128);
      if (this.buf.length < i + len) return;
      const head = this.buf[0], type = head >> 4, body = this.buf.subarray(i, i + len);
      this.buf = this.buf.subarray(i + len);
      if (type === 2) {
        if (body[1] !== 0) { this.error = body[1] === 4 || body[1] === 5 ? 'La sesión de Bambu ha caducado: vuelve a entrar con tu cuenta' : 'La nube de Bambu rechazó la conexión (' + body[1] + ')'; this.closed = true; this.sock.destroy(); this.emit('authfail'); this.emit('update', null); return; }
        this.online = true; this.retry = 5000; this.error = '';
        for (const sn of this.serials) this.subscribe(sn);
        this.ping = setInterval(() => { try { this.sock.write(Buffer.from([0xC0, 0])); } catch { } }, 45000);
        this.emit('update', null);
      } else if (type === 3) {
        const tl = body.readUInt16BE(0), qos = (head >> 1) & 3, topic = body.subarray(2, 2 + tl).toString();
        const sn = (topic.match(/^device\/([^/]+)\/report$/) || [])[1]; if (!sn) continue;
        try { const j = JSON.parse(body.subarray(2 + tl + (qos ? 2 : 0)).toString('utf8')); const st = this.states.get(sn) || {}; deepMerge(st, j); this.states.set(sn, st); this.emit('update', sn); } catch { }
      }
    }
  }
  close() { this.closed = true; clearInterval(this.ping); try { this.sock && this.sock.destroy(); } catch { } }
}
/** Vista de una impresora de la nube con la misma forma que BambuLink (solo lectura). */
class CloudView {
  constructor(conn, serial) { this.conn = conn; this.serial = serial; this.readOnly = true; }
  get state() { return this.conn.states.get(this.serial) || {}; }
  get online() { const p = this.state.print || {}; return this.conn.online && !!(p.gcode_state || Object.keys(p).length); }
  get error() { return this.conn.error || (this.conn.online && !this.online ? 'Esperando datos de la impresora (¿está encendida?)' : ''); }
  summary() { return summarize(this.state, this.online, this.error); }
  command() { return false; }
  close() { }
}

module.exports = { BambuLink, BambuCloud, BambuCloudLink, CloudView };
