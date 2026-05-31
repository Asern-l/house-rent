const tabs = Array.from(document.querySelectorAll('.tab'));
const panels = Array.from(document.querySelectorAll('.panel'));
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = `status${kind ? ` is-${kind}` : ''}`;
}

function showResult(value, type = 'raw') {
  if (type === 'listing' && value && typeof value === 'object') {
    resultEl.innerHTML = renderListingResult(value);
    return;
  }
  if (type === 'contract' && value && typeof value === 'object') {
    resultEl.innerHTML = renderContractResult(value);
    return;
  }
  if (type === 'listing-detail' && value && typeof value === 'object') {
    resultEl.innerHTML = renderListingDetailResult(value);
    return;
  }
  resultEl.innerHTML = `<pre class="output">${escapeHtml(typeof value === 'string' ? value : JSON.stringify(value, null, 2))}</pre>`;
}

function renderKeyValueGrid(items) {
  return `<div class="kv-grid">${items.map(({ label, value }) => `
    <div class="kv-item">
      <div class="kv-label">${escapeHtml(label)}</div>
      <div class="kv-value">${escapeHtml(value)}</div>
    </div>
  `).join('')}</div>`;
}

function formatListingSource(source) {
  switch (source) {
    case 'local-listing-latest-anchor':
      return '链上当前房源 + 最新快照锚点';
    case 'local-listing-history':
      return '链上房源 + 历史快照锚点';
    case 'local-listing-and-ipfs-explicit':
      return '链上房源 + 手动提供快照';
    case 'local-listing-chain-only':
      return '仅链上房源';
    default:
      return source || '';
  }
}

function formatDateTimeFromSec(value) {
  const sec = Number(value || 0);
  if (!Number.isFinite(sec) || sec <= 0) return '-';
  return new Date(sec * 1000).toLocaleString('zh-CN', { hour12: false });
}

function buildIpfsGatewayUrl(cid) {
  const normalized = String(cid || '').trim();
  return normalized ? `http://127.0.0.1:8080/ipfs/${normalized}` : '';
}

function buildSnapshotImageUrls(snapshot) {
  const imageCids = Array.isArray(snapshot?.imageCids) ? snapshot.imageCids.filter(Boolean).map((x) => String(x)) : [];
  return imageCids.map((cid) => buildIpfsGatewayUrl(cid)).filter(Boolean);
}

function renderImageGallery(images = [], title = '房源图片') {
  const normalized = Array.isArray(images) ? images.filter(Boolean) : [];
  if (normalized.length === 0) {
    return `<section class="section-block"><h3>${escapeHtml(title)}</h3><p class="muted">暂无图片</p></section>`;
  }
  return `
    <section class="section-block">
      <h3>${escapeHtml(title)}</h3>
      <div class="image-grid">
        ${normalized.map((src, index) => `
          <figure class="image-card">
            <img src="${escapeHtml(src)}" alt="image-${index + 1}" loading="lazy">
          </figure>
        `).join('')}
      </div>
    </section>
  `;
}

function renderCommentCards(title, items, isReview = false) {
  if (!items || items.length === 0) {
    return `<section class="section-block"><h3>${escapeHtml(title)}</h3><p class="muted">暂无链上可验证记录</p></section>`;
  }

  return `
    <section class="section-block">
      <h3>${escapeHtml(title)}</h3>
      <div class="comment-list">
        ${items.map((item) => {
          const meta = [
            isReview ? `评分：${item.rating || 0}` : `类型：${item.feedbackType || item.feedbackTypeCode || ''}`,
            item.contractId ? `合同：${item.contractId}` : '',
            item.txHash ? `交易：${item.txHash}` : '',
            item.commentCid ? `CID：${item.commentCid}` : '',
          ].filter(Boolean).join(' | ');
          return `
            <article class="comment-card ${item.verified ? 'is-ok' : 'is-bad'}">
              <div class="comment-meta">${escapeHtml(meta)}</div>
              <div class="comment-state">${item.verified ? '正文哈希匹配' : '正文哈希不匹配或不可读取'}</div>
              <div class="comment-text">${escapeHtml(item.text || '') || '<span class="muted">未能读取正文</span>'}</div>
              ${item.error ? `<div class="comment-error">${escapeHtml(item.error)}</div>` : ''}
            </article>
          `;
        }).join('')}
      </div>
    </section>
  `;
}

