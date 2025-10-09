const axios = require('axios');
const logger = require('../utils/logger');

// ⚙️ Configuración — usa tus valores reales
const WHATSAPP_URL = 'https://graph.facebook.com/v22.0/123897187467489/messages'; // Reemplaza con tu ID de número real
const WHATSAPP_TOKEN = 'EAAR0i6DhhjIBO5ZCuHiH29grsbd4mYQ6ydZB1KLAWqZBBPKSh15fz2m37jnhUP1OnfyUniM5LVMBfxg1S6TTRR9AOSnbL2ZBKGEIZAkIJXbUO5rfGcFZCCilRLR0PsZAVR52ZAF4RNfGIGex7y7O1aZAX7F6GzW98CYDsRcF7K8rIT7R8ZCQFesbYPgVN4KZC2FdaEZCwwZDZD';

const headers = {
  Authorization: `Bearer ${WHATSAPP_TOKEN}`,
  'Content-Type': 'application/json',
};

/**
 * Envía un mensaje de plantilla de WhatsApp (alerta_siniestro)
 * @param {string} number Número en formato internacional (ej. 5212227086105)
 * @param {string} contactName Nombre del contacto
 * @param {string} vehicle_name Nombre del vehículo o label (ej. "FORD - E15BPT")
 * @param {string} event_date Fecha legible (ej. "10 de octubre de 2025, 13:27:14")
 * @param {string} coords Coordenadas "lat,lng" (ej. "24.626428,-107.463373")
 */
async function sendWhatsAppTemplate(number, contactName, vehicle_name, event_date, coords = '0,0') {
  try {
    const body = {
      messaging_product: 'whatsapp',
      to: String(number),
      type: 'template',
      template: {
        name: 'alerta_siniestro', // Reemplaza con el nombre exacto de tu plantilla
        language: { code: 'es_MX' },
        components: [
          {
            type: 'header',
            parameters: [
              {
                type: 'image',
                image: {
                  link: 'https://api.bireportslatam.com/images/dla-header-message-2.jpeg',
                },
              },
            ],
          },
          {
            type: 'body',
            parameters: [
              { type: 'text', text: vehicle_name, parameter_name: 'vehicle_name' },
              { type: 'text', text: event_date, parameter_name: 'event_date' },
            ],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [
              {
                type: 'text',
                text: coords,
              },
            ],
          },
        ],
      },
    };

    const response = await axios.post(WHATSAPP_URL, body, { headers });
    logger.info(`✅ WhatsApp enviado a ${number}: ${vehicle_name} (${event_date})`);
    return response.data;

  } catch (error) {
    logger.error(`❌ Error enviando WhatsApp a ${number}: ${error.response?.data?.error?.message || error.message}`);
    return null;
  }
}

/**
 * Enviar prueba masiva a contactos definidos
 */
async function sendTestAlerts() {
  const testContacts = [
    { number: '5212227086105', contactName: 'David Hernández', vehicle_name: 'FORD - E15BPT', event_date: '10 de octubre de 2025, 13:27:14', coords: '24.626428,-107.463373' },
  ];

  const responses = [];
  for (const c of testContacts) {
    const res = await sendWhatsAppTemplate(c.number, c.contactName, c.vehicle_name, c.event_date, c.coords);
    responses.push(res);
  }
  return responses;
}

module.exports = {
  sendWhatsAppTemplate,
  sendTestAlerts,
};
