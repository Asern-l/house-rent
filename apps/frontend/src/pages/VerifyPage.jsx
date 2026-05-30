import React, { useMemo, useState } from 'react';
import { apiGet } from '../shared/api/api';
import {
  AlertCircleIcon,
  CheckCircleIcon,
  SearchIcon,
  ShieldCheckIcon,
  XIcon,
} from 'lucide-react';

const VERIFY_TYPES = [
  { key: 'listing', label: '房源', placeholder: '输入房源 ID，例如 lst_xxx' },
  { key: 'contract', label: '合同', placeholder: '输入合同 ID，例如 cnt_xxx' },
];

const LISTING_CHECK_LABELS = {
  listingIdMatch: '房源 ID',
  landlordMatch: '房东钱包',
  contentHashMatch: '内容哈希',
  rentAmountWeiMatch: '租金（wei）',
  minLeaseMonthsMatch: '最短租期',
  imageRootHashMatch: '图片根哈希',
  listingStatusMatch: '房源本体状态',
  occupancyMatch: '占用语义',
  versionMatch: '版本号',
  nonceMatch: '操作序号',
};

const CONTRACT_CHECK_LABELS = {
  contractIdMatch: '合同 ID',
  listingIdMatch: '房源 ID',
  tenantMatch: '租客钱包',
  landlordMatch: '房东钱包',
  contentHashMatch: '内容哈希',
  tenantMessageHashMatch: '租客消息哈希',
  landlordMessageHashMatch: '房东消息哈希',
  tenantSignatureEventMatch: '租客签名事件',
  landlordSignatureEventMatch: '房东签名事件',
};

const SEMANTIC_STATE_LABELS = {
  signing: '签约中',
  pending_payment: '待支付',
  future_reserved: '待生效',
  effective: '当前有效',
  expired: '已过期',
  inactive: '未生效',
  missing: '链上缺失',
};

function semanticLabel(value) {
  return SEMANTIC_STATE_LABELS[String(value || '').trim()] || value || '-';
}

function getExplorerBase() {
  const network = String(localStorage.getItem('preferredNetwork') || 'sepolia').toLowerCase();
  if (network === 'sepolia') return 'https://sepolia.etherscan.io/tx/';
  return '';
}

function formatUnixTime(seconds) {
  const value = Number(seconds || 0);
  if (!Number.isFinite(value) || value <= 0) return '-';
  return new Date(value * 1000).toLocaleString('zh-CN', { hour12: false });
}

function resultText(value) {
  return value ? '一致' : '不一致';
}

