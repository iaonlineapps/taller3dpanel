// Worker de Taller3D Panel para leer STEP con occt-import-js (sin modificar la librería).
// Si algo falla (navegador antiguo, política de seguridad…) responde con el error en vez de quedarse colgado.
let occt = null;
onmessage = async function (ev) {
  try {
    if (!occt) { importScripts('occt-import-js.js'); occt = await occtimportjs({ locateFile: p => p }); }
    postMessage(occt.ReadFile(ev.data.format, ev.data.buffer, ev.data.params));
  } catch (e) { postMessage({ success: false, error: String((e && e.message) || e) }); }
};
