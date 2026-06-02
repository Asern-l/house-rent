const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'data', 'runtime-config.json');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(updates) {
  const c = { ...readConfig(), ...updates };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2));
  return c;
}

function getConfigValue(key, envKey = '') {
  const c = readConfig();
  return c[key] || process.env[envKey || key] || '';
}

module.exports = { readConfig, writeConfig, getConfigValue };
