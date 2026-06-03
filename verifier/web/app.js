const tabs = Array.from(document.querySelectorAll('.tab'));
const panels = Array.from(document.querySelectorAll('.panel'));
const configFormEl = document.getElementById('config-form');
const activeConfigSelectEl = document.getElementById('active-config-select');
const configSelectEls = Array.from(document.querySelectorAll('.config-select'));
const configImportTextEl = document.getElementById('config-import-text');

const panelViews = {
  config: {
    statusEl: document.getElementById('status-config'),
    resultEl: document.getElementById('result-config'),
  },
  contract: {
    statusEl: document.getElementById('status-contract'),
    resultEl: document.getElementById('result-contract'),
  },
  listing: {
    statusEl: document.getElementById('status-listing'),
    resultEl: document.getElementById('result-listing'),
  },
  'listing-detail': {
    statusEl: document.getElementById('status-listing-detail'),
    resultEl: document.getElementById('result-listing-detail'),
  },
  emergency: {
    statusEl: document.getElementById('status-emergency'),
    resultEl: document.getElementById('result-emergency'),
  },
};

const configStoreState = {
  activeConfigName: '',
  configs: [],
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function findSavedConfigByName(name) {
  const target = String(name || '').trim().toLowerCase();
  if (!target) return null;
  return configStoreState.configs.find((item) => String(item.name || '').trim().toLowerCase() === target) || null;
}

async function ensureWalletOnChain({ chainId, chainIdHex, chainName, rpcUrl }) {
  if (!window.ethereum) {
    throw new Error('未检测到浏览器钱包，请先安装并启用 MetaMask 等 EVM 钱包。');
  }
  const targetHex = chainIdHex || `0x${Number(chainId || 0).toString(16)}`;
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: targetHex }],
    });
  } catch (error) {
    if (error?.code !== 4902) throw error;
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: targetHex,
        chainName: chainName || `Chain ${Number(chainId || 0)}`,
        rpcUrls: rpcUrl ? [rpcUrl] : [],
        nativeCurrency: {
          name: 'Ether',
          symbol: 'ETH',
          decimals: 18,
        },
      }],
    });
  }
}

async function requestWalletAccount() {
  if (!window.ethereum) {
    throw new Error('未检测到浏览器钱包，请先安装并启用 MetaMask 等 EVM 钱包。');
  }
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  const first = Array.isArray(accounts) && accounts[0] ? String(accounts[0]).toLowerCase() : '';
  if (!first) {
    throw new Error('当前钱包未返回可用账户。');
  }
  return first;
}

function getPanelView(panelName) {
  const view = panelViews[panelName];
  if (!view) throw new Error(`unknown panel: ${panelName}`);
  return view;
}

function setStatus(panelName, text, kind = '') {
  const { statusEl } = getPanelView(panelName);
  statusEl.textContent = text;
  statusEl.className = `status${kind ? ` is-${kind}` : ''}`;
}

