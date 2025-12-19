const buffers = new Map();
// trackerId -> { events: [], timer: Timeout|null, lastNotifiedAt:number|null }

let WINDOW_MS = 5 * 60 * 1000;
let GRACE_MS = 30 * 1000;
let REQUIRED_UNIQUE_EVENTS = 3;

const flushCallbacks = [];

function configure({ windowMs, graceMs, requiredUniqueEvents, minEvents } = {}) {
  if (typeof windowMs === 'number') WINDOW_MS = windowMs;
  if (typeof graceMs === 'number') GRACE_MS = graceMs;

  // compat: requiredUniqueEvents preferido, minEvents alias
  const unique = (typeof requiredUniqueEvents === 'number')
    ? requiredUniqueEvents
    : (typeof minEvents === 'number' ? minEvents : undefined);

  if (typeof unique === 'number') REQUIRED_UNIQUE_EVENTS = unique;
}

function onFlush(cb) {
  if (typeof cb === 'function') flushCallbacks.push(cb);
}

async function runFlush(trackerId, snapshot) {
  for (const cb of flushCallbacks) {
    try { await cb(trackerId, snapshot); } catch (_) {}
  }
}

function pushEvent(trackerId, event) {
  const now = Date.now();
  const bucket = buffers.get(trackerId) || { events: [], timer: null, lastNotifiedAt: null };

  bucket.events.push(event);

  // purge fuera de ventana
  bucket.events = bucket.events.filter(e => e.ts >= now - WINDOW_MS);

  const uniqueCodes = new Set(bucket.events.map(e => e.code));
  const uniqueCount = uniqueCodes.size;

  const insideSameWindow =
    bucket.lastNotifiedAt && (now - bucket.lastNotifiedAt) < WINDOW_MS;

  // Programar flush solo si cumple exactamente N únicos (o >=N si lo deseas)
  if (!bucket.timer && !insideSameWindow && uniqueCount >= REQUIRED_UNIQUE_EVENTS) {
    bucket.timer = setTimeout(async () => {
      try {
        const cutoff = Date.now() - WINDOW_MS;
        const valid = bucket.events.filter(e => e.ts >= cutoff);

        const uniqueByCode = new Map();
        for (const e of valid) {
          if (!uniqueByCode.has(e.code)) uniqueByCode.set(e.code, e);
        }

        if (uniqueByCode.size < REQUIRED_UNIQUE_EVENTS) {
          bucket.timer = null;
          return;
        }

        const snapshot = Array.from(uniqueByCode.values()).sort((a, b) => a.ts - b.ts);

        bucket.lastNotifiedAt = Date.now();
        bucket.timer = null;

        await runFlush(trackerId, snapshot);
      } finally {
        bucket.timer = null;
      }
    }, GRACE_MS);
  }

  buffers.set(trackerId, bucket);
}

function getSnapshot(trackerId) {
  const bucket = buffers.get(trackerId);
  return bucket ? [...bucket.events].sort((a, b) => a.ts - b.ts) : [];
}

module.exports = { configure, onFlush, pushEvent, getSnapshot };