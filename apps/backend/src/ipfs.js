const crypto = require('crypto');
const { getConfigValue, readConfig } = require('./runtime-config');

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/g, '');
}

function getIpfsApiUrl() {
  return trimTrailingSlash(process.env.IPFS_API_URL || 'http://127.0.0.1:5001/api/v0');
}

function getIpfsGatewayUrl() {
  return trimTrailingSlash(process.env.IPFS_GATEWAY_URL || 'http://127.0.0.1:8080/ipfs');
}

function isPinataMode() {
  const cfg = readConfig();
  return !!(cfg.pinataJwt && String(cfg.pinataJwt).trim());
}

function getPinataJwt() {
  return String(readConfig().pinataJwt || '').trim();
}

function isIpfsEnabled() {
  // Enabled if Pinata is configured OR local IPFS is not explicitly disabled
  if (isPinataMode()) return true;
  return String(process.env.IPFS_ENABLED || '1').trim() !== '0';
}

function sha256Hex(value) {
  return `0x${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function buildGatewayUrl(cid) {
  const normalizedCid = String(cid || '').trim();
  if (!normalizedCid) return '';
  if (isPinataMode()) {
    return `https://gateway.pinata.cloud/ipfs/${normalizedCid}`;
  }
  return `${getIpfsGatewayUrl()}/${normalizedCid}`;
}

async function addBufferToIpfs(buffer, { fileName = 'blob.bin', contentType = 'application/octet-stream', pin = true } = {}) {
  if (!isIpfsEnabled()) {
    throw new Error('IPFS disabled');
  }
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');

  if (isPinataMode()) {
    const jwt = getPinataJwt();
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: contentType }), fileName);
    const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}` },
      body: form,
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Pinata pinFileToIPFS failed: ${response.status} ${response.statusText} ${errText}`);
    }
    const result = await response.json();
    const cid = String(result.IpfsHash || '').trim();
    if (!cid) throw new Error('Pinata returned no IpfsHash');
    const contentHash = sha256Hex(bytes);
    return {
      cid,
      size: Number(result.PinSize || bytes.length || 0),
      gatewayUrl: `https://gateway.pinata.cloud/ipfs/${cid}`,
      contentHash,
    };
  }

  // Local IPFS node
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: contentType }), fileName);
  const params = new URLSearchParams({
    pin: pin ? 'true' : 'false',
    cidVersion: '1',
  });
  const response = await fetch(`${getIpfsApiUrl()}/add?${params.toString()}`, {
    method: 'POST',
    body: form,
  });
  if (!response.ok) {
    throw new Error(`IPFS add failed: ${response.status} ${response.statusText}`);
  }
  const rawText = await response.text();
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1];
  let parsed = {};
  try {
    parsed = JSON.parse(last);
  } catch {
    throw new Error('IPFS add returned invalid JSON');
  }
  const cid = String(parsed.Hash || '').trim();
  if (!cid) {
    throw new Error('IPFS add missing CID');
  }
  return {
    cid,
    size: Number(parsed.Size || bytes.length || 0),
    gatewayUrl: buildGatewayUrl(cid),
  };
}

async function addJsonToIpfs(value, { fileName = 'data.json', pin = true } = {}) {
  if (!isIpfsEnabled()) {
    throw new Error('IPFS disabled');
  }

  if (isPinataMode()) {
    const jwt = getPinataJwt();
    const json = JSON.stringify(value);
    const response = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pinataContent: value,
        pinataMetadata: { name: fileName },
      }),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Pinata pinJSONToIPFS failed: ${response.status} ${response.statusText} ${errText}`);
    }
    const result = await response.json();
    const cid = String(result.IpfsHash || '').trim();
    if (!cid) throw new Error('Pinata returned no IpfsHash');
    const contentHash = sha256Hex(json);
    return {
      cid,
      size: Number(result.PinSize || 0),
      gatewayUrl: `https://gateway.pinata.cloud/ipfs/${cid}`,
      contentHash,
      text: json,
    };
  }

  // Local IPFS node
  const json = JSON.stringify(value);
  const added = await addBufferToIpfs(Buffer.from(json, 'utf8'), {
    fileName,
    contentType: 'application/json',
    pin,
  });
  return {
    ...added,
    contentHash: sha256Hex(json),
    text: json,
  };
}

async function readIpfsText(cid) {
  const normalizedCid = String(cid || '').trim();
  if (!normalizedCid) {
    throw new Error('CID required');
  }
  const response = await fetch(buildGatewayUrl(normalizedCid), { method: 'GET' });
  if (!response.ok) {
    throw new Error(`IPFS read failed: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

module.exports = {
  isIpfsEnabled,
  isPinataMode,
  getIpfsApiUrl,
  getIpfsGatewayUrl,
  buildGatewayUrl,
  sha256Hex,
  addBufferToIpfs,
  addJsonToIpfs,
  readIpfsText,
};
