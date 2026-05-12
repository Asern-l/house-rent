import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiGet } from '../utils/api';
import { HomeIcon, SearchIcon, MapPinIcon, PlusCircleIcon, FileTextIcon, ShieldCheckIcon, ArrowRightIcon, LoaderIcon } from 'lucide-react';

export default function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet('/listings?status=available').then(d => { setListings(d.data || []); }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-8 animate-fade-in">
      <section className="rounded-2xl bg-gradient-to-br from-primary-600 to-indigo-800 text-white p-8 md:p-12">
        <h1 className="text-3xl md:text-4xl font-bold mb-3">信源链 · 区块链租房</h1>
        <p className="text-primary-100 text-lg mb-6">房源信息与电子合同全程上链存证，安全透明不可篡改</p>
        <div className="flex flex-wrap gap-3">
          <Link to="/listings" className="bg-white text-primary-700 px-6 py-2.5 rounded-xl font-semibold hover:bg-primary-50 transition-colors shadow-lg">
            浏览房源
          </Link>
          {user?.role === 'landlord' && (
            <Link to="/publish" className="bg-white/20 text-white border-2 border-white/40 px-6 py-2.5 rounded-xl font-semibold hover:bg-white/30 transition-colors">
              发布房源
            </Link>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-bold text-gray-800 mb-4">平台优势</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { icon: ShieldCheckIcon, title: '房源信息上链', desc: '图片哈希和AI评分存证，真实可信' },
            { icon: FileTextIcon, title: '电子合同存证', desc: '遵循《电子签名法》，合同哈希上链不可篡改' },
            { icon: HomeIcon, title: '押金托管', desc: '押金由智能合约托管，退房双方确认后自动结算' },
          ].map((f, i) => (
            <div key={i} className="card p-5">
              <div className="bg-primary-50 w-12 h-12 rounded-xl flex items-center justify-center mb-3">
                <f.icon className="w-6 h-6 text-primary-600" />
              </div>
              <h3 className="font-semibold text-gray-800">{f.title}</h3>
              <p className="text-sm text-gray-500 mt-1">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-800">最新房源</h2>
          <Link to="/listings" className="text-primary-600 text-sm font-medium flex items-center space-x-1">
            <span>查看全部</span><ArrowRightIcon className="w-4 h-4" />
          </Link>
        </div>
        {!user ? (
          <div className="card p-8 text-center">
            <HomeIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500 mb-3">请先登录</p>
            <Link to="/login" className="btn-primary">登录/注册</Link>
          </div>
        ) : loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1,2,3].map(i => <div key={i} className="card h-48 animate-pulse bg-gray-100" />)}
          </div>
        ) : listings.length === 0 ? (
          <div className="card p-8 text-center">
            <SearchIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500">暂无房源</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {listings.slice(0, 6).map(item => (
              <Link key={item.id} to={`/listing/${item.id}`} className="card p-4 hover:translate-y-[-2px] transition-all">
                <div className="h-36 bg-gradient-to-br from-primary-100 to-blue-100 rounded-lg mb-3 flex items-center justify-center">
                  <HomeIcon className="w-10 h-10 text-primary-300" />
                </div>
                <h3 className="font-semibold text-gray-800 truncate">{item.title}</h3>
                <p className="text-sm text-gray-500 flex items-center space-x-1 mt-1">
                  <MapPinIcon className="w-3 h-3" /><span>{item.district || item.address?.slice(0, 20)}</span>
                </p>
                <div className="flex items-center justify-between mt-2">
                  <p className="text-lg font-bold text-primary-600">{item.rent_amount} <span className="text-sm font-normal">ETH/月</span></p>
                  <span className="badge-green">AI可信度 {item.ai_score}分</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
