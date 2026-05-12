import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiGet } from '../utils/api';
import { FileTextIcon, LoaderIcon, HomeIcon, PlusCircleIcon, SearchIcon, ShieldCheckIcon } from 'lucide-react';

export default function MyContracts() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      apiGet('/contracts').then(d => setContracts(d.data || [])).catch(() => {}).finally(() => setLoading(false));
    } else { setLoading(false); }
  }, [user]);

  const STATUS_MAP = {
    pending: { label: '待签署', color: 'badge-yellow' },
    tenant_signed: { label: '租客已签', color: 'badge-blue' },
    active: { label: '已生效', color: 'badge-green' },
    ended: { label: '已到期', color: 'badge-gray' },
    cancelled: { label: '已取消', color: 'badge-red' },
    expired: { label: '已过期', color: 'badge-gray' },
  };

  if (!user) return <div className="card p-8 text-center"><FileTextIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" /><p className="text-gray-500">请先登录</p><Link to="/login" className="btn-primary mt-3 inline-block">登录</Link></div>;

  return (
    <div className="animate-fade-in">
      <h1 className="text-2xl font-bold text-gray-800 mb-4">我的合同</h1>
      {loading ? (
        <div className="flex justify-center py-12"><LoaderIcon className="w-8 h-8 animate-spin text-primary-600" /></div>
      ) : contracts.length === 0 ? (
        <div className="card p-8 text-center">
          <FileTextIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 mb-3">暂无合同</p>
          {user.role === 'tenant' ? (
            <Link to="/listings" className="btn-primary inline-flex items-center space-x-2">
              <SearchIcon className="w-4 h-4" /><span>浏览房源</span>
            </Link>
          ) : (
            <p className="text-sm text-gray-400">等待租客申请租房</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {contracts.map(c => {
            const st = STATUS_MAP[c.status] || { label: c.status, color: 'badge-gray' };
            return (
              <Link key={c.id} to={`/contract/${c.id}`} className="card p-4 block hover:translate-y-[-2px] transition-all">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-800">{c.listing_title || '房源'}</h3>
                    <p className="text-sm text-gray-500 mt-1">{c.listing_address?.slice(0, 30)}</p>
                    <p className="text-xs text-gray-400 mt-1">ID: {c.id.slice(0, 20)}...</p>
                  </div>
                  <div className="text-right">
                    <span className={st.color}>{st.label}</span>
                    <p className="text-xs text-gray-400 mt-1">{c.created_at?.slice(0, 10)}</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
