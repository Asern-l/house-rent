import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useWeb3 } from '../context/Web3Context';
import { ethers } from 'ethers';
import toast from 'react-hot-toast';
import { ShoppingBagIcon, LoaderIcon, Trash2Icon, Edit3Icon, PlusCircleIcon } from 'lucide-react';
import { CATEGORIES } from '../utils/contractConfig';

export default function MyProducts() {
  const { contract, account } = useWeb3();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (contract && account) {
      loadProducts();
    } else {
      setLoading(false);
    }
  }, [contract, account]);

  const loadProducts = async () => {
    try {
      const myProducts = await contract.getProductsBySeller(account);
      const formatted = myProducts.map(p => ({
        id: Number(p.id),
        title: p.title,
        description: p.description,
        price: ethers.formatEther(p.price),
        category: p.category,
        imageUrl: p.imageUrl,
        isActive: p.isActive,
        createdAt: Number(p.createdAt),
      }));
      setProducts(formatted);
    } catch (err) {
      console.error('加载商品失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (productId) => {
    if (!window.confirm('确定要下架该商品吗？')) return;

    try {
      const tx = await contract.removeProduct(productId);
      toast.loading('处理中...', { id: `remove-${productId}` });
      await tx.wait();
      toast.success('商品已下架', { id: `remove-${productId}` });
      loadProducts();
    } catch (err) {
      toast.error(err.reason || '操作失败', { id: `remove-${productId}` });
    }
  };

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">我的商品</h1>
          <p className="text-gray-500 mt-1">管理你发布的商品</p>
        </div>
        <Link to="/sell" className="btn-primary flex items-center space-x-2">
          <PlusCircleIcon className="w-4 h-4" />
          <span>发布商品</span>
        </Link>
      </div>

      {!account ? (
        <div className="card p-12 text-center">
          <ShoppingBagIcon className="w-16 h-16 mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-600">请先连接钱包</h3>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-12">
          <LoaderIcon className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      ) : products.length === 0 ? (
        <div className="card p-12 text-center">
          <ShoppingBagIcon className="w-16 h-16 mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-600">还没有发布商品</h3>
          <p className="text-sm text-gray-400 mt-2">开始发布你的第一个商品吧！</p>
        </div>
      ) : (
        <div className="space-y-4">
          {products.map((product) => (
            <div key={product.id} className="card p-4">
              <div className="flex items-start space-x-4">
                <div className="w-20 h-20 bg-gradient-to-br from-primary-100 to-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  {product.imageUrl ? (
                    <img src={product.imageUrl} alt={product.title} className="w-full h-full object-cover rounded-lg" />
                  ) : (
                    <ShoppingBagIcon className="w-8 h-8 text-primary-300" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-gray-800 truncate">{product.title}</h3>
                      <p className="text-sm text-gray-500 mt-1 line-clamp-1">{product.description}</p>
                    </div>
                    <span className={`ml-2 ${product.isActive ? 'badge-green' : 'badge-gray'}`}>
                      {product.isActive ? '在售' : '已下架'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <div className="flex items-center space-x-2">
                      <p className="text-lg font-bold text-primary-600">{product.price} SepoliaETH</p>
                      <span className="text-xs text-gray-400">
                        {CATEGORIES.find(c => c.id === product.category)?.icon}
                      </span>
                    </div>
                    {product.isActive && (
                      <button
                        onClick={() => handleRemove(product.id)}
                        className="text-red-400 hover:text-red-600 p-1"
                        title="下架商品"
                      >
                        <Trash2Icon className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
