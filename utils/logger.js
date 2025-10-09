const winston = require('winston');
const path = require('path');
const fs = require('fs');

const logDir = path.join(__dirname, '../logs');

// Crear carpeta "logs" si no existe
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

const { combine, timestamp, printf, colorize } = winston.format;

// Formato personalizado de los mensajes
const customFormat = printf(({ level, message, timestamp }) => {
  return `[${timestamp}] ${level}: ${message}`;
});

// Configuración del logger principal
const logger = winston.createLogger({
  level: 'info', // niveles: error, warn, info, http, verbose, debug, silly
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    customFormat
  ),
  transports: [
    // Mostrar en consola con colores
    new winston.transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        customFormat
      )
    }),

    // Guardar en archivo persistente
    new winston.transports.File({
      filename: path.join(logDir, 'navixy.log'),
      level: 'info'
    }),

    // Guardar errores en un archivo separado
    new winston.transports.File({
      filename: path.join(logDir, 'errors.log'),
      level: 'error'
    })
  ],
});

module.exports = logger;