function renderSnapshotSummary(snapshot, fallbackCid = '') {
  if (!snapshot) {
    return '<p class="muted">未能读取快照内容</p>';
  }
  const summary = renderKeyValueGrid([
    { label: '标题', value: snapshot.title || '-' },
    { label: '地址', value: snapshot.address || '-' },
    { label: '租金', value: snapshot.rentAmount ? `${snapshot.rentAmount} ETH/月` : '-' },
    { label: '最少租期', value: snapshot.minLeaseMonths ? `${snapshot.minLeaseMonths} 个月` : '-' },
    { label: '状态', value: snapshot.status || '-' },
    { label: '快照 CID', value: fallbackCid || '-' },
  ]);
  const images = buildSnapshotImageUrls(snapshot);
  return `${summary}${snapshot.description ? `<p class="snapshot-description">${escapeHtml(snapshot.description)}</p>` : ''}${images.length ? renderImageGallery(images, '快照图片') : ''}`;
}

function renderListingResult(result) {
  const snapshotCidValue = result.snapshotCid
    || (result.source === 'local-listing-chain-only' ? '链上未找到快照锚点' : '未提供');
  const summary = renderKeyValueGrid([
    { label: '验真来源', value: formatListingSource(result.source) },
    { label: '网络', value: result.network || '' },
    { label: '房源 ID', value: result.listingId || '' },
    { label: '链上状态', value: result.onchain?.status || '' },
    { label: '链上版本', value: result.onchain?.version ?? '' },
    { label: '快照 CID', value: snapshotCidValue },
    { label: '快照哈希比对', value: result.snapshotHashMatch ? '通过' : '未提供或未通过' },
    { label: '链上房源验真', value: result.verified ? '通过' : '未通过' },
    { label: '评论联动验真', value: result.commentVerification?.allVerified ? '通过' : '存在失败或缺失' },
  ]);

  const comparisons = Object.entries(result.comparisons || {}).map(([key, value]) => ({
    label: key,
    value: value ? 'true' : 'false',
  }));

  const commentSummary = renderKeyValueGrid([
    { label: '反馈数量', value: result.commentVerification?.totals?.feedbackCount ?? 0 },
    { label: '评价数量', value: result.commentVerification?.totals?.reviewCount ?? 0 },
    { label: '评论材料总体验证', value: result.commentVerification?.allVerified ? '通过' : '存在失败或缺失' },
  ]);

  return `
    <section class="section-block">
      <h3>房源验真结果</h3>
      <p class="summary ${result.verified ? 'is-ok' : 'is-bad'}">${escapeHtml(result.conclusion || '')}</p>
      ${summary}
    </section>
    <section class="section-block">
      <h3>房源比对项</h3>
      ${renderKeyValueGrid(comparisons)}
    </section>
    <section class="section-block">
      <h3>评论联动概览</h3>
      ${commentSummary}
    </section>
    ${renderCommentCards('房源反馈', result.commentVerification?.feedbacks || [], false)}
    ${renderCommentCards('真实租客评价', result.commentVerification?.reviews || [], true)}
    <details class="raw-block">
      <summary>查看原始 JSON</summary>
      <pre class="output">${escapeHtml(JSON.stringify(result, null, 2))}</pre>
    </details>
  `;
}

function renderHistoryCards(items) {
  if (!items || items.length === 0) {
    return `<section class="section-block"><h3>历史版本</h3><p class="muted">未查询全部历史版本，或链上暂无历史快照锚点。</p></section>`;
  }

  return `
    <section class="section-block">
      <h3>历史版本</h3>
      <div class="history-list">
        ${items.map((item) => `
          <article class="history-card ${item.available ? '' : 'is-bad'}">
            <div class="history-head">
              <strong>版本 ${escapeHtml(item.version)}</strong>
              <span>${escapeHtml(formatDateTimeFromSec(item.blockTime))}</span>
            </div>
            ${renderKeyValueGrid([
              { label: '区块号', value: item.blockNumber || '-' },
              { label: '交易哈希', value: item.txHash || '-' },
              { label: '快照 CID', value: item.snapshotCid || '-' },
              { label: '快照哈希', value: item.snapshotHash || '-' },
              { label: '内容哈希', value: item.contentHash || '-' },
              { label: '快照校验', value: item.snapshotHashMatch ? '通过' : '未通过' },
            ])}
            ${item.available ? renderSnapshotSummary(item.snapshot, item.snapshotCid) : `<p class="comment-error">${escapeHtml(item.error || 'IPFS 读取失败')}</p>`}
          </article>
        `).join('')}
      </div>
    </section>
  `;
}

