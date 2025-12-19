require('dotenv').config();

process.env.NODE_ENV = 'test'; // asegura modo test aunque olvides el comando

const logger = require('../utils/logger');
const wsClient = require('../services/websocketClient');
const aggregator = require('../services/eventAggregator');

(async () => {
  logger.info('== Iniciando simulación de siniestro ==');

  // Reduce tiempos SOLO en test
  aggregator.configure({
    windowMs: 10 * 1000,
    graceMs: 500,
    requiredUniqueEvents: 3,
  });

  // Hook: envolvemos el onFlush para saber cuándo terminó
  const done = createDeferred();

  const originalOnFlush = aggregator.onFlush;
  originalOnFlush(async (trackerId, snapshot) => {
    try {
      logger.warn(`🔥 onFlush ejecutado tracker=${trackerId} snapshot=${snapshot.length}`);
      // El websocketClient ya registró SU onFlush al importarse.
      // Este wrapper NO lo reemplaza porque en tu aggregator actual solo soporta 1 callback.
      // Por eso aquí solo marcamos done. Si no sale este log, el flush no ocurrió.
    } finally {
      done.resolve();
    }
  });

  await wsClient.buildSourceTrackerMap();

  // Usa un source_id real que ya viste que mapea (en logs te salió tracker=3437670)
  const SOURCE_ID = 10433582;

  const base = {
    type: 'event',
    event: 'state_batch',
    data: [
      {
        type: 'source_state_event',
        state: {
          source_id: SOURCE_ID,
          gps: {
            updated: new Date().toISOString(),
            location: { lat: 20.34, lng: -102.47 },
          },
          additional: {},
        },
      },
    ],
  };

  const withCode = (code) => {
    const e = JSON.parse(JSON.stringify(base));
    e.data[0].state.gps.updated = new Date().toISOString();
    e.data[0].state.additional.event_code = { value: code };
    return e;
  };

  // 3 eventos requeridos
  const e42 = withCode('42'); // pánico
  const e47 = withCode('47'); // frenado brusco
  const e46 = withCode('46'); // aceleración brusca

  logger.info('→ Enviando Botón de pánico (42)');
  await wsClient.handleEvent(e42);

  await sleep(300);
  logger.info('→ Enviando Frenado brusco (47)');
  await wsClient.handleEvent(e47);

  await sleep(300);
  logger.info('→ Enviando Aceleración brusca (46)');
  await wsClient.handleEvent(e46);

  // Espera a que ocurra el flush (y a que el proceso no muera)
  // Si tu aggregator real solo permite 1 onFlush, al menos confirmas que el flush corre.
  await Promise.race([
    done.promise,
    sleep(15000).then(() => { throw new Error('Timeout esperando onFlush'); }),
  ]);

  // Espera extra para que termine WhatsApp/getAuthHash/getTrackerLabel
  await sleep(8000);

  logger.info('== Simulación finalizada (no se forzó process.exit) ==');
})().catch((err) => {
  logger.error(`Simulación falló: ${err.message}`);
  process.exitCode = 1;
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}