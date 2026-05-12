import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiGet, apiPost, apiPut } from '../utils/api';
import { ethers } from 'ethers';
import RentalChainABI from '../utils/RentalChainABI.json';
import toast from 'react-hot-toast';
import { FileTextIcon, CheckCircleIcon, XCircleIcon, ClockIcon, LoaderIcon, ArrowLeftIcon, AlertTriangleIcon, DownloadIcon } from 'lucide-react';

const CONTRACT_ADDR = '0x2282DDE81F8F591D036DF5f710f595038209281b';

export default function ContractPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [contract, setContract] = useState(null);
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);

  useEffect(() => {
    apiGet(`/contracts/${id}`).then(d => {
      setContract(d.data);
      try { setContent(typeof d.data.content_json === 'string' ? JSON.parse(d.data.content_json) : d.data.content_json); } catch (e) { setContent(d.data.content_json); }
    }).catch(() => toast.error('获取合同失败')).finally(() => setLoading(false));
  }, [id]);

  const handleSign = async (type) => {
    if (!window.ethereum) { toast.error('请安装 MetaMask'); return; }
    setSigning(true);
    try {
      const res = await apiPost(`/contracts/${id}/${type === 'tenant' ? 'sign-tenant' : 'sign-landlord'}`);

      // 如果是房东签署（双方都签完了），自动上链
      if (type === 'landlord' && res.data?.contentHash) {
        try {
          const provider = new ethers.BrowserProvider(window.ethereum);
          const signer = await provider.getSigner();
          const rContract = new ethers.Contract(CONTRACT_ADDR, RentalChainABI, signer);

          const tx = await rContract.storeContract(
            id,
            contract?.listing_id || '',
            res.data.contentHash,
            res.data.tenantAddress,
            res.data.landlordAddress
          );
          await tx.wait();

          await apiPost(`/contracts/${id}/onchain`, { txHash: tx.hash });
          toast.success('合同哈希已上链存证！');
        } catch (err) {
          if (err.code !== 'ACTION_REJECTED') {
            toast.error('上链失败，但合同已签署，可稍后手动上链');
          }
        }
      }

      toast.success(res.data.message || '签署成功！');
      window.location.reload();
    } catch (err) {
      toast.error(err.response?.data?.error || '签署失败');
    } finally {
      setSigning(false);
    }
  };

  const handleCancel = async () => {
    if (!confirm('确定取消该合同吗？')) return;
    try {
      await apiPost(`/contracts/${id}/cancel`);
      toast.success('合同已取消');
      navigate('/contracts');
    } catch (err) {
      toast.error(err.response?.data?.error || '取消失败');
    }
  };

  const STATUS_MAP = {
    pending: { label: '待签署', color: 'badge-yellow' },
    tenant_signed: { label: '租客已签，待房东签署', color: 'badge-blue' },
    landlord_signed: { label: '房东已签，待租客签署', color: 'badge-blue' },
    active: { label: '已生效（已上链）', color: 'badge-green' },
    ended: { label: '已到期', color: 'badge-gray' },
    cancelled: { label: '已取消', color: 'badge-red' },
    expired: { label: '已过期', color: 'badge-gray' },
    disputed: { label: '纠纷中', color: 'badge-red' },
  };

  if (loading) return <div className="flex justify-center py-20"><LoaderIcon className="w-8 h-8 animate-spin text-primary-600" /></div>;
  if (!contract) return <div className="card p-8 text-center"><p className="text-gray-500">合同不存在</p></div>;

  const statusInfo = STATUS_MAP[contract.status] || { label: contract.status, color: 'badge-gray' };
  const isTenant = contract.tenant_id === user?.id;
  const isLandlord = contract.landlord_id === user?.id;

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      <button onClick={() => navigate(-1)} className="flex items-center space-x-1 text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeftIcon className="w-4 h-4" /><span>返回</span>
      </button>

      <div className="card p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <FileTextIcon className="w-6 h-6 text-primary-600" />
            <h1 className="text-xl font-bold text-gray-800">租赁合同</h1>
          </div>
          <span className={`${statusInfo.color} text-sm`}>{statusInfo.label}</span>
        </div>

        {/* 合同内容展示 */}
        {content && (
          <div className="space-y-4 mb-6 border rounded-lg p-4">
            <h2 className="font-bold text-lg text-gray-800 border-b pb-2">房屋租赁合同</h2>
            {contract.tx_hash && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700 flex items-start space-x-2">
                <CheckCircleIcon className="w-5 h-5 mt-0.5" />
                <div>
                  <p className="font-medium">✅ 本合同哈希已上链存证</p>
                  <p className="text-xs mt-1 font-mono break-all">交易哈希：{contract.tx_hash}</p>
                  <p className="text-xs mt-1">可前往<a href={`https://sepolia.etherscan.io/tx/${contract.tx_hash}`} target="_blank" className="underline" rel="noreferrer">区块浏览器</a>查验</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><p className="text-gray-500">出租方（甲方）</p><p className="font-medium">{content.landlord?.nickname || content.landlord?.phone}</p></div>
              <div><p className="text-gray-500">承租方（乙方）</p><p className="font-medium">{content.tenant?.nickname || content.tenant?.phone}</p></div>
              <div className="col-span-2"><p className="text-gray-500">房屋地址</p><p className="font-medium">{content.address}</p></div>
              <div><p className="text-gray-500">月租金</p><p className="font-medium">{content.rentAmount} ETH</p></div>
              <div><p className="text-gray-500">押金</p><p className="font-medium">{content.depositAmount} ETH （{content.depositMonths}个月）</p></div>
              <div><p className="text-gray-500">付款方式</p><p className="font-medium">{content.terms?.paymentMethod === 'monthly' ? '月付' : content.terms?.paymentMethod}</p></div>
              <div><p className="text-gray-500">租期</p><p className="font-medium">{content.terms?.startDate || '待填写'} 至 {content.terms?.endDate || '待填写'}</p></div>
            </div>

            {content.legalClauses && (
              <div>
                <p className="font-medium text-gray-700 mb-2">法律条款（依据《民法典》租赁合同）</p>
                <ul className="list-disc list-inside space-y-1 text-sm text-gray-600">
                  {content.legalClauses.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              </div>
            )}

            <div className="text-xs text-gray-400 pt-2 border-t">
              合同ID：{contract.id} | 生成时间：{contract.created_at}
              {contract.tenant_signed_at && <span> | 租客签署：{contract.tenant_signed_at}</span>}
              {contract.landlord_signed_at && <span> | 房东签署：{contract.landlord_signed_at}</span>}
              {contract.expires_at && <span> | 过期时间：{contract.expires_at}</span>}
            </div>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="space-y-3">
          {contract.status === 'pending' && isTenant && (
            <button onClick={() => handleSign('tenant')} disabled={signing}
              className="btn-primary w-full flex items-center justify-center space-x-2">
              {signing ? <LoaderIcon className="w-5 h-5 animate-spin" /> : <CheckCircleIcon className="w-5 h-5" />}
              <span>{signing ? '签署中...' : '✍️ 同意签署（租客）'}</span>
            </button>
          )}
          {contract.status === 'tenant_signed' && isLandlord && (
            <button onClick={() => handleSign('landlord')} disabled={signing}
              className="btn-primary w-full flex items-center justify-center space-x-2">
              {signing ? <LoaderIcon className="w-5 h-5 animate-spin" /> : <CheckCircleIcon className="w-5 h-5" />}
              <span>{signing ? '处理中...' : '✍️ 同意签署（房东）'}</span>
            </button>
          )}
          {['pending', 'tenant_signed'].includes(contract.status) && (isTenant || isLandlord) && (
            <button onClick={handleCancel} className="btn-secondary w-full">
              取消合同
            </button>
          )}
          {contract.status === 'active' && (
            <div className="bg-green-50 rounded-lg p-4 text-center">
              <CheckCircleIcon className="w-10 h-10 mx-auto text-green-500 mb-2" />
              <p className="text-green-700 font-medium">合同已生效并上链存证</p>
              <p className="text-sm text-green-600 mt-1">具有法律效力，受《电子签名法》保护</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
