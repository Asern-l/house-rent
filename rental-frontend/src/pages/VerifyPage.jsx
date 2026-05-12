import React, { useState } from 'react';
import { apiPut } from '../utils/api';
import toast from 'react-hot-toast';
import { SearchIcon, LoaderIcon, CheckCircleIcon, XCircleIcon, ExternalLinkIcon } from 'lucide-react';

export default function VerifyPage() {
  const [type, setType] = useState('contract');
  const [id, setId] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleVerify = async () => {
    if (!id) { toast.error('请输入ID'); return; }
    setLoading(true);
    setResult(null);
    try {
      const { default: axios } = await import('axios');
      const token = localStorage.getItem('token');
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await axios.get(`/api/verify/${type}/${id}`, { headers });
      setResult(res.data.data);
    } catch (err) {
      toast.error(err.response?.data?.error || '验证失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto animate-fade-in">
      <h1 className="text-2xl font-bold text-gray-800 mb-2">链上验证工具</h1>
      <p className="text-gray-500 mb-6">输入房源ID或合同ID，查询链上存证记录并验证真伪</p>

      <div className="card p-6 space-y-4">
        <div className="flex space-x-2">
          <button onClick={() => setType('contract')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${type === 'contract' ? 'bg-primary-100 text-primary-700 ring-1 ring-primary-300' : 'bg-gray-100 text-gray-600'}`}>
            📄 验证合同
          </button>
          <button onClick={() => setType('listing')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${type === 'listing' ? 'bg-primary-100 text-primary-700 ring-1 ring-primary-300' : 'bg-gray-100 text-gray-600'}`}>
            🏠 验证房源
          </button>
        </div>

        <div className="flex space-x-2">
          <input type="text" className="input-field flex-1"
            placeholder={`请输入${type === 'contract' ? '合同' : '房源'}ID`}
            value={id} onChange={e => setId(e.target.value)} />
          <button onClick={handleVerify} disabled={loading} className="btn-primary flex items-center space-x-2">
            {loading ? <LoaderIcon className="w-4 h-4 animate-spin" /> : <SearchIcon className="w-4 h-4" />}
            <span>验证</span>
          </button>
        </div>
      </div>

      {result && (
        <div className="card p-6 mt-4 space-y-3">
          {result.exists === false ? (
            <div className="text-center py-4">
              <XCircleIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500">{result.message}</p>
            </div>
          ) : (
            <>
              <div className="flex items-center space-x-2">
                {result.hashMatch !== false && (result.txHash && result.txHash !== '未上链') ? (
                  <CheckCircleIcon className="w-6 h-6 text-green-500" />
                ) : result.hashMatch === false ? (
                  <XCircleIcon className="w-6 h-6 text-red-500" />
                ) : (
                  <CheckCircleIcon className="w-6 h-6 text-yellow-400" />
                )}
                <h2 className="text-lg font-semibold text-gray-800">{result.conclusion || '验证结果'}</h2>
              </div>

              <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">ID</span>
                  <span className="font-mono text-gray-700">{result.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">状态</span>
                  <span>{result.status}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">创建时间</span>
                  <span>{result.createdAt?.slice(0, 19)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">上链交易</span>
                  <span className="font-mono text-xs text-gray-600">{result.txHash?.slice(0, 30)}...</span>
                </div>
                {result.storedHash && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">存证哈希</span>
                    <span className="font-mono text-xs text-gray-600">{result.storedHash?.slice(0, 30)}...</span>
                  </div>
                )}
                {result.aiScore !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">AI可信度</span>
                    <span className="font-medium">{result.aiScore}分</span>
                  </div>
                )}
              </div>

              {result.txHash && result.txHash !== '未上链' && (
                <a href={`https://sepolia.etherscan.io/tx/${result.txHash}`} target="_blank" rel="noreferrer"
                  className="text-primary-600 text-sm flex items-center space-x-1 hover:underline">
                  <ExternalLinkIcon className="w-4 h-4" /><span>在 Etherscan 上查看交易</span>
                </a>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
