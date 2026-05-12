import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { UserIcon, WalletIcon, LogOutIcon, FileTextIcon, HomeIcon, ShieldCheckIcon, KeyIcon } from 'lucide-react';

export default function ProfilePage() {
  const { user, logout, connectWallet } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    toast.success('已退出登录');
    navigate('/login');
  };

  if (!user) {
    return <div className="card p-8 text-center"><UserIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" /><p className="text-gray-500">请先登录</p><Link to="/login" className="btn-primary mt-3 inline-block">登录</Link></div>;
  }

  return (
    <div className="max-w-2xl mx-auto animate-fade-in">
      <div className="card p-6 mb-4">
        <div className="flex items-center space-x-4">
          <div className="w-16 h-16 bg-primary-500 rounded-full flex items-center justify-center text-white text-2xl font-bold">
            {user.nickname?.[0] || user.phone?.slice(-4)}
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-800">{user.nickname || '用户' + user.phone?.slice(-4)}</h2>
            <p className="text-sm text-gray-500">{user.phone}</p>
            <span className={user.role === 'landlord' ? 'badge-blue' : 'badge-green'}>
              {user.role === 'landlord' ? '房东' : '租客'}
            </span>
          </div>
        </div>
      </div>

      <div className="card p-4 mb-4">
        <h3 className="font-semibold text-gray-700 mb-3">钱包</h3>
        {user.walletAddress ? (
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">已绑定钱包地址</p>
            <p className="font-mono text-sm text-gray-700 break-all">{user.walletAddress}</p>
          </div>
        ) : (
          <button onClick={connectWallet} className="btn-secondary w-full flex items-center justify-center space-x-2">
            <WalletIcon className="w-4 h-4" /><span>连接 MetaMask 钱包</span>
          </button>
        )}
      </div>

      <div className="card p-4 mb-4">
        <h3 className="font-semibold text-gray-700 mb-3">快捷操作</h3>
        <div className="grid grid-cols-2 gap-2">
          {user.role === 'landlord' && (
            <>
              <Link to="/my-listings" className="flex items-center space-x-3 p-3 rounded-lg hover:bg-gray-50">
                <HomeIcon className="w-5 h-5 text-primary-500" /><span className="text-sm">我的房源</span>
              </Link>
              <Link to="/publish" className="flex items-center space-x-3 p-3 rounded-lg hover:bg-gray-50">
                <HomeIcon className="w-5 h-5 text-green-500" /><span className="text-sm">发布房源</span>
              </Link>
            </>
          )}
          <Link to="/contracts" className="flex items-center space-x-3 p-3 rounded-lg hover:bg-gray-50">
            <FileTextIcon className="w-5 h-5 text-orange-500" /><span className="text-sm">我的合同</span>
          </Link>
          <Link to="/listings" className="flex items-center space-x-3 p-3 rounded-lg hover:bg-gray-50">
            <HomeIcon className="w-5 h-5 text-purple-500" /><span className="text-sm">浏览房源</span>
          </Link>
          <Link to="/verify" className="flex items-center space-x-3 p-3 rounded-lg hover:bg-gray-50">
            <ShieldCheckIcon className="w-5 h-5 text-blue-500" /><span className="text-sm">链上验证</span>
          </Link>
        </div>
      </div>

      <button onClick={handleLogout} className="btn-danger w-full flex items-center justify-center space-x-2">
        <LogOutIcon className="w-4 h-4" /><span>退出登录</span>
      </button>
    </div>
  );
}
