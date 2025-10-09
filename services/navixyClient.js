const axios = require('axios');
require('dotenv').config();

const API = process.env.NAVIXY_API_URL;

async function getAuthHash() {
  const res = await axios.post(`${API}/v2/user/auth`, {
    login: process.env.NAVIXY_EMAIL,
    password: process.env.NAVIXY_PASSWORD
  });

  if (res.data.success) {
    return res.data.hash;
  }

  throw new Error("Autenticación fallida");
}

async function getTrackerIds(hash) {
  const res = await axios.post(`${API}/v2/tracker/list`, {
    hash
  });

  if (res.data.success && Array.isArray(res.data.list)) {
    return res.data.list.map(t => t.id);
  }

  throw new Error("Error obteniendo trackers");
}

async function getTrackerLabel(hash, trackerId) {
  const res = await axios.post(`${API}/v2/tracker/read`, {
    hash,
    tracker_id: trackerId
  });

  if (res.data.success && res.data.value && res.data.value.label) {
    return res.data.value.label;
  }

  throw new Error('No se pudo obtener el label del tracker');
}

module.exports = {
  getAuthHash,
  getTrackerIds,
  getTrackerLabel
};