function renderListingDetailResult(result) {
  const latestSnapshot = result.latestSnapshot;
  const latestSummary = renderKeyValueGrid([
    { label: '网络', value: result.network || '' },
    { label: '房源 ID', value: result.listingId || '' },
    { label: '链上状态', value: result.onchain?.status || '' },
    { label: '链上版本', value: result.onchain?.version ?? '' },
    { label: '房东地址', value: result.onchain?.landlord || '' },
    { label: '当前 rentAmountWei', value: result.onchain?.rentAmountWei || '' },
    { label: '当前最少租期', value: result.onchain?.minLeaseMonths ?? '' },
    { label: '当前图片根哈希', value: result.onchain?.imageRootHash || '' },
  ]);
  const anchorSummary = result.latestAnchor
    ? renderKeyValueGrid([
      { label: '最新快照 CID', value: result.latestAnchor.snapshotCid || '' },
      { label: '最新快照哈希', value: result.latestAnchor.snapshotHash || '' },
      { label: '快照锚点版本', value: result.latestAnchor.version || '' },
      { label: '锚点区块时间', value: formatDateTimeFromSec(result.latestAnchor.blockTime) },
      { label: '锚点区块号', value: result.latestAnchor.blockNumber || '' },
      { label: '锚点交易哈希', value: result.latestAnchor.txHash || '' },
    ])
    : '<p class="muted">链上未找到快照锚点。</p>';
  const commentsSummary = renderKeyValueGrid([
    { label: '反馈数量', value: result.commentVerification?.totals?.feedbackCount ?? 0 },
    { label: '评价数量', value: result.commentVerification?.totals?.reviewCount ?? 0 },
    { label: '评论材料总体验证', value: result.commentVerification?.allVerified ? '通过' : '存在失败或缺失' },
  ]);

  const historyCount = Array.isArray(result.historyVersions) ? result.historyVersions.length : 0;
  return `
    <div class="detail-layout">
      <div class="detail-main">
        <section class="section-block">
          <h3>房源详情</h3>
          ${latestSummary}
        </section>
        <section class="section-block">
          <h3>最新快照锚点</h3>
          ${anchorSummary}
        </section>
        <section class="section-block">
          <h3>最新公开快照</h3>
          ${latestSnapshot ? renderSnapshotSummary(latestSnapshot.snapshot, latestSnapshot.snapshotCid) : '<p class="muted">未能读取最新快照。</p>'}
        </section>
        <section class="section-block">
          <h3>评论与评价概览</h3>
          ${commentsSummary}
        </section>
        ${renderCommentCards('房源反馈', result.commentVerification?.feedbacks || [], false)}
        ${renderCommentCards('真实租客评价', result.commentVerification?.reviews || [], true)}
      </div>
      <aside class="detail-side">
        <section class="section-block">
          <h3>历史版本</h3>
          <p class="muted">当前返回 ${historyCount} 条${result.includeHistory ? '链上快照历史' : '历史版本（未勾选全部历史时仅显示说明）'}。</p>
        </section>
        ${renderHistoryCards(result.historyVersions || [])}
      </aside>
    </div>
    <details class="raw-block">
      <summary>查看原始 JSON</summary>
      <pre class="output">${escapeHtml(JSON.stringify(result, null, 2))}</pre>
    </details>
  `;
}

