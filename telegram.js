'use strict';
/*
 * Bot de Telegram del taller (opcional).
 *
 * El administrador pega en Ajustes → Bot de Telegram el token que le da @BotFather y el número de
 * su chat. Desde ese momento el servidor:
 *   · AVISA solo: una impresora empieza, va por el 25/50/75 %, se pausa, termina, falla, tiene un
 *     aviso o se apaga; una pieza se queda sin stock; entra una venta nueva.
 *   · RESPONDE a lo que le preguntes: /estado, /stock, /ventas, /resumen, /ayuda.
 *
 * Solo contesta a TU chat (el que está guardado). Si le escribe otra persona, no le cuenta nada.
 * El token se guarda en la base de datos del servidor (tabla meta, clave «telegram») y NUNCA se
 * manda a la web ni entra en las copias de seguridad. Sin dependencias: fetch de Node 22.
 */

const TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/;
const CHAT_RE = /^(-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/;
const EVENTS = ['start', 'progress', 'pause', 'finish', 'fail', 'alert', 'offline', 'stock', 'sale'];
const DEFAULT_ON = { start: true, progress: true, pause: true, finish: true, fail: true, alert: true, offline: false, stock: true, sale: true };
const STEPS = [25, 50, 75];
const API = (process.env.TELEGRAM_API || 'https://api.telegram.org').replace(/\/+$/, ''); // para pruebas o un servidor propio de la Bot API

const TXT = {
  es: {
    start: '🖨️ <b>{name}</b> ha empezado a imprimir',
    running: '🖨️ <b>{name}</b> está imprimiendo ({pct} %)',
    progress: '⏳ <b>{name}</b> va por el <b>{pct} %</b>',
    pause: '⏸️ <b>{name}</b> está en pausa ({pct} %)',
    resume: '▶️ <b>{name}</b> sigue imprimiendo',
    finish: '✅ <b>{name}</b> ha terminado',
    fail: '❌ <b>{name}</b>: la impresión ha fallado o se ha cancelado',
    alert: '⚠️ <b>{name}</b> tiene un aviso. Míralo en su pantalla.',
    offline: '🔌 <b>{name}</b> se ha apagado o no responde',
    online: '🟢 <b>{name}</b> vuelve a estar conectada',
    file: '📄 {file}', left: '⏱️ Quedan {t}', took: '⏱️ Ha tardado {t}', layer: 'capa {a} de {b}', at: 'al {pct} %',
    stockOut: '📦 <b>{name}</b> se ha agotado', stockLow: '📦 Queda poco de <b>{name}</b>: {n} (aviso en {min})',
    sale: '🛒 Venta nueva <b>{num}</b>: <b>{total}</b>', saleBy: 'vendida por {who}', salePend: 'a deber',
    help: '👋 Soy el bot de <b>{app}</b>. Te aviso cuando una impresora empieza, va por la mitad, termina o falla, cuando se acaba el stock de una pieza y cuando entra una venta.\n\nPuedes preguntarme:\n/estado · cómo están las impresoras\n/stock · piezas con poco stock\n/ventas · ventas de hoy y del mes\n/resumen · todo junto\n/ayuda · este mensaje',
    who: 'Hola. Tu número de chat es <code>{id}</code>.\nPara que te avise, pon este número en Taller3D Panel → Ajustes → Bot de Telegram (o pulsa «Buscar mi chat» allí).',
    noPrinters: 'No hay impresoras en la granja todavía.', printers: '🖨️ <b>Impresoras</b>',
    idle: 'libre', printing: 'imprimiendo', paused: 'en pausa', done: 'terminada', failed: 'fallida', prep: 'preparando', off: 'sin conexión',
    manual: { libre: 'libre', imprimiendo: 'imprimiendo', mantenimiento: 'en mantenimiento', averiada: 'averiada' },
    noLow: '📦 Todas las piezas tienen stock de sobra.', low: '📦 <b>Poco stock</b>', out: 'agotada',
    salesToday: '🛒 <b>Hoy</b>: {n} · {total}', salesMonth: '📅 <b>Este mes</b>: {n} · {total}', one: 'venta', many: 'ventas', salesPend: '💶 A deber: {total}', last: 'Última: {num} · {total} · {when}',
    test: '✅ ¡Funciona! A partir de ahora {app} te avisará aquí.', unknown: 'No entiendo esa orden. Escribe /ayuda.',
    cmds: [['estado', 'Cómo están las impresoras'], ['stock', 'Piezas con poco stock'], ['ventas', 'Ventas de hoy y del mes'], ['resumen', 'Todo junto'], ['ayuda', 'Qué sé hacer']],
  },
  en: {
    start: '🖨️ <b>{name}</b> has started printing',
    running: '🖨️ <b>{name}</b> is printing ({pct} %)',
    progress: '⏳ <b>{name}</b> is at <b>{pct} %</b>',
    pause: '⏸️ <b>{name}</b> is paused ({pct} %)',
    resume: '▶️ <b>{name}</b> is printing again',
    finish: '✅ <b>{name}</b> has finished',
    fail: '❌ <b>{name}</b>: the print failed or was cancelled',
    alert: '⚠️ <b>{name}</b> has a warning. Check its screen.',
    offline: '🔌 <b>{name}</b> is off or not responding',
    online: '🟢 <b>{name}</b> is connected again',
    file: '📄 {file}', left: '⏱️ {t} left', took: '⏱️ It took {t}', layer: 'layer {a} of {b}', at: 'at {pct} %',
    stockOut: '📦 <b>{name}</b> is out of stock', stockLow: '📦 <b>{name}</b> is running low: {n} (warning at {min})',
    sale: '🛒 New sale <b>{num}</b>: <b>{total}</b>', saleBy: 'sold by {who}', salePend: 'unpaid',
    help: '👋 I am the <b>{app}</b> bot. I let you know when a printer starts, reaches the halfway mark, finishes or fails, when a part runs out of stock and when a sale comes in.\n\nYou can ask me:\n/status · how the printers are doing\n/stock · parts running low\n/sales · sales today and this month\n/summary · everything at once\n/help · this message',
    who: 'Hi. Your chat number is <code>{id}</code>.\nTo get alerts, put this number in Taller3D Panel → Settings → Telegram bot (or press «Find my chat» there).',
    noPrinters: 'There are no printers in the farm yet.', printers: '🖨️ <b>Printers</b>',
    idle: 'idle', printing: 'printing', paused: 'paused', done: 'finished', failed: 'failed', prep: 'preparing', off: 'offline',
    manual: { libre: 'idle', imprimiendo: 'printing', mantenimiento: 'under maintenance', averiada: 'broken' },
    noLow: '📦 Every part has plenty of stock.', low: '📦 <b>Low stock</b>', out: 'out of stock',
    salesToday: '🛒 <b>Today</b>: {n} · {total}', salesMonth: '📅 <b>This month</b>: {n} · {total}', one: 'sale', many: 'sales', salesPend: '💶 Unpaid: {total}', last: 'Last one: {num} · {total} · {when}',
    test: '✅ It works! From now on {app} will send its alerts here.', unknown: "I don't understand that command. Type /help.",
    cmds: [['status', 'How the printers are doing'], ['stock', 'Parts running low'], ['sales', 'Sales today and this month'], ['summary', 'Everything at once'], ['help', 'What I can do']],
  },
};
const ALIAS = { estado: 'status', impresoras: 'status', granja: 'status', status: 'status', printers: 'status', stock: 'stock', ventas: 'sales', sales: 'sales', resumen: 'summary', summary: 'summary', ayuda: 'help', help: 'help', start: 'help', id: 'id', chat: 'id' };

const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const fill = (t, o) => t.replace(/\{(\w+)\}/g, (_, k) => o[k] == null ? '' : o[k]);
const fmtMin = (m, lang) => { if (m == null || isNaN(m)) return ''; m = Math.round(m); return m >= 60 ? Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min' : m + ' min'; };

function createTelegram({ getMeta, setMeta, allData, livePrinters, appName: appNameFn = () => 'Taller3D Panel', version = '' }) {
  const N = () => { try { return appNameFn() || 'Taller3D Panel'; } catch { return 'Taller3D Panel'; } };
  let cfg = load();
  let pollGen = 0, offset = 0, polling = false;
  const seen = new Map(); // chats que han escrito al bot (para «Buscar mi chat»)
  const prog = new Map(); // id impresora -> último tramo de % avisado
  const alerts = new Map(); // id impresora -> nº de avisos (HMS) la última vez

  function load() {
    let c = {}; try { c = JSON.parse(getMeta('telegram') || '{}') || {}; } catch { }
    return { token: c.token || '', bot: c.bot || '', chat: c.chat || '', lang: c.lang === 'en' ? 'en' : 'es', on: { ...DEFAULT_ON, ...(c.on || {}) }, steps: Array.isArray(c.steps) && c.steps.length ? c.steps.filter(n => n > 0 && n < 100) : STEPS };
  }
  const save = () => setMeta('telegram', JSON.stringify(cfg));
  const L = () => TXT[cfg.lang] || TXT.es;
  const ready = () => !!(cfg.token && cfg.chat);

  async function call(token, method, params = {}, timeoutMs = 15000) {
    if (!TOKEN_RE.test(token || '')) throw new Error('El token del bot no es válido. Cópialo entero de @BotFather');
    let r, j = {};
    try {
      r = await fetch(`${API}/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': `Taller3DPanel/${version}` }, body: JSON.stringify(params), signal: AbortSignal.timeout(timeoutMs) });
      j = await r.json().catch(() => ({}));
    } catch (e) {
      if (e.name === 'TimeoutError' && method === 'getUpdates') return { ok: true, result: [] };
      throw new Error('No se ha podido conectar con Telegram. ¿Tiene Internet el servidor?');
    }
    if (!r.ok || !j.ok) {
      const d = String(j.description || '').toLowerCase();
      if (r.status === 401 || r.status === 404) throw new Error('Telegram no reconoce ese token. Cópialo otra vez de @BotFather');
      if (r.status === 409) throw new Error('Este bot ya lo está usando otro programa. Usa un bot solo para el taller');
      if ((r.status === 400 || r.status === 403) && d.includes('chat')) throw new Error('Telegram no encuentra ese chat. Escribe algo a tu bot y pulsa «Buscar mi chat»');
      if (r.status === 403) throw new Error('El bot no puede escribirte. Abre tu bot en Telegram y pulsa «Iniciar»');
      throw new Error('Telegram ha respondido con un error (' + r.status + ')');
    }
    return j;
  }
  const sendTo = (token, chat, text) => call(token, 'sendMessage', { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true });
  /** Manda un aviso a tu chat. Si Telegram falla, no pasa nada: el aviso sigue en la web. */
  function notify(text) { if (!ready()) return; sendTo(cfg.token, cfg.chat, text).catch(e => console.error('Telegram:', e.message)); }

  // ---------- datos para las respuestas ----------
  const money = n => { try { const cur = (((allData().config || {}).main || {}).currency) || 'EUR'; return new Intl.NumberFormat(cfg.lang === 'en' ? 'en-GB' : 'es-ES', { style: 'currency', currency: cur }).format(+n || 0); } catch { return (+n || 0).toFixed(2) + ' €'; } };
  const tnum = n => '#' + String(n || 0).padStart(4, '0');
  const stateWord = sm => {
    const t = L();
    if (!sm || !sm.online) return t.off;
    return { RUNNING: t.printing, PREPARE: t.prep, SLICING: t.prep, PAUSE: t.paused, FINISH: t.done, FAILED: t.failed, IDLE: t.idle }[sm.state] || t.idle;
  };
  function statusText() {
    const t = L(), list = livePrinters();
    if (!list.length) return t.noPrinters;
    const icon = s => !s || !s.online ? '⚫' : s.state === 'RUNNING' || s.state === 'PREPARE' ? '🟣' : s.state === 'PAUSE' ? '🟡' : s.state === 'FAILED' ? '🔴' : s.state === 'FINISH' ? '🔵' : '🟢';
    const rows = list.map(({ doc, live }) => {
      if (!live) { const m = doc.status || 'libre'; const ic = m === 'imprimiendo' ? '🟣' : m === 'averiada' ? '🔴' : m === 'mantenimiento' ? '🟡' : '🟢'; return `${ic} <b>${esc(doc.name)}</b> · ${t.manual[m] || m}${doc.job ? '\n    📄 ' + esc(doc.job) : ''}`; }
      let r = `${icon(live)} <b>${esc(doc.name)}</b> · ${stateWord(live)}`;
      if (live.online && (live.state === 'RUNNING' || live.state === 'PAUSE')) {
        r += ` · <b>${live.percent ?? 0} %</b>`;
        const extra = [live.file ? '📄 ' + esc(live.file) : '', live.remaining != null ? fill(t.left, { t: fmtMin(live.remaining) }) : '', live.layers ? fill(t.layer, { a: live.layer, b: live.layers }) : ''].filter(Boolean);
        if (extra.length) r += '\n    ' + extra.join(' · ');
      }
      return r;
    });
    return t.printers + '\n' + rows.join('\n');
  }
  function stockText() {
    const t = L(), p = Object.values(allData().products || {}).filter(x => (x.estado || 'listo') === 'listo' && !x.archived);
    const low = p.filter(x => (+x.stock || 0) <= (+x.min || 0) && (+x.min > 0 || (+x.stock || 0) <= 0)).sort((a, b) => (+a.stock || 0) - (+b.stock || 0));
    if (!low.length) return t.noLow;
    return t.low + '\n' + low.slice(0, 30).map(x => `• ${esc(x.name)}: ${(+x.stock || 0) <= 0 ? '<b>' + t.out + '</b>' : '<b>' + (+x.stock) + '</b> / ' + (+x.min)}`).join('\n') + (low.length > 30 ? '\n…' : '');
  }
  function salesText() {
    const t = L(), s = Object.values(allData().sales || {}).filter(x => x.status !== 'anulado');
    const d0 = new Date(); d0.setHours(0, 0, 0, 0); const m0 = new Date(d0); m0.setDate(1);
    const sum = l => l.reduce((a, x) => a + (+x.total || 0), 0);
    const today = s.filter(x => x.date >= +d0), month = s.filter(x => x.date >= +m0), pend = s.filter(x => x.status === 'pendiente');
    const nn = n => n + ' ' + (n === 1 ? t.one : t.many);
    const out = [fill(t.salesToday, { n: nn(today.length), total: money(sum(today)) }), fill(t.salesMonth, { n: nn(month.length), total: money(sum(month)) })];
    if (pend.length) out.push(fill(t.salesPend, { total: money(sum(pend)) }));
    const last = s.sort((a, b) => b.date - a.date)[0];
    if (last) out.push(fill(t.last, { num: tnum(last.num), total: money(last.total), when: new Date(last.date).toLocaleString(cfg.lang === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }));
    return out.join('\n');
  }
  function answer(cmd) {
    const t = L();
    switch (cmd) {
      case 'status': return statusText();
      case 'stock': return stockText();
      case 'sales': return salesText();
      case 'summary': return [statusText(), salesText(), stockText()].join('\n\n');
      case 'help': return fill(t.help, { app: N() });
      default: return t.unknown;
    }
  }

  // ---------- escuchar lo que te escriben (long polling) ----------
  async function pollLoop(gen) {
    polling = true;
    try { await call(cfg.token, 'deleteWebhook', {}); } catch { }
    let wait = 0;
    while (gen === pollGen && cfg.token) {
      if (wait) await new Promise(r => setTimeout(r, wait));
      if (gen !== pollGen) break;
      try {
        const j = await call(cfg.token, 'getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'channel_post'] }, 60000);
        wait = 0;
        for (const u of j.result || []) {
          offset = u.update_id + 1;
          const m = u.message || u.channel_post; if (!m || !m.chat) continue;
          const ch = m.chat, id = String(ch.id);
          seen.set(id, { id, name: ch.title || [ch.first_name, ch.last_name].filter(Boolean).join(' ') || ch.username || id, type: ch.type || '', at: Date.now() });
          if (gen !== pollGen) break;
          const text = String(m.text || '').trim();
          const isMine = cfg.chat && (id === String(cfg.chat) || (ch.username && '@' + ch.username === cfg.chat));
          if (!isMine) {
            // a quien no es tu chat solo se le dice su número (y solo mientras no hay chat guardado)
            if (!cfg.chat && ch.type === 'private') sendTo(cfg.token, id, fill(L().who, { id })).catch(() => { });
            continue;
          }
          if (!text.startsWith('/')) { if (text) sendTo(cfg.token, id, answer('help')).catch(() => { }); continue; }
          const cmd = ALIAS[text.slice(1).split(/[\s@]/)[0].toLowerCase()] || '';
          const out = cmd === 'id' ? fill(L().who, { id }) : answer(cmd);
          sendTo(cfg.token, id, out).catch(e => console.error('Telegram:', e.message));
        }
      } catch (e) {
        console.error('Telegram:', e.message);
        wait = /token/.test(e.message) ? 300000 : /otro programa/.test(e.message) ? 60000 : 15000;
      }
    }
    polling = false;
  }
  function restart() {
    pollGen++; offset = 0;
    if (cfg.token) setTimeout(() => pollLoop(pollGen), polling ? 1500 : 0);
  }
  async function setCommands() {
    for (const lang of ['es', 'en']) {
      try { await call(cfg.token, 'setMyCommands', { commands: TXT[lang].cmds.map(([command, description]) => ({ command, description })), ...(lang === 'en' ? { language_code: 'en' } : {}) }); } catch { }
    }
    try { await call(cfg.token, 'setMyCommands', { commands: TXT[cfg.lang].cmds.map(([command, description]) => ({ command, description })) }); } catch { }
  }

  // ---------- avisos de la granja (los llama server.js) ----------
  function printerEvent(ev, d, sm) {
    if (!ready()) return;
    const t = L(), name = esc(d.name || 'Impresora'), lines = [];
    const fileL = f => f ? fill(t.file, { file: esc(f) }) : '';
    const key = { start: 'start', running: 'start', resume: 'pause', pause: 'pause', finish: 'finish', fail: 'fail', offline: 'offline', online: 'offline' }[ev];
    if (!key || !cfg.on[key]) return;
    if (ev === 'start' || ev === 'running') { prog.set(d.pid, ev === 'running' ? Math.max(0, ...cfg.steps.filter(s => s <= (d.percent || 0))) : 0); }
    if (ev === 'finish' || ev === 'fail') prog.delete(d.pid);
    if (ev === 'running') return; // al arrancar el servidor con una impresión a medias no se avisa, solo se sigue su %
    lines.push(fill(t[ev], { name, pct: d.percent ?? (sm && sm.percent) ?? 0 }));
    if (ev !== 'offline' && ev !== 'online') lines.push(fileL(d.file || (sm && sm.file)));
    if (ev === 'start' && (d.remaining != null || (sm && sm.remaining != null))) lines.push(fill(t.left, { t: fmtMin(d.remaining ?? sm.remaining) }) + (d.layers ? ' · ' + d.layers + (cfg.lang === 'en' ? ' layers' : ' capas') : ''));
    if (ev === 'finish' && d.mins != null) lines.push(fill(t.took, { t: fmtMin(d.mins) }));
    if (ev === 'fail' && d.percent != null) lines.push(fill(t.at, { pct: d.percent }));
    if (ev === 'offline' && d.error) lines.push(esc(d.error));
    notify(lines.filter(Boolean).join('\n'));
  }
  /** Se llama con cada actualización en directo: avisa al pasar por 25/50/75 % y si sale un aviso nuevo. */
  function printerLive(id, doc, sm) {
    if (!ready() || !sm || !sm.online) return;
    const name = esc((doc && doc.name) || 'Impresora'), t = L();
    if (sm.state === 'RUNNING' && sm.percent != null && prog.has(id) && cfg.on.progress) {
      const last = prog.get(id), step = Math.max(0, ...cfg.steps.filter(s => s <= sm.percent));
      if (step > last) {
        prog.set(id, step);
        notify([fill(t.progress, { name, pct: sm.percent }), sm.file ? fill(t.file, { file: esc(sm.file) }) : '', [sm.remaining != null ? fill(t.left, { t: fmtMin(sm.remaining) }) : '', sm.layers ? fill(t.layer, { a: sm.layer, b: sm.layers }) : ''].filter(Boolean).join(' · ')].filter(Boolean).join('\n'));
      }
    }
    const n = (+sm.errors || 0) + (sm.printError ? 1 : 0), was = alerts.get(id) || 0;
    if (n > was && cfg.on.alert) notify(fill(t.alert, { name }) + (sm.file ? '\n' + fill(t.file, { file: esc(sm.file) }) : ''));
    alerts.set(id, n);
  }
  /** Cambios en piezas y ventas (los llama server.js al guardar). */
  function docChanged(col, prev, next) {
    if (!ready() || !next) return;
    const t = L();
    if (col === 'products' && cfg.on.stock && (next.estado || 'listo') === 'listo') {
      const a = prev ? +prev.stock || 0 : null, b = +next.stock || 0, min = +next.min || 0;
      if (a == null || b >= a) return;
      if (b <= 0 && a > 0) notify(fill(t.stockOut, { name: esc(next.name) }));
      else if (min > 0 && b <= min && a > min) notify(fill(t.stockLow, { name: esc(next.name), n: b, min }));
    }
    if (col === 'sales' && cfg.on.sale && !prev && next.status !== 'anulado') {
      const items = (next.items || []).slice(0, 8).map(i => `• ${i.qty}× ${esc(i.name)}`).join('\n');
      const extra = [next.customerName ? '👤 ' + esc(next.customerName) : '', next.sellerName && next.sellerId ? fill(t.saleBy, { who: esc(next.sellerName) }) : '', next.method ? esc(next.method) : '', next.status === 'pendiente' ? t.salePend : ''].filter(Boolean).join(' · ');
      notify([fill(t.sale, { num: tnum(next.num), total: money(next.total) }), extra, items].filter(Boolean).join('\n'));
    }
  }

  // ---------- Ajustes (solo administrador) ----------
  function view() {
    return { bot: cfg.bot || '', token_set: !!cfg.token, token_hint: cfg.token ? '…' + cfg.token.slice(-4) : '', chat: cfg.chat, lang: cfg.lang, on: cfg.on, steps: cfg.steps, listening: polling };
  }
  function checkIn(b) {
    const token = b.token != null ? String(b.token).trim() : '';
    const chat = b.chat != null ? String(b.chat).trim() : null;
    if (token && !TOKEN_RE.test(token)) throw new Error('El token del bot no es válido. Cópialo entero de @BotFather');
    if (chat && !CHAT_RE.test(chat)) throw new Error('El chat tiene que ser un número (por ejemplo 123456789)');
    return { token, chat };
  }
  async function update(b) {
    if (b.clear) { cfg = { ...load(), token: '', bot: '', chat: '' }; save(); restart(); return view(); }
    const { token, chat } = checkIn(b);
    const tokenChanged = token && token !== cfg.token;
    if (tokenChanged) { const me = await call(token, 'getMe'); cfg.token = token; cfg.bot = (me.result && me.result.username) || ''; }
    if (chat !== null) cfg.chat = chat;
    if (b.lang === 'es' || b.lang === 'en') cfg.lang = b.lang;
    if (b.on && typeof b.on === 'object') for (const k of EVENTS) if (k in b.on) cfg.on[k] = !!b.on[k];
    save();
    if (tokenChanged) restart();
    if (cfg.token && (tokenChanged || b.lang)) setCommands();
    return view();
  }
  async function test(b) {
    const { token, chat } = checkIn(b);
    const tk = token || cfg.token, ch = chat || cfg.chat;
    if (!tk) throw new Error('Pega primero el token de tu bot');
    if (!ch) throw new Error('Falta el chat. Escribe «hola» a tu bot y pulsa «Buscar mi chat»');
    const lang = b.lang === 'en' || b.lang === 'es' ? b.lang : cfg.lang;
    await sendTo(tk, ch, fill(TXT[lang].test, { app: N() }) + '\n\n' + fill(TXT[lang].help, { app: N() }));
    return { ok: true };
  }
  async function chats(b) {
    const { token } = checkIn(b);
    const tk = token || cfg.token;
    if (!tk) throw new Error('Pega primero el token de tu bot');
    const me = await call(tk, 'getMe');
    let list = [];
    if (tk === cfg.token && polling) list = [...seen.values()];
    else {
      const j = await call(tk, 'getUpdates', { limit: 50, timeout: 0 });
      for (const u of j.result || []) { const m = u.message || u.channel_post || u.my_chat_member || {}; const ch = m.chat; if (!ch) continue; seen.set(String(ch.id), { id: String(ch.id), name: ch.title || [ch.first_name, ch.last_name].filter(Boolean).join(' ') || ch.username || String(ch.id), type: ch.type || '', at: Date.now() }); }
      list = [...seen.values()];
    }
    list.sort((a, b) => b.at - a.at);
    return { bot: { username: me.result && me.result.username, name: me.result && me.result.first_name }, chats: list.map(({ id, name, type }) => ({ id, name, type })) };
  }

  restart();
  return { printerEvent, printerLive, docChanged, view, update, test, chats, ready };
}

module.exports = { createTelegram };
