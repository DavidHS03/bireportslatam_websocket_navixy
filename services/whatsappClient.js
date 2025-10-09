const axios = require('axios');
require('dotenv').config();

const PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID;
const ACCESS_TOKEN = process.env.WA_ACCESS_TOKEN;

async function sendTextMessage(to, text) {
  const url = `https://graph.facebook.com/v${process.env.WA_API_VERSION ?? 'v21.0'}/${PHONE_NUMBER_ID}/messages`;
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to,
    type: "text",
    text: {
      body: text
    }
  };
  const headers = {
    'Authorization': `Bearer ${ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  };
  const resp = await axios.post(url, body, { headers });
  return resp.data;
}

module.exports = {
  sendTextMessage,
};
