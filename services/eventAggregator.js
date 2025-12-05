// Ventana deslizante con “grace time” antes de notificar.
const buffers = new Map(); // trackerId -> { events: [], lastNotifiedAt: number|null, timer: NodeJS.Timeout|null }

let WINDOW_MS = 5 * 60 * 1000;   // 5 min
let MIN_EVENTS = 2;
let GRACE_MS = 30 * 1000;        // 30 s
let flushCb = () => {};          // (trackerId, snapshot) => void

function configure({ windowMs, minEvents, graceMs } = {}) {
  if (windowMs) WINDOW_MS = windowMs;
  if (minEvents) MIN_EVENTS = minEvents;
  if (graceMs) GRACE_MS = graceMs;
}

/**
 * Registra callback que se ejecuta al finalizar el grace y enviar snapshot.
 * @param {(trackerId:string|number, snapshot:Array)=>void|Promise<void>} cb
 */
function onFlush(cb) {
  flushCb = cb || (() => {});
}

/**
 * Agrega un evento y arma notificación tras GRACE_MS si se supera el umbral.
 * @param {string|number} trackerId
 * @param {{code:string,name:string,ts:number,lat:number,lng:number,speed?:number|null,eventDate:string}} event
 */
function pushEvent(trackerId, event) {
  const now = Date.now();
  const bucket = buffers.get(trackerId) || { events: [], lastNotifiedAt: null, timer: null };
  bucket.events.push(event);

  // purgar fuera de ventana
  bucket.events = bucket.events.filter(e => e.ts >= now - WINDOW_MS);

  // si no hay timer activo y ya se alcanzó el mínimo, programa flush
  const insideSameWindow = bucket.lastNotifiedAt && (now - bucket.lastNotifiedAt) < WINDOW_MS;
  if (!bucket.timer && bucket.events.length >= MIN_EVENTS && !insideSameWindow) {
    bucket.timer = setTimeout(async () => {
      const snapshot = [...bucket.events].sort((a, b) => a.ts - b.ts);
      bucket.lastNotifiedAt = Date.now();
      bucket.timer = null;
      try { await flushCb(trackerId, snapshot); } catch (_) {}
    }, GRACE_MS);
  }

  buffers.set(trackerId, bucket);
  return { count: bucket.events.length };
}

/** Devuelve el snapshot actual sin disparar notificación. */
function getSnapshot(trackerId) {
  const bucket = buffers.get(trackerId);
  return bucket ? [...bucket.events].sort((a, b) => a.ts - b.ts) : [];
}

module.exports = { configure, onFlush, pushEvent, getSnapshot };