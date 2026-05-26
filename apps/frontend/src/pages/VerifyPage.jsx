import React, { useMemo, useState } from 'react';
import { apiGet } from '../shared/api/api';
import {
  AlertCircleIcon,
  CheckCircleIcon,
  SearchIcon,
  ShieldCheckIcon,
  XCircleIcon,
  XIcon,
} from 'lucide-react';

const VERIFY_TYPES = [
  { key: 'listing', label: '房源', placeholder: '输入房源 ID，例如 lst_xxx' },
  { key: 'contract', label: '合同', placeholder: '输入合同 ID，例如 cnt_xxx' },
];

function getExplorerBase() {
  const network = String(localStorage.getItem('preferredNetwork') || 'sepolia').toLowerCase();
  if (network === 'sepolia') return 'https://sepolia.etherscan.io/tx/';
  return '';
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
      setError(`请输入${typeMeta.label}ID`);
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

  const txHash = result?.txHash;
  const hasOnchain = Boolean(txHash && txHash !== '未上链');
  const hashMatch = result?.hashMatch;
  const paymentVerified = Boolean(result?.paymentVerified);
  const initialPayment = result?.initialPayment;
  const txExplorerBase = getExplorerBase();

  return (
    <div className={isModal ? 'fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-stone-950/55 px-4 py-6 backdrop-blur-sm' : 'mx-auto w-full max-w-[560px] animate-fade-in'}>
      <div
        className="relative w-full max-w-[560px] rounded-[1.5rem] border border-primary-600/20 p-8 shadow-[0_22px_55px_rgba(27,23,18,0.28)] animate-fade-in"
        style={{
          background:
            'linear-gradient(180deg, rgba(245,240,232,0.98) 0%, rgba(242,236,226,0.98) 100%)',
        }}
      >
        {isModal && onClose && <CloseButton onClose={onClose} />}

        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#fbf7ef] text-stone-950 shadow-[0_12px_30px_rgba(36,31,26,0.18)]">
            <ShieldCheckIcon className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-stone-950">链上验真</h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-stone-500">
            支持按房源或合同查询验真结果，并展示关键 ID 与上链信息。
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
                  verifyType === item.key
                    ? 'bg-stone-900 text-[#f5f0e8]'
                    : 'bg-stone-200 text-stone-700 hover:bg-stone-300'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <label className="mb-2 block text-xs font-semibold text-stone-500">{typeMeta.label}ID</label>
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
              {loading ? '查询中...' : '查询'}
            </button>
          </div>
        </form>

        {error && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">{error}</div>
        )}

        {result && (
          <div className="mt-4 space-y-3">
            {!result.exists && (
              <section className="rounded-2xl border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-800">
                {result.message || `${typeMeta.label}不存在`}
              </section>
            )}

            {result.exists && verifyType === 'listing' && (
              <>
                <InfoPanel title="房源标识">
                  <p>房源ID：{result.listingId || result.id || entityId}</p>
                </InfoPanel>
                <InfoPanel title="上链状态">
                  <p>{hasOnchain ? '已上链' : '未上链'}</p>
                  <p className="mt-1 break-all">交易哈希：{txHash || '-'}</p>
                  {txExplorerBase && txHash && txHash.startsWith('0x') && (
                    <a
                      className="mt-2 inline-block text-sm font-semibold text-primary-700 underline"
                      href={`${txExplorerBase}${txHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      在区块浏览器查看交易
                    </a>
                  )}
                </InfoPanel>
              </>
            )}

            {result.exists && verifyType === 'contract' && (
              <>
                <section className="rounded-2xl border border-stone-300 bg-[#fbf7ef] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-stone-500">合同ID：{result.contractId || entityId}</p>
                      <p className="truncate text-sm text-stone-500">房源ID：{result.listingId || '-'}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {hashMatch === true ? (
                        <CheckCircleIcon className="h-5 w-5 text-emerald-600" />
                      ) : hashMatch === false ? (
                        <XCircleIcon className="h-5 w-5 text-red-500" />
                      ) : (
                        <AlertCircleIcon className="h-5 w-5 text-primary-700" />
                      )}
                      <span className="text-sm font-semibold text-stone-800">
                        {hashMatch === true ? '哈希匹配' : hashMatch === false ? '哈希不匹配' : '待校验'}
                      </span>
                    </div>
                  </div>
                </section>

                <InfoPanel title="上链状态">
                  <p>链上状态：{hasOnchain ? '已上链' : '未上链'}</p>
                  <p className="mt-1 break-all">交易哈希：{txHash || '-'}</p>
                  {txExplorerBase && txHash && txHash.startsWith('0x') && (
                    <a
                      className="mt-2 inline-block text-sm font-semibold text-primary-700 underline"
                      href={`${txExplorerBase}${txHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      在区块浏览器查看交易
                    </a>
                  )}
                </InfoPanel>

                <InfoPanel title="支付核验">
                  <p>{paymentVerified ? '已完成首笔支付（合同已生效）' : '未检索到首笔支付（合同未生效）'}</p>
                  <p className="mt-1">支付记录数：{result?.paymentCount ?? 0}</p>
                  {initialPayment?.txHash && (
                    <>
                      <p className="mt-1 break-all">首笔支付交易：{initialPayment.txHash}</p>
                      {txExplorerBase && (
                        <a
                          className="mt-2 inline-block text-sm font-semibold text-primary-700 underline"
                          href={`${txExplorerBase}${initialPayment.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          查看首笔支付交易
                        </a>
                      )}
                    </>
                  )}
                </InfoPanel>
              </>
            )}
          </div>
        )}
      </div>
    </div>
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