function showRawResult(panelName, value) {
  const { resultEl } = getPanelView(panelName);
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

function renderTextBlock(title, text) {
  return `
    <section class="section-block">
      <h3>${escapeHtml(title)}</h3>
      <pre class="output">${escapeHtml(text || '-')}</pre>
    </section>
  `;
}

function formatDateTimeFromSec(value) {
  const sec = Number(value || 0);
  if (!Number.isFinite(sec) || sec <= 0) return '-';
  return new Date(sec * 1000).toLocaleString('zh-CN', { hour12: false });
}

function displayCnDateTime(value) {
  return String(value || '').trim() || '-';
}

function buildIpfsGatewayUrl(cid) {
  const normalized = String(cid || '').trim();
  return normalized ? `http://127.0.0.1:8080/ipfs/${normalized}` : '';
}

function buildSnapshotImageUrls(snapshot) {
  const imageCids = Array.isArray(snapshot?.imageCids) ? snapshot.imageCids.filter(Boolean).map(String) : [];
  return imageCids.map((cid) => buildIpfsGatewayUrl(cid)).filter(Boolean);
}

function renderImageGallery(images = [], title = '房源图片') {
  const normalized = Array.isArray(images) ? images.filter(Boolean) : [];
  if (!normalized.length) {
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
              <div class="comment-text">${item.text ? escapeHtml(item.text) : '<span class="muted">未能读取正文</span>'}</div>
              ${item.error ? `<div class="comment-error">${escapeHtml(item.error)}</div>` : ''}
            </article>
          `;
        }).join('')}
      </div>
    </section>
  `;
}

function renderSnapshotSummary(snapshot, snapshotCid = '') {
  if (!snapshot) return '<p class="muted">未能读取快照内容</p>';
  const summary = renderKeyValueGrid([
    { label: '标题', value: snapshot.title || '-' },
    { label: '地址', value: snapshot.address || '-' },
    { label: '租金', value: snapshot.rentAmount ? `${snapshot.rentAmount} ETH/月` : '-' },
    { label: '最少租期', value: snapshot.minLeaseMonths ? `${snapshot.minLeaseMonths} 个月` : '-' },
    { label: '状态', value: snapshot.status || '-' },
    { label: '快照 CID', value: snapshotCid || '-' },
  ]);
  const images = buildSnapshotImageUrls(snapshot);
  return `${summary}${snapshot.description ? `<p class="snapshot-description">${escapeHtml(snapshot.description)}</p>` : ''}${images.length ? renderImageGallery(images, '快照图片') : ''}`;
}

function renderHistoryCards(items) {
  if (!items || items.length === 0) {
    return `<section class="section-block"><h3>历史版本</h3><p class="muted">暂无可展示的历史版本。</p></section>`;
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

function renderListingResult(result) {
  const summary = renderKeyValueGrid([
    { label: '配置名称', value: result.selectedConfigName || '-' },
    { label: '链 ID', value: result.chainId || '-' },
    { label: '房源 ID', value: result.listingId || '-' },
    { label: '链上状态', value: result.onchain?.status || '-' },
    { label: '链上版本', value: result.onchain?.version ?? '-' },
    { label: '快照 CID', value: result.snapshotCid || '-' },
    { label: '快照哈希比对', value: result.snapshotHashMatch ? '通过' : '未提供或未通过' },
    { label: '房源验真', value: result.verified ? '通过' : '未通过' },
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
      <h3>评论与评价概览</h3>
      ${commentSummary}
    </section>
    ${renderCommentCards('房源反馈', result.commentVerification?.feedbacks || [], false)}
    ${renderCommentCards('租后评价', result.commentVerification?.reviews || [], true)}
    <details class="raw-block">
      <summary>查看原始 JSON</summary>
      <pre class="output">${escapeHtml(JSON.stringify(result, null, 2))}</pre>
    </details>
  `;
}

function renderListingDetailResult(result) {
  const latestSummary = renderKeyValueGrid([
    { label: '配置名称', value: result.selectedConfigName || '-' },
    { label: '链 ID', value: result.chainId || '-' },
    { label: '房源 ID', value: result.listingId || '-' },
    { label: '链上状态', value: result.onchain?.status || '-' },
    { label: '链上版本', value: result.onchain?.version ?? '-' },
    { label: '房东地址', value: result.onchain?.landlord || '-' },
    { label: '当前 rentAmountWei', value: result.onchain?.rentAmountWei || '-' },
    { label: '当前最少租期', value: result.onchain?.minLeaseMonths ?? '-' },
    { label: '当前图片根哈希', value: result.onchain?.imageRootHash || '-' },
  ]);
  const anchorSummary = result.latestAnchor
    ? renderKeyValueGrid([
      { label: '最新快照 CID', value: result.latestAnchor.snapshotCid || '-' },
      { label: '最新快照哈希', value: result.latestAnchor.snapshotHash || '-' },
      { label: '快照锚点版本', value: result.latestAnchor.version || '-' },
      { label: '锚点区块时间', value: formatDateTimeFromSec(result.latestAnchor.blockTime) },
      { label: '锚点区块号', value: result.latestAnchor.blockNumber || '-' },
      { label: '锚点交易哈希', value: result.latestAnchor.txHash || '-' },
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
          ${result.latestSnapshot ? renderSnapshotSummary(result.latestSnapshot.snapshot, result.latestSnapshot.snapshotCid) : '<p class="muted">未能读取最新快照。</p>'}
        </section>
        <section class="section-block">
          <h3>评论与评价概览</h3>
          ${commentsSummary}
        </section>
        ${renderCommentCards('房源反馈', result.commentVerification?.feedbacks || [], false)}
        ${renderCommentCards('租后评价', result.commentVerification?.reviews || [], true)}
      </div>
      <aside class="detail-side">
        <section class="section-block">
          <h3>历史版本</h3>
          <p class="muted">当前返回 ${historyCount} 条历史版本记录。</p>
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

function renderEmergencyReleaseSection(release) {
  if (!release) {
    return '<section class="section-block"><h3>应急托管月租释放</h3><p class="muted">未读取到应急释放状态。</p></section>';
  }
  return `
    <section class="section-block">
      <h3>应急托管月租释放</h3>
      ${renderKeyValueGrid([
        { label: '配置名称', value: release.selectedConfigName || '-' },
        { label: '合同 ID', value: release.contractId || '-' },
        { label: '当前状态', value: release.status || '-' },
        { label: '是否可释放', value: release.canReleaseNow ? '是' : '否' },
        { label: '已释放期数', value: release.releasedPeriods ?? '-' },
        { label: '已赚到期数', value: release.earnedPeriods ?? '-' },
        { label: '已释放金额', value: release.releasedWei || '0' },
        { label: '剩余托管金额', value: release.remainingEscrowWei || '0' },
      ])}
      <p class="muted">${escapeHtml(release.reasonMessage || '')}</p>
      ${release.canReleaseNow && release.preparedTx ? `
        <div class="actions">
          <button
            type="button"
            data-action="emergency-release-rent"
            data-config-name="${escapeHtml(release.selectedConfigName || '')}"
            data-chain-id="${escapeHtml(String(release.preparedTx.chainId || ''))}"
            data-chain-id-hex="${escapeHtml(String(release.preparedTx.chainIdHex || ''))}"
            data-rpc-url="${escapeHtml(String(release.preparedTx.rpcUrl || ''))}"
            data-chain-name="${escapeHtml(String(release.preparedTx.configName || release.selectedConfigName || ''))}"
            data-contract-address="${escapeHtml(String(release.preparedTx.to || ''))}"
            data-contract-id="${escapeHtml(String(release.contractId || ''))}"
            data-landlord="${escapeHtml(String(release.landlord || ''))}"
            data-tx-data="${escapeHtml(String(release.preparedTx.data || ''))}">
            用房东钱包应急触发释放
          </button>
        </div>
      ` : ''}
    </section>
  `;
}

function renderEmergencyResult(result) {
  return `
    ${renderEmergencyReleaseSection(result.emergencyRelease)}
    <details class="raw-block">
      <summary>查看原始 JSON</summary>
      <pre class="output">${escapeHtml(JSON.stringify(result, null, 2))}</pre>
    </details>
  `;
}

function renderContractResult(result) {
  const lifecycle = result.lifecycle || {};
  const summary = renderKeyValueGrid([
    { label: '验真来源', value: result.source || '-' },
    { label: '验真模式', value: result.verificationMode === 'rebuild-hash-and-self-verify-signatures' ? '强校验：重算哈希并自验签' : (result.verificationMode || '-') },
    { label: '配置名称', value: result.selectedConfigName || '-' },
    { label: '链 ID', value: result.pdfMarkers?.chainId || '-' },
    { label: '合同 ID', value: result.onchain?.contractId || result.pdfMarkers?.contractId || '-' },
    { label: '房源 ID', value: result.onchain?.listingId || result.pdfMarkers?.listingId || '-' },
    { label: '合同状态', value: result.onchain?.status || '-' },
    { label: '付款状态', value: lifecycle.paymentState || '-' },
    { label: '当前生效状态', value: lifecycle.effectiveState || '-' },
    { label: '平台手续费', value: `${result.reconstructed?.platformFeeAmount || '0'} ETH` },
    { label: '房东实收', value: `${result.reconstructed?.landlordNetAmount || '0'} ETH` },
    { label: '合同验真', value: result.verified ? '通过' : '未通过' },
  ]);
  const comparisons = Object.entries(result.comparisons || {}).map(([key, value]) => ({
    label: key,
    value: value ? 'true' : 'false',
  }));
  const timeline = renderKeyValueGrid([
    { label: '当前中国时间', value: displayCnDateTime(lifecycle.nowCn) },
    { label: '链上创建时间', value: displayCnDateTime(lifecycle.createdAtCn) },
    { label: '租客签署时间', value: displayCnDateTime(lifecycle.tenantSignedAtCn) },
    { label: '房东签署时间', value: displayCnDateTime(lifecycle.landlordSignedAtCn) },
    { label: '付款截止时间', value: displayCnDateTime(lifecycle.paymentDeadlineCn) },
    { label: '合同起始时间', value: displayCnDateTime(lifecycle.startAtCn) },
    { label: '合同结束时间', value: displayCnDateTime(lifecycle.endAtCn) },
  ]);
  const canImportPdfConfig = Boolean(result.pdfMarkers?.chainId && result.pdfMarkers?.contractAddress);
  const importName = String(result.pdfMarkers?.chainEnv || '').trim() || `chain-${String(result.pdfMarkers?.chainId || '').trim() || 'config'}`;
  const importBlock = canImportPdfConfig ? `
      <section class="section-block">
        <h3>导入当前 PDF 的链上智能合约配置</h3>
        <p class="muted">如需复用当前合同中的链上智能合约配置，可先导入到合约配置表单，再自行决定是否保存。</p>
        <div class="actions">
          <button type="button" data-action="load-contract-config"
            data-name="${escapeHtml(importName)}"
            data-rpc-url="${escapeHtml(String(result.pdfMarkers.rpcUrl || ''))}"
            data-chain-id="${escapeHtml(String(result.pdfMarkers.chainId || ''))}"
            data-contract-address="${escapeHtml(String(result.pdfMarkers.contractAddress || ''))}"
            data-contract-deployed-at="${escapeHtml(String(result.pdfMarkers.chainDeployedAt || ''))}">
            导入当前 PDF 的链上智能合约配置
          </button>
        </div>
      </section>
    ` : '';
  const linkedListing = result.listingVerification
    ? renderListingResult(result.listingVerification)
    : result.pdfMarkers?.listingId
      ? '<section class="section-block"><h3>关联房源验证</h3><p class="muted">当前未启用关联房源验证。</p></section>'
      : '<section class="section-block"><h3>关联房源验证</h3><p class="muted">PDF 中未提供可联动的房源标识。</p></section>';

  return `
    <section class="section-block">
      <h3>合同验真结果</h3>
      <p class="summary ${result.verified ? 'is-ok' : 'is-bad'}">${escapeHtml(result.conclusion || '')}</p>
      ${summary}
    </section>
    ${importBlock}
    <section class="section-block">
      <h3>合同时间线（中国时间）</h3>
      ${timeline}
    </section>
    <section class="section-block">
      <h3>合同比对项</h3>
      ${renderKeyValueGrid(comparisons)}
    </section>
    ${renderTextBlock('已解码的合同 JSON', result.reconstructed?.contentJson ? JSON.stringify(result.reconstructed.contentJson, null, 2) : '')}
    ${renderTextBlock('已解码的租客签名消息原文', result.reconstructed?.tenantMessage || '')}
    ${renderTextBlock('已解码的房东签名消息原文', result.reconstructed?.landlordMessage || '')}
    ${linkedListing}
    <details class="raw-block">
      <summary>查看原始 JSON</summary>
      <pre class="output">${escapeHtml(JSON.stringify(result, null, 2))}</pre>
    </details>
  `;
}
function showResult(panelName, value, type = 'raw') {
  const { resultEl } = getPanelView(panelName);
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
  if (type === 'emergency' && value && typeof value === 'object') {
    resultEl.innerHTML = renderEmergencyResult(value);
    return;
  }
  showRawResult(panelName, value);
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

async function getJson(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || '请求失败');
  }
  return payload.result;
}

function buildConfigOptionLabel(config) {
  return `${config.name}`;
}

function fillConfigSelectOptions() {
  const optionsHtml = configStoreState.configs.length
    ? configStoreState.configs.map((config) => `<option value="${escapeHtml(config.name)}">${escapeHtml(buildConfigOptionLabel(config))}</option>`).join('')
    : '<option value="">暂无可用配置</option>';
  activeConfigSelectEl.innerHTML = optionsHtml;
  configSelectEls.forEach((select) => {
    select.innerHTML = optionsHtml;
  });
  const fallbackName = configStoreState.activeConfigName || configStoreState.configs[0]?.name || '';
  if (fallbackName) {
    activeConfigSelectEl.value = fallbackName;
    configSelectEls.forEach((select) => {
      select.value = fallbackName;
    });
  }
}

async function loadContractConfigs() {
  const result = await getJson('/api/contract-configs');
  configStoreState.activeConfigName = String(result.activeConfigName || '').trim();
  configStoreState.configs = Array.isArray(result.configs) ? result.configs : [];
  fillConfigSelectOptions();
}

function fillConfigForm(data = {}) {
  configFormEl.elements.name.value = String(data.name || '').trim();
  configFormEl.elements.rpcUrl.value = String(data.rpcUrl || '').trim();
  configFormEl.elements.chainId.value = data.chainId ? String(data.chainId) : '';
  configFormEl.elements.contractAddress.value = String(data.contractAddress || '').trim();
  configFormEl.elements.contractDeployedAt.value = String(data.contractDeployedAt || '').trim();
}

function resetConfigForm() {
  configFormEl.reset();
  configFormEl.elements.activate.checked = true;
}

function activateTab(name) {
  tabs.forEach((tab) => tab.classList.toggle('is-active', tab.dataset.tab === name));
  panels.forEach((panel) => panel.classList.toggle('is-active', panel.dataset.panel === name));
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    activateTab(tab.dataset.tab);
  });
});

document.getElementById('contract-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const file = formData.get('pdf');
  if (!file || !file.size) {
    setStatus('contract', '请选择合同 PDF 文件', 'error');
    showResult('contract', '未上传文件');
    return;
  }

  setStatus('contract', '正在验证合同 PDF...');
  showResult('contract', '请求已发送');

  try {
    const response = await fetch('/api/verify/contract-pdf', {
      method: 'POST',
      body: formData,
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || '合同验真失败');
    }
    setStatus('contract', payload.result?.verified ? '合同验真通过' : '合同验真未通过', payload.result?.verified ? 'ok' : 'error');
    showResult('contract', payload.result, 'contract');
  } catch (error) {
    setStatus('contract', '合同验真失败', 'error');
    showResult('contract', error.message || '未知错误');
  }
});

configFormEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  const body = {
    name: String(configFormEl.elements.name.value || '').trim(),
    rpcUrl: String(configFormEl.elements.rpcUrl.value || '').trim(),
    chainId: Number(configFormEl.elements.chainId.value || 0),
    contractAddress: String(configFormEl.elements.contractAddress.value || '').trim(),
    contractDeployedAt: String(configFormEl.elements.contractDeployedAt.value || '').trim(),
    replace: configFormEl.elements.replace.checked,
    activate: configFormEl.elements.activate.checked,
  };
  try {
    await postJson('/api/contract-configs', body);
    await loadContractConfigs();
    setStatus('config', '合约配置已保存', 'ok');
    showResult('config', JSON.stringify(body, null, 2));
  } catch (error) {
    setStatus('config', '保存合约配置失败', 'error');
    showResult('config', error.message || '未知错误');
  }
});

document.getElementById('reset-config-form-btn').addEventListener('click', () => {
  resetConfigForm();
});

document.getElementById('refresh-configs-btn').addEventListener('click', async () => {
  try {
    await loadContractConfigs();
    setStatus('config', '合约配置已刷新', 'ok');
  } catch (error) {
    setStatus('config', '读取合约配置失败', 'error');
    showResult('config', error.message || '未知错误');
  }
});

document.getElementById('activate-config-btn').addEventListener('click', async () => {
  const name = String(activeConfigSelectEl.value || '').trim();
  if (!name) {
    setStatus('config', '请先选择一个合约配置', 'error');
    return;
  }
  try {
    await postJson('/api/contract-configs/activate', { name });
    await loadContractConfigs();
    setStatus('config', '当前合约配置已切换', 'ok');
  } catch (error) {
    setStatus('config', '切换当前合约配置失败', 'error');
    showResult('config', error.message || '未知错误');
  }
});

document.getElementById('parse-config-text-btn').addEventListener('click', async () => {
  const text = String(configImportTextEl.value || '').trim();
  if (!text) {
    setStatus('config', '请先粘贴链上智能合约配置文本', 'error');
    return;
  }
  try {
    const parsed = await postJson('/api/contract-configs/parse-text', { text });
    fillConfigForm({
      name: parsed.defaultName || '',
      rpcUrl: parsed.rpcUrl || '',
      chainId: parsed.chainId || '',
      contractAddress: parsed.contractAddress || '',
      contractDeployedAt: parsed.contractDeployedAt || '',
    });
    setStatus('config', '已解析到合约配置表单', 'ok');
  } catch (error) {
    setStatus('config', '解析链上智能合约配置失败', 'error');
    showResult('config', error.message || '未知错误');
  }
});

document.getElementById('listing-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const listingId = String(formData.get('listingId') || '').trim();
  const configName = String(formData.get('configName') || '').trim();
  if (!listingId) {
    setStatus('listing', '请填写房源 ID', 'error');
    showResult('listing', '房源 ID 为空');
    return;
  }
  if (!configName) {
    setStatus('listing', '请先选择一个合约配置', 'error');
    showResult('listing', '未选择合约配置');
    return;
  }

  setStatus('listing', '正在验证房源...');
  showResult('listing', '请求已发送');

  try {
    const result = await postJson('/api/verify/listing', {
      configName,
      listingId,
      snapshotCid: String(formData.get('snapshotCid') || '').trim(),
      snapshotHash: String(formData.get('snapshotHash') || '').trim(),
      atSec: Number(formData.get('atSec') || 0),
    });
    setStatus('listing', result?.verified ? '房源验真通过' : '房源验真未通过', result?.verified ? 'ok' : 'error');
    showResult('listing', result, 'listing');
  } catch (error) {
    setStatus('listing', '房源验真失败', 'error');
    showResult('listing', error.message || '未知错误');
  }
});

document.getElementById('listing-detail-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const listingId = String(formData.get('listingId') || '').trim();
  const configName = String(formData.get('configName') || '').trim();
  if (!listingId) {
    setStatus('listing-detail', '请填写房源 ID', 'error');
    showResult('listing-detail', '房源 ID 为空');
    return;
  }
  if (!configName) {
    setStatus('listing-detail', '请先选择一个合约配置', 'error');
    showResult('listing-detail', '未选择合约配置');
    return;
  }

  setStatus('listing-detail', '正在读取房源详情...');
  showResult('listing-detail', '请求已发送');

  try {
    const result = await postJson('/api/listing-detail', {
      configName,
      listingId,
      includeHistory: String(formData.get('includeHistory') || '') === '1',
    });
    setStatus('listing-detail', '房源详情读取完成', 'ok');
    showResult('listing-detail', result, 'listing-detail');
  } catch (error) {
    setStatus('listing-detail', '房源详情读取失败', 'error');
    showResult('listing-detail', error.message || '未知错误');
  }
});

document.getElementById('emergency-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const configName = String(formData.get('configName') || '').trim();
  const contractId = String(formData.get('contractId') || '').trim();
  if (!configName) {
    setStatus('emergency', '请先选择一个合约配置', 'error');
    showResult('emergency', '未选择合约配置');
    return;
  }
  if (!contractId) {
    setStatus('emergency', '请填写合同 ID', 'error');
    showResult('emergency', '合同 ID 为空');
    return;
  }

  setStatus('emergency', '正在读取应急释放状态...');
  showResult('emergency', '请求已发送');

  try {
    const result = await postJson('/api/emergency-release-state', {
      configName,
      contractId,
    });
    setStatus('emergency', '应急释放状态读取完成', 'ok');
    showResult('emergency', result, 'emergency');
  } catch (error) {
    setStatus('emergency', '应急释放状态读取失败', 'error');
    showResult('emergency', error.message || '未知错误');
  }
});

async function handleEmergencyReleaseClick(event) {
  const releaseButton = event.target.closest('[data-action="emergency-release-rent"]');
  if (!releaseButton) return;

  try {
    releaseButton.disabled = true;
    setStatus('emergency', '正在连接钱包并发起应急释放交易...');
    const configName = String(releaseButton.dataset.configName || '').trim();
    const landlord = String(releaseButton.dataset.landlord || '').trim().toLowerCase();
    const chainId = Number(releaseButton.dataset.chainId || 0);
    const chainIdHex = String(releaseButton.dataset.chainIdHex || '').trim();
    const rpcUrl = String(releaseButton.dataset.rpcUrl || '').trim();
    const chainName = String(releaseButton.dataset.chainName || '').trim() || configName;
    const to = String(releaseButton.dataset.contractAddress || '').trim();
    const data = String(releaseButton.dataset.txData || '').trim();
    const contractId = String(releaseButton.dataset.contractId || '').trim();

    if (!configName || !findSavedConfigByName(configName)) {
      throw new Error('当前合同尚未匹配到已保存的合约配置，请先在“合约配置”页保存并设为当前配置。');
    }
    await ensureWalletOnChain({ chainId, chainIdHex, chainName, rpcUrl });
    const account = await requestWalletAccount();
    if (landlord && account !== landlord) {
      throw new Error(`当前连接的钱包不是房东地址。请切换到房东钱包后再触发释放。房东地址：${landlord}`);
    }
    const txHash = await window.ethereum.request({
      method: 'eth_sendTransaction',
      params: [{ from: account, to, data }],
    });
    setStatus('emergency', `应急释放交易已发出：${txHash}`, 'ok');
    showResult('emergency', `合同 ${contractId} 的托管月租释放交易已提交。\n交易哈希：${txHash}`);
  } catch (error) {
    setStatus('emergency', '应急释放失败', 'error');
    showResult('emergency', error.message || '未能完成应急释放');
  } finally {
    releaseButton.disabled = false;
  }
}

getPanelView('contract').resultEl.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action="load-contract-config"]');
  if (!button) return;
  fillConfigForm({
    name: button.dataset.name || '',
    rpcUrl: button.dataset.rpcUrl || '',
    chainId: Number(button.dataset.chainId || 0),
    contractAddress: button.dataset.contractAddress || '',
    contractDeployedAt: button.dataset.contractDeployedAt || '',
  });
  activateTab('config');
  setStatus('config', '已将 PDF 的链上智能合约配置导入表单，可自行决定是否保存', 'ok');
  setStatus('contract', '已导入到“合约配置”页，请确认后保存', 'ok');
});

getPanelView('emergency').resultEl.addEventListener('click', handleEmergencyReleaseClick);

loadContractConfigs().catch((error) => {
  setStatus('config', '读取合约配置失败', 'error');
  showResult('config', error.message || '未知错误');
});
