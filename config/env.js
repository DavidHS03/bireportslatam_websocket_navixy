const path = require('path');
const dotenv = require('dotenv');

console.log('ENV WA_ACCESS_TOKEN:', process.env.WA_ACCESS_TOKEN?.slice(0, 10));

dotenv.config({
  path: path.resolve(process.cwd(), '.env'),
});

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`❌ Variable de entorno requerida no encontrada: ${name}`);
  }
  return value;
}

module.exports = {
  NAVIXY_API_URL: requireEnv('NAVIXY_API_URL'),
  WA_PHONE_NUMBER_ID: requireEnv('WA_PHONE_NUMBER_ID'),
  WA_ACCESS_TOKEN: requireEnv('WA_ACCESS_TOKEN'),
};
