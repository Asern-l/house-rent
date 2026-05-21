import React, { useState } from 'react';
import { apiGet } from '../shared/api/api';
import { CheckCircleIcon, SearchIcon, XCircleIcon, AlertCircleIcon } from 'lucide-react';

export default function VerifyPage() {
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
    <div className="mx-auto max-w-3xl animate-fade-in">
      <h1 className="mb-4 text-2xl font-bold text-gray-100">合同验真</h1>

      <form onSubmit={handleVerify} className="card mb-4 p-4">
        <label className="mb-2 block text-sm text-gray-400">合同ID</label>
        <div className="flex gap-2">
          <input
            value={contractId}
            onChange={(e) => setContractId(e.target.value)}
            className="input-field"
            placeholder="输入合同ID，例如 cnt_xxx"
          />
          <button type="submit" className="btn-primary inline-flex items-center gap-1.5" disabled={loading}>
            <SearchIcon className="h-4 w-4" />
            {loading ? '查询中...' : '查询'}
          </button>
        </div>
      </form>

      {error && (
        <div className="mb-4 rounded-lg border border-red-800/50 bg-red-900/20 p-3 text-sm text-red-400">{error}</div>
      )}

      {result && (
        <div className="card space-y-4 p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-gray-400">合同ID: {result.contractId || contractId}</p>
            <div className="flex items-center space-x-2">
              {hashMatch === true ? (
                <CheckCircleIcon className="h-5 w-5 text-green-400" />
              ) : hashMatch === false ? (
                <XCircleIcon className="h-5 w-5 text-red-400" />
              ) : (
                <AlertCircleIcon className="h-5 w-5 text-yellow-400" />
              )}
              <span className="text-sm font-medium text-gray-200">
                {hashMatch === true ? '哈希匹配' : hashMatch === false ? '哈希不匹配' : '待校验'}
              </span>
            </div>
          </div>

          <div className="rounded-lg bg-gray-800 p-3 text-sm text-gray-300">
            <p>链上状态: {hasOnchain ? '已上链' : '未上链'}</p>
            <p className="mt-1 break-all">交易哈希: {txHash || '-'}</p>
            {txHash && txHash.startsWith('0x') && (
              <a
                className="mt-2 inline-block text-primary-400 underline"
                href={`https://sepolia.etherscan.io/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                在浏览器查看交易
              </a>
            )}
          </div>

          <div className="rounded-lg bg-gray-800 p-3 text-sm text-gray-300">
            <p>支付核验: {paymentVerified ? '已完成首笔支付（合同已生效）' : '未检索到首笔支付（合同未生效）'}</p>
            <p className="mt-1">支付记录数: {result?.paymentCount ?? 0}</p>
            {initialPayment?.txHash && (
              <>
                <p className="mt-1 break-all">首笔支付交易: {initialPayment.txHash}</p>
                <a
                  className="mt-2 inline-block text-primary-400 underline"
                  href={`https://sepolia.etherscan.io/tx/${initialPayment.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  查看首笔支付交易
                </a>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
