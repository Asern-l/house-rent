const path = require('path');
const express = require('express');
const multer = require('multer');
const {
  listContractConfigs,
  upsertContractConfig,
  activateContractConfig,
  parseContractConfigText,
  getDefaultRpcUrl,
} = require('./lib/runtime');
const { fetchListingDetail, verifyListingLocally } = require('./scripts/verify-listing');
const { verifyContractPdfBuffer } = require('./scripts/verify-contract-pdf');

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'web')));

function toBooleanFlag(value) {
  return String(value || '').trim() === '1' || String(value || '').trim().toLowerCase() === 'true';
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'independent-verifier',
  });
});

app.get('/api/contract-configs', (_req, res) => {
  try {
    const result = listContractConfigs();
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || '读取合约配置失败' });
  }
});

app.post('/api/contract-configs/parse-text', (req, res) => {
  try {
    const parsed = parseContractConfigText(String(req.body?.text || ''));
    const result = {
      ...parsed,
      rpcUrl: parsed.rpcUrl || (parsed.chainId ? getDefaultRpcUrl(parsed.chainId) : ''),
    };
    res.json({ ok: true, result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || '解析合约配置文本失败' });
  }
});

app.post('/api/contract-configs', (req, res) => {
  try {
    const result = upsertContractConfig(req.body || {}, {
      replace: toBooleanFlag(req.body?.replace),
      activate: toBooleanFlag(req.body?.activate),
    });
    res.json({ ok: true, result });
  } catch (error) {
    const status = error.code === 'CONFIG_NAME_EXISTS' ? 409 : 400;
    res.status(status).json({ ok: false, error: error.message || '保存合约配置失败' });
  }
});

app.post('/api/contract-configs/activate', (req, res) => {
  try {
    const result = activateContractConfig(String(req.body?.name || ''));
    res.json({ ok: true, result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || '切换当前合约配置失败' });
  }
});

app.post('/api/verify/listing', async (req, res) => {
  try {
    const listingId = String(req.body?.listingId || '').trim();
    if (!listingId) {
      return res.status(400).json({ ok: false, error: '缺少房源 ID' });
    }
    const result = await verifyListingLocally({
      listingId,
      snapshotCid: String(req.body?.snapshotCid || '').trim(),
      expectedSnapshotHash: String(req.body?.snapshotHash || '').trim(),
      traceAtSec: Number(req.body?.atSec || 0),
      runtime: null,
      configName: String(req.body?.configName || '').trim(),
      rpcUrl: String(req.body?.rpcUrl || '').trim(),
      contractAddress: String(req.body?.contractAddress || '').trim(),
    });
    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || '房源独立验真失败',
    });
  }
});

app.post('/api/listing-detail', async (req, res) => {
  try {
    const listingId = String(req.body?.listingId || '').trim();
    if (!listingId) {
      return res.status(400).json({ ok: false, error: '缺少房源 ID' });
    }
    const result = await fetchListingDetail({
      listingId,
      includeHistory: Boolean(req.body?.includeHistory),
      runtime: null,
      configName: String(req.body?.configName || '').trim(),
      rpcUrl: String(req.body?.rpcUrl || '').trim(),
      contractAddress: String(req.body?.contractAddress || '').trim(),
    });
    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || '房源详情读取失败',
    });
  }
});

app.post('/api/verify/contract-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ ok: false, error: '缺少合同 PDF 文件' });
    }
    const result = await verifyContractPdfBuffer({
      pdfBuffer: req.file.buffer,
      pdfPath: req.file.originalname || '',
      network: String(req.body?.network || '').trim(),
      rpcUrl: String(req.body?.rpcUrl || '').trim(),
      contractAddress: String(req.body?.contractAddress || '').trim(),
      verifyListing: toBooleanFlag(req.body?.verifyListing),
    });
    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || '合同 PDF 独立验真失败',
    });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'web', 'index.html'));
});

const port = Number(process.env.VERIFIER_PORT || 3010);
app.listen(port, '127.0.0.1', () => {
  console.log(`[verifier] listening on http://127.0.0.1:${port}`);
});
