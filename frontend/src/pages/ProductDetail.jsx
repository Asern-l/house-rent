import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWeb3 } from '../context/Web3Context';
import { ethers } from 'ethers';
import toast from 'react-hot-toast';
import {
  ShoppingBagIcon, ArrowLeftIcon, LoaderIcon, AlertCircleIcon,
  CheckCircleIcon, Share2Icon, StarIcon, UserIcon, ClockIcon
} from 'lucide-react';
import { CATEGORIES } from '../utils/contractConfig';

export default function ProductDetail() {
  const { id } = useParams();
  const { contract, account } = useWeb3();
  const navigate = useNavigate();

  const [product, setProduct] = useState(null);
  const [sellerInfo, setSellerInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(false);

  useEffect(() => {
    loadProduct();
  }, [contract, id]);

  const loadProduct = async () => {
    if (!contract) {
      setLoading(false);
      return;
    }
    try {
      const p = await contract.products(id);
      if (!p || Number(p.id) === 0) {
        toast.error('商品不存在');
        navigate('/marketplace');
        return;
      }

      const productData = {
        id: Number(p.id),
        seller: p.seller,
        title: p.title,
        description: p.description,
        price: ethers.formatEther(p.price),
        category: p.category,
        imageUrl: p.imageUrl,
        isActive: p.isActive,
        createdAt: Number(p.createdAt),
      };
      setProduct(productData);

      // 获取卖家信息
      try {
        const seller = await contract.users(p.seller);
        setSellerInfo({
          nickname: seller.nickname,
          contactInfo: seller.contactInfo,
          isRegistered: seller.isRegistered,
        });
      } catch (err) {
        console.error('获取卖家信息失败:', err);
      }
    } catch (err) {
      console.error('加载商品失败:', err);
      toast.error('加载商品失败');
    } finally {
      setLoading(false);
    }
  };

  const handleBuy = async () => {
    if (!contract || !account) {
      toast.error('请先连接钱包');
      return;
    }

    if (product.seller.toLowerCase() === account.toLowerCase()) {
      toast.error('不能购买自己的商品');
      return;
    }

    setBuying(true);
    try {
      const priceWei = ethers.parseEther(product.price);
      const tx = await contract.createOrder(product.id, { value: priceWei });

      toast.loading('交易处理中...', { id: 'buy' });
      const receipt = await tx.wait();

      toast.success('购买成功！请在订单页面查看', { id: 'buy' });
      navigate('/orders');
    } catch (err) {
      console.error('购买失败:', err);
      if (err.code === 'ACTION_REJECTED') {
        toast.error('用户取消了交易', { id: 'buy' });
      } else {
        toast.error(err.reason || '购买失败，请重试', { id: 'buy' });
      }
    } finally {
      setBuying(false);
    }
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp * 1000).toLocaleDateString('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoaderIcon className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="card p-12 text-center">
        <AlertCircleIcon className="w-16 h-16 mx-auto text-gray-300 mb-4" />
        <h3 className="text-lg font-medium text-gray-600">商品不存在</h3>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto animate-fade-in">
      {/* 返回按钮 */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center space-x-1 text-gray-500 hover:text-gray-700 mb-6"
      >
        <ArrowLeftIcon className="w-4 h-4" />
        <span>返回</span>
      </button>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* 商品图片 */}
        <div className="card">
          <div className="h-80 md:h-96 bg-gradient-to-br from-primary-100 to-blue-100 flex items-center justify-center">
            {product.imageUrl ? (
              <img src={product.imageUrl} alt={product.title} className="w-full h-full object-cover" />
            ) : (
              <ShoppingBagIcon className="w-24 h-24 text-primary-300" />
            )}
          </div>
        </div>

        {/* 商品信息 */}
        <div className="space-y-6">
          <div>
            <span className="inline-block px-3 py-1 bg-primary-100 text-primary-700 rounded-full text-sm font-medium mb-3">
              {CATEGORIES.find(c => c.id === product.category)?.icon} {CATEGORIES.find(c => c.id === product.category)?.label || product.category}
            </span>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-800">{product.title}</h1>
            <p className="text-3xl font-bold text-primary-600 mt-3">{product.price} SepoliaETH</p>
          </div>

          <div className="border-t border-gray-100 pt-6">
            <h3 className="font-medium text-gray-700 mb-2">商品描述</h3>
            <p className="text-gray-600 leading-relaxed">{product.description}</p>
          </div>

          <div className="border-t border-gray-100 pt-6">
            <div className="flex items-center space-x-3 text-sm text-gray-500">
              <UserIcon className="w-4 h-4" />
              <span>卖家：{sellerInfo?.nickname || product.seller.slice(0, 6) + '...' + product.seller.slice(-4)}</span>
            </div>
            <div className="flex items-center space-x-3 text-sm text-gray-500 mt-2">
              <ClockIcon className="w-4 h-4" />
              <span>发布于 {formatDate(product.createdAt)}</span>
            </div>
          </div>

          {/* 卖家信息 */}
          {sellerInfo?.contactInfo && (
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-500">联系方式</p>
              <p className="text-gray-700 font-medium">{sellerInfo.contactInfo}</p>
            </div>
          )}

          {/* 购买按钮 */}
          {product.isActive ? (
            <button
              onClick={handleBuy}
              disabled={buying || !account || product.seller.toLowerCase() === account?.toLowerCase()}
              className="btn-primary w-full flex items-center justify-center space-x-2 py-3 text-lg"
            >
              {buying ? (
                <>
                  <LoaderIcon className="w-5 h-5 animate-spin" />
                  <span>处理中...</span>
                </>
              ) : product.seller.toLowerCase() === account?.toLowerCase() ? (
                <span>这是您的商品</span>
              ) : (
                <>
                  <ShoppingBagIcon className="w-5 h-5" />
                  <span>立即购买</span>
                </>
              )}
            </button>
          ) : (
            <div className="bg-gray-100 rounded-lg p-4 text-center">
              <p className="text-gray-500 font-medium">该商品已下架或已售出</p>
            </div>
          )}

          {!account && (
            <p className="text-sm text-yellow-600 bg-yellow-50 rounded-lg p-3">
              请先连接钱包以购买商品
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
