const path = require('path');
const express = require('express');
const multer = require('multer');
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

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'independent-verifier',
  });
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
      network: String(req.body?.network || 'sepolia').trim(),
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
      network: String(req.body?.network || 'sepolia').trim(),
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
      network: String(req.body?.network || 'sepolia').trim(),
      rpcUrl: String(req.body?.rpcUrl || '').trim(),
      contractAddress: String(req.body?.contractAddress || '').trim(),
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
