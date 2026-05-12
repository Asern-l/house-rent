import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiGet, apiPost } from '../utils/api';
import toast from 'react-hot-toast';
import { HomeIcon, MapPinIcon, ArrowLeftIcon, LoaderIcon, AlertCircleIcon, CheckCircleIcon } from 'lucide-react';

export default function ListingDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    apiGet(`/listings/${id}`).then(d => setListing(d.data)).catch(() => { toast.error('房源不存在'); navigate('/listings'); }).finally(() => setLoading(false));
  }, [id]);

  const handleApply = async () => {
    if (!user) { toast.error('请先登录'); return; }
    if (user.role !== 'tenant') { toast.error('只有租客可以申请租房'); return; }
    setApplying(true);
    try {
      const res = await apiPost('/contracts', { listingId: id });
      toast.success('申请成功！请等待房东签署');
      navigate(`/contract/${res.data.contractId}`);
    } catch (err) {
      toast.error(err.response?.data?.error || '申请失败');
    } finally {
      setApplying(false);
    }
  };

  if (loading) return <div className="flex justify-center py-20"><LoaderIcon className="w-8 h-8 animate-spin text-primary-600" /></div>;
  if (!listing) return null;

  return (
    <div className="max-w-4xl mx-auto animate-fade-in">
      <button onClick={() => navigate(-1)} className="flex items-center space-x-1 text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeftIcon className="w-4 h-4" /><span>返回</span>
      </button>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card">
          <div className="h-64 bg-gradient-to-br from-primary-100 to-blue-100 flex items-center justify-center">
            <HomeIcon className="w-20 h-20 text-primary-300" />
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <span className={`${listing.status === 'available' ? 'badge-green' : 'badge-gray'} mb-2 inline-block`}>
              {listing.status === 'available' ? '可租' : '已租'}
            </span>
            <span className="badge-green ml-2">AI可信度 {listing.ai_score}分</span>
            <h1 className="text-2xl font-bold text-gray-800 mt-2">{listing.title}</h1>
          </div>

          <p className="text-3xl font-bold text-primary-600">{listing.rent_amount} <span className="text-lg font-normal">ETH/月</span></p>

          <div className="flex items-start space-x-2 text-gray-500">
            <MapPinIcon className="w-4 h-4 mt-1" />
            <span>{listing.address}{listing.district ? ` (${listing.district})` : ''}</span>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-gray-50 rounded-lg p-3"><p className="text-lg font-bold text-gray-700">{listing.bedrooms || '-'}</p><p className="text-xs text-gray-500">室</p></div>
            <div className="bg-gray-50 rounded-lg p-3"><p className="text-lg font-bold text-gray-700">{listing.livingrooms || '-'}</p><p className="text-xs text-gray-500">厅</p></div>
            <div className="bg-gray-50 rounded-lg p-3"><p className="text-lg font-bold text-gray-700">{listing.area || '-'}</p><p className="text-xs text-gray-500">㎡</p></div>
          </div>

          <p className="text-gray-600 leading-relaxed">{listing.description}</p>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
            <p className="font-medium mb-1">🏛️ 法律提示</p>
            <p>本平台电子合同遵循《中华人民共和国民法典》租赁合同相关规定，合同哈希上链存证，不可篡改。</p>
          </div>

          {listing.status === 'available' && user?.role === 'tenant' && (
            <button onClick={handleApply} disabled={applying} className="btn-primary w-full flex items-center justify-center space-x-2 py-3">
              {applying ? <LoaderIcon className="w-5 h-5 animate-spin" /> : null}
              <span>{applying ? '申请中...' : '申请租房'}</span>
            </button>
          )}

          {listing.landlord_id === user?.id && (
            <p className="text-sm text-yellow-600 bg-yellow-50 rounded-lg p-3">这是您的房源</p>
          )}

          {!user && (
            <p className="text-sm text-gray-500 bg-gray-50 rounded-lg p-3 text-center">
              请<a href="/login" className="text-primary-600 underline">登录</a>后申请租房
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
