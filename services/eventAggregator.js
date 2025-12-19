/**
 * Ventana deslizante con grace time y soporte para múltiples listeners.
 * Reglas:
 * - Ventana configurable (windowMs)
 * - Grace time configurable (graceMs)
 * - Notifica SOLO cuando hay EXACTAMENTE N tipos únicos
 */

const buffers = new Map();
// trackerId => {
//   events: Array<{ code, name, ts, lat, lng, eventDate }>,
//   lastNotifiedAt: number | null,
//   timer: NodeJS.Timeout | null
// }

let WINDOW_MS = 5 * 60 * 1000;
let GRACE_MS = 30 * 1000;
let REQUIRED_UNIQUE_EVENTS = 3;

// ✅ ahora soporta múltiples callbacks
const flushCallbacks = [];

/**
 * Configura el agregador
 */
function configure({ windowMs, graceMs, requiredUniqueEvents } = {}) {
  if (typeof windowMs === 'number') WINDOW_MS = windowMs;
  if (typeof graceMs === 'number') GRACE_MS = graceMs;
  if (typeof requiredUniqueEvents === 'number') {
    REQUIRED_UNIQUE_EVENTS = requiredUniqueEvents;
  }
}

/**
 * Registra un listener de flush (NO reemplaza a otros)
 */
function onFlush(cb) {
  if (typeof cb === 'function') {
    flushCallbacks.push(cb);
  }
}

/**
 * Ejecuta todos los listeners registrados
 */
async function runFlush(trackerId, snapshot) {
  for (const cb of flushCallbacks) {
    try {
      await cb(trackerId, snapshot);
    } catch (err) {
      // Nunca romper el flujo por un listener
    }
  }
}

/**
 * Agrega un evento al buffer del tracker
 */
function pushEvent(trackerId, event) {
  const now = Date.now();

  const bucket = buffers.get(trackerId) || {
    events: [],
    lastNotifiedAt: null,
    timer: null,
  };

  bucket.events.push(event);

  // 1️⃣ Limpiar eventos fuera de la ventana
  bucket.events = bucket.events.filter(e => e.ts >= now - WINDOW_MS);

  // 2️⃣ Contar tipos únicos
  const uniqueCodes = new Set(bucket.events.map(e => e.code));
  const uniqueCount = uniqueCodes.size;

  // 3️⃣ Evitar múltiples notificaciones dentro de la misma ventana
  const insideSameWindow =
    bucket.lastNotifiedAt && now - bucket.lastNotifiedAt < WINDOW_MS;

  // 4️⃣ Programar flush SOLO cuando haya EXACTAMENTE N tipos únicos
  if (
    uniqueCount === REQUIRED_UNIQUE_EVENTS &&
    !bucket.timer &&
    !insideSameWindow
  ) {
    bucket.timer = setTimeout(async () => {
      try {
        const cutoff = Date.now() - WINDOW_MS;

        // Revalidar ventana
        const validEvents = bucket.events.filter(e => e.ts >= cutoff);

        // Recalcular tipos únicos
        const byCode = new Map();
        for (const e of validEvents) {
          if (!byCode.has(e.code)) byCode.set(e.code, e);
        }

        if (byCode.size !== REQUIRED_UNIQUE_EVENTS) {
          bucket.timer = null;
          return;
        }

        const snapshot = Array.from(byCode.values())
          .sort((a, b) => a.ts - b.ts);

        bucket.lastNotifiedAt = Date.now();
        bucket.timer = null;

        await runFlush(trackerId, snapshot);
      } catch (err) {
        bucket.timer = null;
      }
    }, GRACE_MS);
  }

  buffers.set(trackerId, bucket);
}

/**
 * Obtiene snapshot actual (solo debug)
 */
function getSnapshot(trackerId) {
  const bucket = buffers.get(trackerId);
  if (!bucket) return [];
  return [...bucket.events].sort((a, b) => a.ts - b.ts);
}

module.exports = {
  configure,
  onFlush,
  pushEvent,
  getSnapshot,
};