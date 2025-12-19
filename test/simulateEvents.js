require('dotenv').config();

const { handleEvent, buildSourceTrackerMap } = require('../services/websocketClient');
const logger = require('../utils/logger');

(async () => {
  logger.info('== Iniciando simulación de siniestro ==');

  await buildSourceTrackerMap();

  const SOURCE_ID = 10433582;

  const baseEvent = {
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

  const cloneWithCode = (code) => {
    const e = JSON.parse(JSON.stringify(baseEvent));
    e.data[0].state.gps.updated = new Date().toISOString();
    e.data[0].state.additional.event_code = { value: code };
    return e;
  };

  const panicEvent = cloneWithCode('42');
  const brakeEvent = cloneWithCode('47');
  const accelEvent = cloneWithCode('46');

  logger.info('→ Enviando Botón de pánico (42)');
  await handleEvent(panicEvent);

  setTimeout(async () => {
    logger.info('→ Enviando Frenado brusco (47)');
    await handleEvent(brakeEvent);
  }, 300);

  setTimeout(async () => {
    logger.info('→ Enviando Aceleración brusca (46)');
    await handleEvent(accelEvent);
  }, 600);

  setTimeout(() => {
    logger.info('== Simulación completada (WhatsApp debió enviarse) ==');
  }, 4000);
})();