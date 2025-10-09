require('dotenv').config();

const { getAuthHash, getTrackerIds } = require('./services/navixyClient');
const { connectWebSocket } = require('./services/websocketClient');
const logger = require('./utils/logger');

(async () => {
  try {
    const hash = await getAuthHash();
    const trackerIds = await getTrackerIds(hash);

    if (!trackerIds.length) {
      throw new Error("No se encontraron trackers");
    }

    logger.info("🔌 Iniciando conexión WebSocket con Navixy...");
    connectWebSocket(hash, trackerIds);
  } catch (err) {
    logger.error(`❌ Error general: ${err.message}`);
  }
})();
