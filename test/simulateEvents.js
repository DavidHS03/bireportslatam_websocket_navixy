// test/simulateEvents.js
require('dotenv').config();
const { handleEvent, buildSourceTrackerMap } = require('../services/websocketClient');
const logger = require('../utils/logger');

(async () => {
  await buildSourceTrackerMap(); // simula cargar los trackers

  // genera un evento de botón de pánico
  const panicEvent = {
    type: 'event',
    event: 'state_batch',
    data: [
      {
        type: 'source_state_event',
        state: {
          source_id: 10433582,
          gps: {
            updated: new Date().toISOString(),
            location: { lat: 20.34, lng: -102.47 },
            speed: 0,
          },
          additional: { event_code: { value: '42' } }, // Botón de pánico
        },
      },
    ],
  };

  // evento de exceso de velocidad
  const overspeedEvent = {
    type: 'event',
    event: 'state_batch',
    data: [
      {
        type: 'source_state_event',
        state: {
          source_id: 10433582,
          gps: {
            updated: new Date().toISOString(),
            location: { lat: 20.34, lng: -102.47 },
            speed: 120,
          },
          additional: { event_code: { value: '33' } }, // Exceso de velocidad
        },
      },
    ],
  };

  // evento de corte de energía
  const powerCutEvent = {
    type: 'event',
    event: 'state_batch',
    data: [
      {
        type: 'source_state_event',
        state: {
          source_id: 10433582,
          gps: {
            updated: new Date().toISOString(),
            location: { lat: 20.34, lng: -102.47 },
            speed: 0,
          },
          additional: { event_code: { value: '12' } }, // Corte de energía
        },
      },
    ],
  };

  logger.info('== Simulando eventos ==');
  await handleEvent(panicEvent);
  await handleEvent(overspeedEvent);
  await handleEvent(powerCutEvent);

  logger.info('== Prueba completada ==');
})();