export default function VerifyPage({ onClose }) {
  const isModal = typeof onClose === 'function';
  const [verifyType, setVerifyType] = useState('listing');
  const [entityId, setEntityId] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const typeMeta = useMemo(
    () => VERIFY_TYPES.find((item) => item.key === verifyType) || VERIFY_TYPES[0],
    [verifyType]
  );

  const handleVerify = async (e) => {
    e.preventDefault();
    const id = entityId.trim();
    if (!id) {
      setError(`请输入${typeMeta.label} ID`);
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const path = verifyType === 'listing' ? `/verify/listing/${id}` : `/verify/contract/${id}`;
      const res = await apiGet(path);
      setResult(res?.data || null);
    } catch (err) {
      setError(err?.response?.data?.error || '查询失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const txHash = result?.dbSnapshot?.txHash || result?.txHash || '';
  const txExplorerBase = getExplorerBase();
  const comparisons = result?.comparisons || null;

  return (
    <div className={isModal ? 'fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-stone-950/55 px-4 py-6 backdrop-blur-sm' : 'mx-auto w-full max-w-[760px] animate-fade-in'}>
      <div
        className="relative w-full max-w-[760px] rounded-[1.5rem] border border-primary-600/20 p-8 shadow-[0_22px_55px_rgba(27,23,18,0.28)] animate-fade-in"
        style={{ background: 'linear-gradient(180deg, rgba(245,240,232,0.98) 0%, rgba(242,236,226,0.98) 100%)' }}
      >
        {isModal && onClose && <CloseButton onClose={onClose} />}

        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#fbf7ef] text-stone-950 shadow-[0_12px_30px_rgba(36,31,26,0.18)]">
            <ShieldCheckIcon className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-stone-950">链上验真</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-stone-500">
            支持按房源或合同查询当前网络的验真结果，展示关键 ID、哈希、版本号、操作序号与上链状态。
          </p>
        </div>

        <form onSubmit={handleVerify} className="rounded-2xl border border-stone-300 bg-[#fbf7ef] p-4">
          <label className="mb-2 block text-xs font-semibold text-stone-500">验真类型</label>
          <div className="mb-3 flex gap-2">
            {VERIFY_TYPES.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setVerifyType(item.key);
                  setEntityId('');
                  setResult(null);
                  setError('');
                }}
                className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors ${
                  verifyType === item.key ? 'bg-stone-900 text-[#f5f0e8]' : 'bg-stone-200 text-stone-700 hover:bg-stone-300'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <label className="mb-2 block text-xs font-semibold text-stone-500">{typeMeta.label} ID</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              className="min-h-[42px] min-w-0 flex-1 rounded-2xl border border-stone-300 bg-[#f5f0e8] px-4 text-sm text-stone-800 outline-none placeholder:text-stone-400 focus:border-primary-600/80"
              placeholder={typeMeta.placeholder}
            />
            <button
              type="submit"
              className="inline-flex h-[42px] items-center justify-center gap-2 rounded-2xl bg-stone-950 px-5 text-sm font-semibold text-[#f5f0e8] transition-colors hover:bg-stone-800 disabled:opacity-60"
              disabled={loading}
            >
              <SearchIcon className="h-4 w-4" />
              {loading ? '查询中...' : '开始验真'}
            </button>
          </div>
        </form>

        {error && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>}

        {result && !result.exists && (
          <section className="mt-4 rounded-2xl border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-800">
            {result.message || `${typeMeta.label}不存在`}
          </section>
        )}

        {result && result.exists && verifyType === 'listing' && (
          <div className="mt-4 space-y-3">
            <StatusCard
              ok={Boolean(result.chainVerified)}
              title={result.chainVerified ? '房源链上验真通过' : '房源链上验真未完全通过'}
              desc={result.conclusion}
            />

            <InfoPanel title="房源标识">
              <KeyValue label="网络" value={result.chainEnv || '-'} />
              <KeyValue label="房源 ID" value={result.listingId || '-'} mono />
              <KeyValue label="数据库上链状态" value={result.dbSnapshot?.onchainState || '-'} />
              <KeyValue label="交易哈希" value={txHash || '-'} mono />
              {txExplorerBase && txHash && txHash.startsWith('0x') && (
                <ExplorerLink href={`${txExplorerBase}${txHash}`} text="在区块浏览器查看房源交易" />
              )}
            </InfoPanel>

            <InfoPanel title="数据库快照">
              <Grid>
                <KeyValue label="状态" value={result.dbSnapshot?.status || '-'} />
                <KeyValue label="内容哈希" value={result.dbSnapshot?.contentHash || '-'} mono />
                <KeyValue label="租金（ETH）" value={result.dbSnapshot?.rentAmount || '-'} />
                <KeyValue label="租金（wei）" value={result.dbSnapshot?.rentAmountWei || '-'} mono />
                <KeyValue label="最短租期（月）" value={String(result.dbSnapshot?.minLeaseMonths ?? '-')} />
                <KeyValue label="图片数" value={String(result.dbSnapshot?.imageCount ?? 0)} />
                <KeyValue label="图片根哈希" value={result.dbSnapshot?.imageRootHash || '-'} mono />
                <KeyValue label="版本号" value={String(result.dbSnapshot?.chainVersion ?? '-')} />
                <KeyValue label="操作序号" value={String(result.dbSnapshot?.chainNonce ?? '-')} />
                <KeyValue label="区块号" value={String(result.dbSnapshot?.chainBlockNumber ?? '-')} />
                <KeyValue label="区块时间" value={formatUnixTime(result.dbSnapshot?.chainBlockTime)} />
                <KeyValue label="房东钱包" value={result.dbSnapshot?.landlordWallet || '-'} mono />
                <KeyValue label="数据库映射合同" value={result.dbSnapshot?.contractMapping?.chainHeadContractId || '-'} mono />
                <KeyValue label="数据库当前生效合同" value={result.dbSnapshot?.contractMapping?.currentEffectiveContractId || '-'} mono />
              </Grid>
            </InfoPanel>

            <InfoPanel title="链上快照">
              {!result.onchain?.readable && <p className="text-red-600">当前网络链上不可读：{result.onchain?.reason || '未知原因'}</p>}
              {result.onchain?.readable && !result.onchain?.exists && <p className="text-yellow-700">链上未查询到该房源记录。</p>}
              {result.onchain?.readable && result.onchain?.exists && (
                <Grid>
                  <KeyValue label="合约地址" value={result.onchain?.contractAddress || '-'} mono />
                  <KeyValue label="房源 ID" value={result.onchain?.listingId || '-'} mono />
                  <KeyValue label="状态" value={result.onchain?.status || '-'} />
                  <KeyValue label="内容哈希" value={result.onchain?.contentHash || '-'} mono />
                  <KeyValue label="租金（wei）" value={result.onchain?.rentAmountWei || '-'} mono />
                  <KeyValue label="最短租期（月）" value={String(result.onchain?.minLeaseMonths ?? '-')} />
                  <KeyValue label="图片根哈希" value={result.onchain?.imageRootHash || '-'} mono />
                  <KeyValue label="版本号" value={String(result.onchain?.version ?? '-')} />
                  <KeyValue label="操作序号" value={String(result.onchain?.nonce ?? '-')} />
                  <KeyValue label="创建时间" value={formatUnixTime(result.onchain?.createdAt)} />
                  <KeyValue label="更新时间" value={formatUnixTime(result.onchain?.updatedAt)} />
                  <KeyValue label="房东钱包" value={result.onchain?.landlord || '-'} mono />
                  <KeyValue label="链上映射合同" value={result.onchain?.chainHeadContractId || '-'} mono />
                  <KeyValue label="链上当前生效合同" value={result.onchain?.currentEffectiveContractId || '-'} mono />
                </Grid>
              )}
            </InfoPanel>

            {comparisons && (
              <InfoPanel title="字段比对结果">
                <ComparisonGrid labels={LISTING_CHECK_LABELS} comparisons={comparisons} />
              </InfoPanel>
            )}
          </div>
        )}

        {result && result.exists && verifyType === 'contract' && (
          <div className="mt-4 space-y-3">
            <StatusCard
              ok={Boolean(result.hashMatch && result.signatureVerification?.allSignaturesValid && (result.onchainAnchored || !result.txHash || result.txHash === '???') && (result.semanticVerification?.semanticMatch ?? true))}
              title="合同验真"
              desc={result.conclusion}
            />

            <InfoPanel title="合同标识">
              <Grid>
                <KeyValue label="网络" value={result.chainEnv || '-'} />
                <KeyValue label="合同 ID" value={result.contractId || '-'} mono />
                <KeyValue label="房源 ID" value={result.listingId || '-'} mono />
                <KeyValue label="合同状态" value={result.status || '-'} />
                <KeyValue label="数据库上链状态" value={result.onchainState || '-'} />
                <KeyValue label="创建时间" value={result.createdAt || '-'} />
                <KeyValue label="更新时间" value={result.updatedAt || '-'} />
              </Grid>
            </InfoPanel>

            <InfoPanel title="哈希验真">
              <Grid>
                <KeyValue label="哈希算法" value={result.hashAlgorithm || 'SHA-256'} />
                <KeyValue label="存储哈希" value={result.storedHash || '-'} mono />
                <KeyValue label="当前哈希" value={result.currentHash || '-'} mono />
                <KeyValue label="结果" value={result.hashMatch ? '匹配' : '不匹配'} />
              </Grid>
            </InfoPanel>

            <InfoPanel title="签名验真">
              <Grid>
                <KeyValue label="租客签名" value={result.signatureVerification?.tenant?.verified ? '通过' : '未通过'} />
                <KeyValue label="房东签名" value={result.signatureVerification?.landlord?.verified ? '通过' : '未通过'} />
                <KeyValue label="租客恢复地址" value={result.signatureVerification?.tenant?.recoveredAddress || '-'} mono />
                <KeyValue label="房东恢复地址" value={result.signatureVerification?.landlord?.recoveredAddress || '-'} mono />
                <KeyValue label="租客消息哈希" value={result.signatureVerification?.tenant?.messageHash || '-'} mono />
                <KeyValue label="房东消息哈希" value={result.signatureVerification?.landlord?.messageHash || '-'} mono />
                <KeyValue label="租客消息字段" value={result.signatureVerification?.tenant?.messageFieldsMatch ? '匹配' : '不匹配'} />
                <KeyValue label="房东消息字段" value={result.signatureVerification?.landlord?.messageFieldsMatch ? '匹配' : '不匹配'} />
              </Grid>
            </InfoPanel>

            <InfoPanel title="链上签名锚定">
              {!result.onchain?.readable && <p className="text-red-600">当前网络链上合同不可读：{result.onchain?.reason || '未知原因'}</p>}
              {result.onchain?.readable && !result.onchain?.exists && <p className="text-yellow-700">链上未查询到该合同记录。</p>}
              {result.onchain?.readable && result.onchain?.exists && (
                <>
                  <Grid>
                    <KeyValue label="合约地址" value={result.onchain?.contractAddress || '-'} mono />
                    <KeyValue label="链上合同状态" value={result.onchain?.status || '-'} />
                    <KeyValue label="链上租客消息哈希" value={result.onchain?.tenantMessageHash || '-'} mono />
                    <KeyValue label="链上房东消息哈希" value={result.onchain?.landlordMessageHash || '-'} mono />
                    <KeyValue label="链上锚定总结果" value={result.onchainAnchored ? '通过' : '未通过'} />
                    <KeyValue label="签名事件数量" value={String(result.onchain?.signatureEvents?.length ?? 0)} />
                  </Grid>
                  {result.onchainComparisons && (
                    <div className="mt-3">
                      <ComparisonGrid labels={CONTRACT_CHECK_LABELS} comparisons={result.onchainComparisons} />
                    </div>
                  )}
                </>
              )}
            </InfoPanel>

            <InfoPanel title="时间语义">
              <Grid>
                <KeyValue label="数据库语义状态" value={semanticLabel(result.semanticVerification?.dbSemanticState)} />
                <KeyValue label="链上语义状态" value={semanticLabel(result.semanticVerification?.onchainSemanticState)} />
                <KeyValue label="语义一致性" value={result.semanticVerification?.semanticMatch ? '一致' : '不一致'} />
                <KeyValue label="懒释放状态" value={result.semanticVerification?.lazyReleaseState ? '是' : '否'} />
                <KeyValue label="数据库当前有效" value={result.semanticVerification?.dbCurrentEffective ? '是' : '否'} />
                <KeyValue label="链上当前有效" value={result.semanticVerification?.onchainCurrentEffective ? '是' : '否'} />
                <KeyValue label="开始时间(ms)" value={result.semanticVerification?.startAtMs || '-'} mono />
                <KeyValue label="结束时间(ms)" value={result.semanticVerification?.endAtMs || '-'} mono />
              </Grid>
            </InfoPanel>

            <InfoPanel title="链上与支付状态">
              <KeyValue label="合同交易哈希" value={result.txHash || '-'} mono />
              {txExplorerBase && result.txHash && result.txHash.startsWith('0x') && (
                <ExplorerLink href={`${txExplorerBase}${result.txHash}`} text="在区块浏览器查看合同交易" />
              )}
              <div className="mt-3" />
              <KeyValue label="首笔支付校验" value={result.paymentVerified ? '已完成，合同已生效' : '未校验到首笔确认支付'} />
              <KeyValue label="支付记录数" value={String(result.paymentCount ?? 0)} />
              {result.initialPayment?.txHash && (
                <>
                  <KeyValue label="首笔支付交易" value={result.initialPayment.txHash} mono />
                  {txExplorerBase && <ExplorerLink href={`${txExplorerBase}${result.initialPayment.txHash}`} text="在区块浏览器查看首笔支付交易" />}
                </>
              )}
            </InfoPanel>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusCard({ ok, title, desc }) {
  return (
    <section className={`rounded-2xl border p-4 ${ok ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
      <div className="flex items-start gap-3">
        {ok ? <CheckCircleIcon className="mt-0.5 h-5 w-5 text-emerald-600" /> : <AlertCircleIcon className="mt-0.5 h-5 w-5 text-amber-600" />}
        <div>
          <p className={`text-sm font-semibold ${ok ? 'text-emerald-700' : 'text-amber-700'}`}>{title}</p>
          <p className="mt-1 text-sm text-stone-700">{desc}</p>
        </div>
      </div>
    </section>
  );
}

function ComparisonGrid({ labels, comparisons }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {Object.entries(comparisons).map(([key, value]) => (
        <div
          key={key}
          className={`rounded-xl border px-3 py-2 text-sm ${
            value ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {labels[key] || key}：{resultText(Boolean(value))}
        </div>
      ))}
    </div>
  );
}

function Grid({ children }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}

function KeyValue({ label, value, mono = false }) {
  return (
    <div>
      <p className="text-xs font-semibold text-stone-500">{label}</p>
      <p className={`mt-1 break-all text-sm text-stone-800 ${mono ? 'font-mono text-xs' : ''}`}>{value || '-'}</p>
    </div>
  );
}

function ExplorerLink({ href, text }) {
  return (
    <a className="mt-2 inline-block text-sm font-semibold text-primary-700 underline" href={href} target="_blank" rel="noreferrer">
      {text}
    </a>
  );
}

function InfoPanel({ title, children }) {
  return (
    <section className="rounded-2xl border border-stone-300 bg-[#fbf7ef] p-4 text-sm leading-6 text-stone-700">
      <h2 className="mb-2 text-sm font-semibold text-stone-950">{title}</h2>
      {children}
    </section>
  );
}

function CloseButton({ onClose }) {
  return (
    <button
      type="button"
      onClick={onClose}
      className="absolute right-4 top-4 rounded-full p-1.5 text-stone-400 transition-colors hover:bg-stone-900/5 hover:text-stone-700"
      aria-label="关闭"
    >
      <XIcon className="h-4 w-4" />
    </button>
  );
}
