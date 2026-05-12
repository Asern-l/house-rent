import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useWeb3 } from '../context/Web3Context';
import { ethers } from 'ethers';
import { ShoppingBagIcon, ShieldCheckIcon, CircleDollarSignIcon, GraduationCapIcon, ArrowRightIcon, StarIcon } from 'lucide-react';
import { CATEGORIES } from '../utils/contractConfig';

const FEATURES = [
  {
    icon: ShieldCheckIcon,
    title: '托管交易',
    desc: '资金由智能合约托管，确认收货后才放款',
    color: 'text-green-500',
    bg: 'bg-green-50',
  },
  {
    icon: CircleDollarSignIcon,
    title: '低手续费',
    desc: '平台仅收取 1% 手续费，远低于传统平台',
    color: 'text-blue-500',
    bg: 'bg-blue-50',
  },
  {
    icon: GraduationCapIcon,
    title: '校园专属',
    desc: '面向在校师生，打造纯净校园交易环境',
    color: 'text-purple-500',
    bg: 'bg-purple-50',
  },
  {
    icon: ShoppingBagIcon,
    title: '品类丰富',
    desc: '教材、数码、日用等多品类二手商品',
    color: 'text-orange-500',
    bg: 'bg-orange-50',
  },
];

export default function HomePage() {
  const { contract } = useWeb3();
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProducts();
  }, [contract]);

  const loadProducts = async () => {
    if (!contract) {
      setLoading(false);
      return;
    }
    try {
      const allProducts = await contract.getAllProducts();
      const formatted = allProducts.map(p => ({
        id: Number(p.id),
        seller: p.seller,
        title: p.title,
        description: p.description,
        price: ethers.formatEther(p.price),
        category: p.category,
        imageUrl: p.imageUrl,
        isActive: p.isActive,
        createdAt: Number(p.createdAt),
      }));
      setProducts(formatted.slice(0, 8));
    } catch (err) {
      console.error('加载商品失败:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-12 animate-fade-in">
      {/* Hero 区域 */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary-600 via-primary-700 to-indigo-800 text-white">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-white rounded-full" />
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-white rounded-full" />
        </div>
        <div className="relative px-8 py-16 md:py-24">
          <div className="max-w-3xl">
            <h1 className="text-4xl md:text-5xl font-bold mb-4 leading-tight">
              校园二手交易平台
            </h1>
            <p className="text-lg md:text-xl text-primary-100 mb-8">
              基于区块链技术的安全 C2C 交易平台，让校园闲置物品流转更安心
            </p>
            <div className="flex flex-wrap gap-4">
              <Link
                to="/marketplace"
                className="inline-flex items-center space-x-2 bg-white text-primary-700 px-6 py-3 rounded-xl font-semibold hover:bg-primary-50 transition-colors shadow-lg"
              >
                <span>逛逛市场</span>
                <ArrowRightIcon className="w-4 h-4" />
              </Link>
              <Link
                to="/sell"
                className="inline-flex items-center space-x-2 bg-white/20 text-white border-2 border-white/40 px-6 py-3 rounded-xl font-semibold hover:bg-white/30 transition-colors"
              >
                <span>发布商品</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 分类导航 */}
      <section>
        <h2 className="text-2xl font-bold text-gray-800 mb-6">分类浏览</h2>
        <div className="grid grid-cols-4 md:grid-cols-8 gap-3">
          {CATEGORIES.filter(c => c.id !== 'all').map((cat) => (
            <Link
              key={cat.id}
              to={`/marketplace?category=${cat.id}`}
              className="card flex flex-col items-center justify-center p-4 hover:bg-primary-50 hover:border-primary-200 border-2 border-transparent transition-all duration-200"
            >
              <span className="text-2xl mb-1">{cat.icon}</span>
              <span className="text-xs text-gray-600 font-medium">{cat.label}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* 特色功能 */}
      <section>
        <h2 className="text-2xl font-bold text-gray-800 mb-6">平台优势</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {FEATURES.map((feature, index) => (
            <div key={index} className="card p-6 hover:translate-y-[-2px] transition-transform">
              <div className={`inline-flex p-3 rounded-xl ${feature.bg} mb-4`}>
                <feature.icon className={`w-6 h-6 ${feature.color}`} />
              </div>
              <h3 className="text-lg font-semibold text-gray-800 mb-2">{feature.title}</h3>
              <p className="text-sm text-gray-500">{feature.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 最新商品 */}
      <section>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-800">最新商品</h2>
          <Link
            to="/marketplace"
            className="text-primary-600 hover:text-primary-700 text-sm font-medium flex items-center space-x-1"
          >
            <span>查看全部</span>
            <ArrowRightIcon className="w-4 h-4" />
          </Link>
        </div>

        {!contract ? (
          <div className="card p-12 text-center">
            <ShoppingBagIcon className="w-16 h-16 mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-600 mb-2">请先连接钱包</h3>
            <p className="text-sm text-gray-400 mb-4">连接以太坊钱包以浏览商品</p>
          </div>
        ) : loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="card animate-pulse">
                <div className="h-48 bg-gray-200" />
                <div className="p-4 space-y-3">
                  <div className="h-4 bg-gray-200 rounded w-3/4" />
                  <div className="h-3 bg-gray-200 rounded w-1/2" />
                  <div className="h-5 bg-gray-200 rounded w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="card p-12 text-center">
            <ShoppingBagIcon className="w-16 h-16 mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-600 mb-2">暂无商品</h3>
            <p className="text-sm text-gray-400 mb-4">还没有人发布商品，快来第一个发布吧！</p>
            <Link to="/sell" className="btn-primary inline-flex items-center space-x-2">
              <span>发布商品</span>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {products.map((product) => (
              <Link
                key={product.id}
                to={`/product/${product.id}`}
                className="card group hover:translate-y-[-4px] transition-all duration-300"
              >
                <div className="relative h-48 bg-gradient-to-br from-primary-100 to-blue-100 flex items-center justify-center">
                  {product.imageUrl ? (
                    <img src={product.imageUrl} alt={product.title} className="w-full h-full object-cover" />
                  ) : (
                    <ShoppingBagIcon className="w-16 h-16 text-primary-300" />
                  )}
                  <span className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm text-xs font-medium px-2 py-1 rounded-full text-primary-600">
                    {CATEGORIES.find(c => c.id === product.category)?.icon || '📦'} {CATEGORIES.find(c => c.id === product.category)?.label || product.category}
                  </span>
                </div>
                <div className="p-4">
                  <h3 className="font-semibold text-gray-800 group-hover:text-primary-600 truncate transition-colors">
                    {product.title}
                  </h3>
                  <p className="text-sm text-gray-500 mt-1 line-clamp-2">{product.description}</p>
                  <p className="text-lg font-bold text-primary-600 mt-2">
                    {product.price} SepoliaETH
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* 交易流程 */}
      <section className="bg-white rounded-2xl p-8 shadow-sm">
        <h2 className="text-2xl font-bold text-gray-800 text-center mb-8">交易流程</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {[
            { step: '1', title: '连接钱包', desc: '使用 MetaMask 连接，开始交易之旅' },
            { step: '2', title: '浏览商品', desc: '浏览校园内的二手商品信息' },
            { step: '3', title: '下单支付', desc: '资金锁定在智能合约中，安全托管' },
            { step: '4', title: '确认收货', desc: '确认后自动放款给卖家，交易完成' },
          ].map((item, i) => (
            <div key={i} className="text-center">
              <div className="w-12 h-12 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center text-xl font-bold mx-auto mb-3">
                {item.step}
              </div>
              <h3 className="font-semibold text-gray-800 mb-1">{item.title}</h3>
              <p className="text-sm text-gray-500">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