function renderContractResult(result) {
  const summary = renderKeyValueGrid([
    { label: '验真来源', value: result.source || '' },
    { label: '网络', value: result.network || '' },
    { label: '合同 ID', value: result.onchain?.contractId || result.pdfMarkers?.contractId || '' },
    { label: '房源 ID', value: result.onchain?.listingId || result.pdfMarkers?.listingId || '' },
    { label: '合同状态', value: result.onchain?.status || '' },
    { label: '合同验真', value: result.verified ? '通过' : '未通过' },
  ]);

  const comparisons = Object.entries(result.comparisons || {}).map(([key, value]) => ({
    label: key,
    value: value ? 'true' : 'false',
  }));

  const linkedListing = result.listingVerification
    ? renderListingResult(result.listingVerification)
    : '<section class="section-block"><h3>关联房源验真</h3><p class="muted">PDF 中未提供可联动的房源信息</p></section>';

  return `
    <section class="section-block">
      <h3>合同验真结果</h3>
      <p class="summary ${result.verified ? 'is-ok' : 'is-bad'}">${escapeHtml(result.conclusion || '')}</p>
      ${summary}
    </section>
    <section class="section-block">
      <h3>合同比对项</h3>
      ${renderKeyValueGrid(comparisons)}
    </section>
    ${linkedListing}
    <details class="raw-block">
      <summary>查看原始 JSON</summary>
      <pre class="output">${escapeHtml(JSON.stringify(result, null, 2))}</pre>
    </details>
  `;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || '请求失败');
  }
  return payload.result;
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const name = tab.dataset.tab;
    tabs.forEach((item) => item.classList.toggle('is-active', item === tab));
    panels.forEach((panel) => panel.classList.toggle('is-active', panel.dataset.panel === name));
  });
});

document.getElementById('contract-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  if (!formData.get('pdf') || !formData.get('pdf').size) {
    setStatus('请选择合同 PDF 文件', 'error');
    showResult('未上传文件');
    return;
  }

  setStatus('正在验证合同 PDF...', '');
  showResult('请求已发送');

  try {
    const response = await fetch('/api/verify/contract-pdf', {
      method: 'POST',
      body: formData,
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || '合同验真失败');
    }
    setStatus(payload.result?.verified ? '合同验真通过' : '合同验真未通过', payload.result?.verified ? 'ok' : 'error');
    showResult(payload.result, 'contract');
  } catch (error) {
    setStatus('合同验真失败', 'error');
    showResult(error.message || '未知错误');
  }
});

document.getElementById('listing-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const listingId = String(formData.get('listingId') || '').trim();
  if (!listingId) {
    setStatus('请填写房源 ID', 'error');
    showResult('房源 ID 为空');
    return;
  }

  const body = {
    network: String(formData.get('network') || 'sepolia'),
    listingId,
    snapshotCid: String(formData.get('snapshotCid') || '').trim(),
    snapshotHash: String(formData.get('snapshotHash') || '').trim(),
    atSec: Number(formData.get('atSec') || 0),
    rpcUrl: String(formData.get('rpcUrl') || '').trim(),
    contractAddress: String(formData.get('contractAddress') || '').trim(),
  };

  setStatus('正在验证房源...', '');
  showResult('请求已发送');

  try {
    const result = await postJson('/api/verify/listing', body);
    setStatus(result?.verified ? '房源验真通过' : '房源验真未通过', result?.verified ? 'ok' : 'error');
    showResult(result, 'listing');
  } catch (error) {
    setStatus('房源验真失败', 'error');
    showResult(error.message || '未知错误');
  }
});

document.getElementById('listing-detail-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const listingId = String(formData.get('listingId') || '').trim();
  if (!listingId) {
    setStatus('请填写房源 ID', 'error');
    showResult('房源 ID 为空');
    return;
  }

  const body = {
    network: String(formData.get('network') || 'sepolia'),
    listingId,
    includeHistory: formData.get('includeHistory') === '1',
    rpcUrl: String(formData.get('rpcUrl') || '').trim(),
    contractAddress: String(formData.get('contractAddress') || '').trim(),
  };

  setStatus(body.includeHistory ? '正在读取房源详情与全部历史版本...' : '正在读取房源详情...', '');
  showResult('请求已发送');

  try {
    const result = await postJson('/api/listing-detail', body);
    setStatus('房源详情读取完成', 'ok');
    showResult(result, 'listing-detail');
  } catch (error) {
    setStatus('房源详情读取失败', 'error');
    showResult(error.message || '未知错误');
  }
});
