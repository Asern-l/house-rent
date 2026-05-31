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

function renderKeyValueGrid(items) {
  return `<div class="kv-grid">${items.map(({ label, value }) => `
    <div class="kv-item">
      <div class="kv-label">${escapeHtml(label)}</div>
      <div class="kv-value">${escapeHtml(value)}</div>
    </div>
  `).join('')}</div>`;
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

function renderListingResult(result) {
  const summary = renderKeyValueGrid([
    { label: '验真来源', value: result.source || '' },
    { label: '网络', value: result.network || '' },
    { label: '房源 ID', value: result.listingId || '' },
    { label: '链上状态', value: result.onchain?.status || '' },
    { label: '链上版本', value: result.onchain?.version ?? '' },
    { label: '快照 CID', value: result.snapshotCid || '未提供' },
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

function showResult(value, type = 'raw') {
  if (type === 'listing' && value && typeof value === 'object') {
    resultEl.innerHTML = renderListingResult(value);
    return;
  }
  if (type === 'contract' && value && typeof value === 'object') {
    resultEl.innerHTML = renderContractResult(value);
    return;
  }
  resultEl.innerHTML = `<pre class="output">${escapeHtml(typeof value === 'string' ? value : JSON.stringify(value, null, 2))}</pre>`;
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
  const form = event.currentTarget;
  const formData = new FormData(form);
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
    const response = await fetch('/api/verify/listing', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || '房源验真失败');
    }
    setStatus(payload.result?.verified ? '房源验真通过' : '房源验真未通过', payload.result?.verified ? 'ok' : 'error');
    showResult(payload.result, 'listing');
  } catch (error) {
    setStatus('房源验真失败', 'error');
    showResult(error.message || '未知错误');
  }
});
