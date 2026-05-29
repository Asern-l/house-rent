import React, { useState } from 'react';
import { apiGet } from '../shared/api/api';
import {
  AlertCircleIcon,
  CheckCircleIcon,
  SearchIcon,
  ShieldCheckIcon,
  XCircleIcon,
  XIcon,
} from 'lucide-react';

export default function VerifyPage({ onClose }) {
  const [contractId, setContractId] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleVerify = async (e) => {
    e.preventDefault();
    const id = contractId.trim();
    if (!id) { setError('请输入合同ID'); return; }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await apiGet(`/verify/contract/${id}`);
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

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-stone-950/55 px-4 py-6 backdrop-blur-sm">
      <div
        className="card-enter relative w-full max-w-[560px] rounded-[1.5rem] border border-primary-600/20 p-8 shadow-[0_22px_55px_rgba(27,23,18,0.28)]"
        style={{
          background:
            'linear-gradient(180deg, rgba(245,240,232,0.98) 0%, rgba(242,236,226,0.98) 100%)',
        }}
      >
        {onClose && <CloseButton onClose={onClose} />}

        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#fbf7ef] text-stone-950 shadow-[0_12px_30px_rgba(36,31,26,0.18)]">
            <ShieldCheckIcon className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-stone-950">合同验真</h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-stone-500">
            输入合同 ID，核验合同哈希、链上交易与首笔支付记录。
          </p>
        </div>

        <form onSubmit={handleVerify} className="rounded-2xl border border-stone-300 bg-[#fbf7ef] p-4">
          <label className="mb-2 block text-xs font-semibold text-stone-500">合同ID</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={contractId}
              onChange={(e) => setContractId(e.target.value)}
              className="min-h-[42px] min-w-0 flex-1 rounded-2xl border border-stone-300 bg-[#f5f0e8] px-4 text-sm text-stone-800 outline-none placeholder:text-stone-400 focus:border-primary-600/80"
              placeholder="输入合同ID，例如 cnt_xxx"
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
            <section className="rounded-2xl border border-stone-300 bg-[#fbf7ef] p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-sm text-stone-500">合同ID: {result.contractId || contractId}</p>
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

            <InfoPanel title="链上状态">
              <p>链上状态: {hasOnchain ? '已上链' : '未上链'}</p>
              <p className="mt-1 break-all">交易哈希: {txHash || '-'}</p>
              {txHash && txHash.startsWith('0x') && (
                <a
                  className="mt-2 inline-block text-sm font-semibold text-primary-700 underline"
                  href={`https://sepolia.etherscan.io/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  在浏览器查看交易
                </a>
              )}
            </InfoPanel>

            <InfoPanel title="支付核验">
              <p>{paymentVerified ? '已完成首笔支付（合同已生效）' : '未检索到首笔支付（合同未生效）'}</p>
              <p className="mt-1">支付记录数: {result?.paymentCount ?? 0}</p>
              {initialPayment?.txHash && (
                <>
                  <p className="mt-1 break-all">首笔支付交易: {initialPayment.txHash}</p>
                  <a
                    className="mt-2 inline-block text-sm font-semibold text-primary-700 underline"
                    href={`https://sepolia.etherscan.io/tx/${initialPayment.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    查看首笔支付交易
                  </a>
                </>
              )}
            </InfoPanel>
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
