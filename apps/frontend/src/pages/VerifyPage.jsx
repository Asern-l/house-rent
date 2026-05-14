/**
 * 文件说明：合同验真页
 * - 输入合同ID后查询后端验真结果。
 * - 展示哈希匹配状态、链上交易哈希与基础信息。
 */
import React, { useState } from 'react';
import { apiGet } from '../shared/api/api';
import { CheckCircleIcon, SearchIcon, XCircleIcon, AlertCircleIcon } from 'lucide-react';

// 函数 1: 页面主组件。
export default function VerifyPage() {
  const [contractId, setContractId] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

    // 函数 2: 按合同ID执行验真查询。
  const handleVerify = async (e) => {
    e.preventDefault();
    const id = contractId.trim();
    if (!id) {
      setError('请输入合同ID');
      return;
    }

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
      <h1 className="mb-4 text-2xl font-bold text-gray-800">合同验真</h1>

      <form onSubmit={handleVerify} className="card mb-4 p-4">
        <label className="mb-2 block text-sm text-gray-600">合同ID</label>
        <div className="flex gap-2">
          <input
            value={contractId}
            onChange={(e) => setContractId(e.target.value)}
            className="input-field"
            placeholder="输入合同ID，例如 cnt_xxx"
          />
          <button type="submit" className="btn-primary inline-flex items-center" disabled={loading}>
            <SearchIcon className="mr-1 h-4 w-4" />
            {loading ? '查询中...' : '查询'}
          </button>
        </div>
      </form>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {result && (
        <div className="card space-y-4 p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-gray-500">合同ID: {result.contractId || contractId}</p>
            <div className="flex items-center space-x-2">
              {hashMatch === true ? (
                <CheckCircleIcon className="h-5 w-5 text-green-500" />
              ) : hashMatch === false ? (
                <XCircleIcon className="h-5 w-5 text-red-500" />
              ) : (
                <AlertCircleIcon className="h-5 w-5 text-yellow-500" />
              )}
              <span className="text-sm font-medium text-gray-700">
                {hashMatch === true ? '哈希匹配' : hashMatch === false ? '哈希不匹配' : '待校验'}
              </span>
            </div>
          </div>

          <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
            <p>链上状态: {hasOnchain ? '已上链' : '未上链'}</p>
            <p className="mt-1 break-all">交易哈希: {txHash || '-'}</p>
            {txHash && txHash.startsWith('0x') && (
              <a
                className="mt-2 inline-block text-primary-600 underline"
                href={`https://sepolia.etherscan.io/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                在浏览器查看交易
              </a>
            )}
          </div>

          <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
            <p>支付核验: {paymentVerified ? '已完成首笔支付（合同已生效）' : '未检索到首笔支付（合同未生效）'}</p>
            <p className="mt-1">支付记录数: {result?.paymentCount ?? 0}</p>
            {initialPayment?.txHash && (
              <>
                <p className="mt-1 break-all">首笔支付交易: {initialPayment.txHash}</p>
                <a
                  className="mt-2 inline-block text-primary-600 underline"
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







