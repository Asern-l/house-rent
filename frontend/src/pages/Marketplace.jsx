import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useWeb3 } from '../context/Web3Context';
import { ethers } from 'ethers';
import { SearchIcon, ShoppingBagIcon, FilterIcon, XIcon } from 'lucide-react';
import { CATEGORIES } from '../utils/contractConfig';

export default function Marketplace() {
  const { contract } = useWeb3();
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState([]);
  const [filteredProducts, setFilteredProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(searchParams.get('category') || 'all');
  const [sortBy, setSortBy] = useState('newest');

  useEffect(() => {
    loadProducts();
  }, [contract]);

  useEffect(() => {
    filterAndSortProducts();
  }, [products, searchTerm, selectedCategory, sortBy]);

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
      setProducts(formatted);
    } catch (err) {
      console.error('加载商品失败:', err);
    } finally {
      setLoading(false);
    }
  };

  const filterAndSortProducts = () => {
    let result = [...products];

    // 分类过滤
    if (selectedCategory !== 'all') {
      result = result.filter(p => p.category === selectedCategory);
    }

    // 搜索
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        p => p.title.toLowerCase().includes(term) || p.description.toLowerCase().includes(term)
      );
    }

    // 排序
    switch (sortBy) {
      case 'newest':
        result.sort((a, b) => b.createdAt - a.createdAt);
        break;
      case 'oldest':
        result.sort((a, b) => a.createdAt - b.createdAt);
        break;
      case 'price-low':
        result.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
        break;
      case 'price-high':
        result.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
        break;
    }

    setFilteredProducts(result);
  };

  const handleCategoryChange = (categoryId) => {
    setSelectedCategory(categoryId);
    if (categoryId === 'all') {
      searchParams.delete('category');
    } else {
      searchParams.set('category', categoryId);
    }
    setSearchParams(searchParams);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* 页面标题 */}
      <div>
        <h1 className="text-3xl font-bold text-gray-800">二手市场</h1>
        <p className="text-gray-500 mt-1">发现校园里的好物</p>
      </div>

      {/* 搜索和过滤 */}
      <div className="bg-white rounded-xl p-4 shadow-sm space-y-4">
        {/* 搜索栏 */}
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="搜索商品名称或描述..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input-field pl-10"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <XIcon className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* 分类和排序 */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => handleCategoryChange(cat.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  selectedCategory === cat.id
                    ? 'bg-primary-100 text-primary-700 ring-1 ring-primary-300'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {cat.icon} {cat.label}
              </button>
            ))}
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="input-field w-auto text-sm"
          >
            <option value="newest">最新发布</option>
            <option value="oldest">最早发布</option>
            <option value="price-low">价格从低到高</option>
            <option value="price-high">价格从高到低</option>
          </select>
        </div>
      </div>

      {/* 商品列表 */}
      {!contract ? (
        <div className="card p-12 text-center">
          <ShoppingBagIcon className="w-16 h-16 mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-600 mb-2">请先连接钱包</h3>
          <p className="text-sm text-gray-400">连接以太坊钱包以浏览和购买商品</p>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {[...Array(8)].map((_, i) => (
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
      ) : filteredProducts.length === 0 ? (
        <div className="card p-12 text-center">
          <SearchIcon className="w-16 h-16 mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-600 mb-2">未找到商品</h3>
          <p className="text-sm text-gray-400 mb-4">尝试修改搜索条件或换个分类看看</p>
          <button
            onClick={() => { setSearchTerm(''); setSelectedCategory('all'); }}
            className="btn-secondary"
          >
            清除筛选
          </button>
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-500">共找到 {filteredProducts.length} 件商品</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredProducts.map((product) => (
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
                    {CATEGORIES.find(c => c.id === product.category)?.icon || '📦'}
                  </span>
                </div>
                <div className="p-4">
                  <h3 className="font-semibold text-gray-800 group-hover:text-primary-600 truncate">
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
        </>
      )}
    </div>
  );
}
