import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiGet, apiPut } from '../utils/api';
import toast from 'react-hot-toast';
import { HomeIcon, LoaderIcon, PlusCircleIcon } from 'lucide-react';

export default function MyListings() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.role === 'landlord') {
      apiGet('/listings/mine').then(d => setListings(d.data || [])).catch(() => {}).finally(() => setLoading(false));
    } else { setLoading(false); }
  }, [user]);

  const toggleStatus = async (id, status) => {
    try {
      await apiPut(`/listings/${id}/status`, { status });
      toast.success(status === 'available' ? '房源已重新上架' : '房源已下架');
      setListings(prev => prev.map(l => l.id === id ? { ...l, status } : l));
    } catch (err) {
      toast.error(err.response?.data?.error || '操作失败');
    }
  };

  if (!user) return <div className="card p-8 text-center"><p className="text-gray-500">请先登录</p></div>;
  if (user.role !== 'landlord') return <div className="card p-8 text-center"><p className="text-gray-500">只有房东可以管理房源</p></div>;

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-800">我的房源</h1>
        <Link to="/publish" className="btn-primary flex items-center space-x-2 text-sm">
          <PlusCircleIcon className="w-4 h-4" /><span>发布</span>
        </Link>
      </div>
      {loading ? (
        <div className="flex justify-center py-12"><LoaderIcon className="w-8 h-8 animate-spin text-primary-600" /></div>
      ) : listings.length === 0 ? (
        <div className="card p-8 text-center">
          <HomeIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 mb-3">还没有发布房源</p>
          <Link to="/publish" className="btn-primary inline-block">发布房源</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {listings.map(item => (
            <div key={item.id} className="card p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <Link to={`/listing/${item.id}`} className="font-semibold text-gray-800 hover:text-primary-600">{item.title}</Link>
                  <p className="text-sm text-gray-500">{item.address?.slice(0, 30)}</p>
                  <p className="text-sm font-medium text-primary-600 mt-1">{item.rent_amount} ETH/月</p>
                </div>
                <div className="text-right space-y-2">
                  <span className={item.status === 'available' ? 'badge-green' : item.status === 'rented' ? 'badge-blue' : 'badge-gray'}>
                    {item.status === 'available' ? '可租' : item.status === 'rented' ? '已租' : '下架'}
                  </span>
                  {item.status !== 'rented' && (
                    <button onClick={() => toggleStatus(item.id, item.status === 'available' ? 'offline' : 'available')}
                      className="block text-xs text-primary-600 hover:underline">
                      {item.status === 'available' ? '下架' : '重新上架'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
