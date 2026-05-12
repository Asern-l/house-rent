import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useWeb3 } from '../context/Web3Context';
import { ethers } from 'ethers';
import toast from 'react-hot-toast';
import {
  UserCircleIcon, LoaderIcon, StarIcon, ShoppingBagIcon,
  WalletIcon, SettingsIcon, LogOutIcon, ClipboardListIcon,
  PackageIcon, ShieldCheckIcon
} from 'lucide-react';

export default function Profile() {
  const { contract, account, signer, connectWallet } = useWeb3();
  const navigate = useNavigate();
  const [userInfo, setUserInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [registerForm, setRegisterForm] = useState({ nickname: '', contactInfo: '' });
  const [registering, setRegistering] = useState(false);

  useEffect(() => {
    if (contract && account) {
      loadUserInfo();
    } else {
      setLoading(false);
    }
  }, [contract, account]);

  const loadUserInfo = async () => {
    try {
      const info = await contract.users(account);
      setUserInfo({
        isRegistered: info.isRegistered,
        nickname: info.nickname,
        contactInfo: info.contactInfo,
        totalSales: ethers.formatEther(info.totalSales),
        totalPurchases: ethers.formatEther(info.totalPurchases),
        ratingSum: Number(info.ratingSum),
        ratingCount: Number(info.ratingCount),
        isFrozen: info.isFrozen,
      });

      // 获取评分
      if (info.ratingCount > 0) {
        // 有评分数据
      }
    } catch (err) {
      console.error('加载用户信息失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!registerForm.nickname.trim()) {
      toast.error('请输入昵称');
      return;
    }

    setRegistering(true);
    try {
      const tx = await contract.registerUser(
        registerForm.nickname.trim(),
        registerForm.contactInfo.trim()
      );
      toast.loading('注册中...', { id: 'register' });
      await tx.wait();
      toast.success('注册成功！', { id: 'register' });
      setShowRegisterForm(false);
      loadUserInfo();
    } catch (err) {
      toast.error(err.reason || '注册失败', { id: 'register' });
    } finally {
      setRegistering(false);
    }
  };

  const formatAddress = (addr) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  if (!account) {
    return (
      <div className="max-w-md mx-auto text-center py-12 animate-fade-in">
        <div className="card p-12">
          <WalletIcon className="w-16 h-16 mx-auto text-primary-400 mb-4" />
          <h2 className="text-xl font-bold text-gray-800 mb-2">连接钱包</h2>
          <p className="text-gray-500 mb-6">连接你的以太坊钱包以查看个人资料</p>
          <button onClick={connectWallet} className="btn-primary">
            连接钱包
          </button>
        </div>
      </div>
    );
  }

  const avgRating = userInfo && userInfo.ratingCount > 0
    ? (userInfo.ratingSum / userInfo.ratingCount).toFixed(1)
    : '暂无';

  return (
    <div className="max-w-2xl mx-auto animate-fade-in">
      {/* 个人信息卡片 */}
      <div className="card p-6 mb-6">
        <div className="flex items-center space-x-4">
          <div className="w-16 h-16 bg-gradient-to-br from-primary-400 to-primary-600 rounded-full flex items-center justify-center text-white text-2xl font-bold">
            {userInfo?.isRegistered ? userInfo.nickname[0] : '?'}
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-gray-800">
              {userInfo?.isRegistered ? userInfo.nickname : '未注册用户'}
            </h2>
            <p className="text-sm text-gray-500 font-mono">{formatAddress(account)}</p>
            <div className="flex items-center space-x-1 mt-1">
              <StarIcon className="w-4 h-4 text-yellow-400 fill-yellow-400" />
              <span className="text-sm text-gray-600">{avgRating}</span>
              {userInfo?.ratingCount > 0 && (
                <span className="text-xs text-gray-400">({userInfo.ratingCount} 条评价)</span>
              )}
            </div>
          </div>
          {userInfo?.isRegistered && (
            <span className="badge-green">已认证</span>
          )}
        </div>
      </div>

      {/* 注册表单 */}
      {!userInfo?.isRegistered && !loading && (
        <div className="card p-6 mb-6">
          {!showRegisterForm ? (
            <div className="text-center">
              <UserCircleIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" />
              <h3 className="text-lg font-medium text-gray-700 mb-2">完善资料</h3>
              <p className="text-sm text-gray-500 mb-4">注册后即可发布和购买商品</p>
              <button
                onClick={() => setShowRegisterForm(true)}
                className="btn-primary"
              >
                立即注册
              </button>
            </div>
          ) : (
            <form onSubmit={handleRegister} className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-800">用户注册</h3>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">昵称</label>
                <input
                  type="text"
                  value={registerForm.nickname}
                  onChange={(e) => setRegisterForm(prev => ({ ...prev, nickname: e.target.value }))}
                  placeholder="请输入昵称"
                  className="input-field"
                  maxLength={30}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">联系方式</label>
                <input
                  type="text"
                  value={registerForm.contactInfo}
                  onChange={(e) => setRegisterForm(prev => ({ ...prev, contactInfo: e.target.value }))}
                  placeholder="微信 / 手机号 / QQ"
                  className="input-field"
                />
                <p className="text-xs text-gray-400 mt-1">买家将通过此信息联系您</p>
              </div>
              <button
                type="submit"
                disabled={registering}
                className="btn-primary w-full flex items-center justify-center space-x-2"
              >
                {registering && <LoaderIcon className="w-4 h-4 animate-spin" />}
                <span>{registering ? '注册中...' : '注册'}</span>
              </button>
            </form>
          )}
        </div>
      )}

      {/* 统计数据 */}
      {userInfo?.isRegistered && (
        <>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold text-primary-600">{userInfo.totalSales} SepoliaETH</p>
              <p className="text-sm text-gray-500">累计销售额</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold text-green-600">{userInfo.totalPurchases} SepoliaETH</p>
              <p className="text-sm text-gray-500">累计消费额</p>
            </div>
          </div>

          {/* 快捷操作 */}
          <div className="card p-4 mb-6">
            <h3 className="font-semibold text-gray-700 mb-3">快捷操作</h3>
            <div className="grid grid-cols-2 gap-3">
              <Link
                to="/my-products"
                className="flex items-center space-x-3 p-3 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <PackageIcon className="w-5 h-5 text-primary-500" />
                <span className="text-sm text-gray-700">我的商品</span>
              </Link>
              <Link
                to="/orders"
                className="flex items-center space-x-3 p-3 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <ClipboardListIcon className="w-5 h-5 text-green-500" />
                <span className="text-sm text-gray-700">我的订单</span>
              </Link>
              <Link
                to="/sell"
                className="flex items-center space-x-3 p-3 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <ShoppingBagIcon className="w-5 h-5 text-orange-500" />
                <span className="text-sm text-gray-700">发布商品</span>
              </Link>
              <Link
                to="/marketplace"
                className="flex items-center space-x-3 p-3 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <ShieldCheckIcon className="w-5 h-5 text-purple-500" />
                <span className="text-sm text-gray-700">浏览市场</span>
              </Link>
            </div>
          </div>

          {/* 联系信息 */}
          <div className="card p-4">
            <h3 className="font-semibold text-gray-700 mb-2">联系方式</h3>
            <p className="text-sm text-gray-600">{userInfo.contactInfo || '未设置'}</p>
          </div>
        </>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <LoaderIcon className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      )}
    </div>
  );
}
