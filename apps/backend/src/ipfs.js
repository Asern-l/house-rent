const crypto = require('crypto');

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/g, '');
}

function getIpfsApiUrl() {
  return trimTrailingSlash(process.env.IPFS_API_URL || 'http://127.0.0.1:5001/api/v0');
}

function getIpfsGatewayUrl() {
  return trimTrailingSlash(process.env.IPFS_GATEWAY_URL || 'http://127.0.0.1:8080/ipfs');
}

function isIpfsEnabled() {
  return String(process.env.IPFS_ENABLED || '1').trim() !== '0';
}

function sha256Hex(value) {
  return `0x${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function buildGatewayUrl(cid) {
  const normalizedCid = String(cid || '').trim();
  if (!normalizedCid) return '';
  return `${getIpfsGatewayUrl()}/${normalizedCid}`;
}

async function addBufferToIpfs(buffer, { fileName = 'blob.bin', contentType = 'application/octet-stream', pin = true } = {}) {
  if (!isIpfsEnabled()) {
    throw new Error('IPFS disabled');
  }
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
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
  getIpfsApiUrl,
  getIpfsGatewayUrl,
  buildGatewayUrl,
  sha256Hex,
  addBufferToIpfs,
  addJsonToIpfs,
  readIpfsText,
};
