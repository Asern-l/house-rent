const path = require('path');
const { createRequire } = require('module');

function loadEthers() {
  try {
    const req = createRequire(path.join(__dirname, '..', 'package.json'));
    return req('ethers');
  } catch {
    throw new Error('ethers dependency not found. Run npm install in verifier/.');
  }
}

module.exports = {
  ethers: loadEthers(),
};
