import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWeb3 } from '../context/Web3Context';
import { ethers } from 'ethers';
import toast from 'react-hot-toast';
import { PlusCircleIcon, LoaderIcon, AlertCircleIcon } from 'lucide-react';
import { CATEGORIES } from '../utils/contractConfig';

export default function SellProduct() {
  const { contract, account } = useWeb3();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    title: '',
    description: '',
    price: '',
    category: 'other',
    imageUrl: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});

  const validate = () => {
    const newErrors = {};
    if (!form.title.trim()) newErrors.title = '请输入商品标题';
    if (!form.description.trim()) newErrors.description = '请输入商品描述';
    if (!form.price || isNaN(form.price) || parseFloat(form.price) <= 0) {
      newErrors.price = '请输入有效价格';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    if (!contract || !account) {
      toast.error('请先连接钱包');
      return;
    }

    setSubmitting(true);
    try {
      const priceInWei = ethers.parseEther(form.price);
      const tx = await contract.listProduct(
        form.title.trim(),
        form.description.trim(),
        priceInWei,
        form.category,
        form.imageUrl.trim()
      );

      toast.loading('交易确认中...', { id: 'sell' });
      await tx.wait();

      toast.success('商品发布成功！', { id: 'sell' });
      navigate('/marketplace');
    } catch (err) {
      console.error('发布失败:', err);
      toast.error(err.reason || '发布失败，请重试', { id: 'sell' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  };

  return (
    <div className="max-w-2xl mx-auto animate-fade-in">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-800">发布商品</h1>
        <p className="text-gray-500 mt-1">填写商品信息，开始你的第一笔交易</p>
      </div>

      {!account ? (
        <div className="card p-12 text-center">
          <AlertCircleIcon className="w-16 h-16 mx-auto text-yellow-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-600 mb-2">请先连接钱包</h3>
          <p className="text-sm text-gray-400">需要连接以太坊钱包才能发布商品</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="card p-6 space-y-6">
          {/* 标题 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              商品标题 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => handleChange('title', e.target.value)}
              placeholder="例如：九成新高等数学教材"
              className={`input-field ${errors.title ? 'border-red-400 focus:ring-red-400' : ''}`}
              maxLength={100}
            />
            {errors.title && <p className="text-red-500 text-xs mt-1">{errors.title}</p>}
          </div>

          {/* 描述 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              商品描述 <span className="text-red-500">*</span>
            </label>
            <textarea
              value={form.description}
              onChange={(e) => handleChange('description', e.target.value)}
              placeholder="详细描述商品状况、使用时间、购买价格等信息..."
              rows={4}
              className={`input-field ${errors.description ? 'border-red-400 focus:ring-red-400' : ''}`}
              maxLength={500}
            />
            <p className="text-xs text-gray-400 mt-1 text-right">{form.description.length}/500</p>
            {errors.description && <p className="text-red-500 text-xs mt-1">{errors.description}</p>}
          </div>

          {/* 价格和分类 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                价格 (SepoliaETH) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                step="0.0001"
                min="0"
                value={form.price}
                onChange={(e) => handleChange('price', e.target.value)}
                placeholder="0.01"
                className={`input-field ${errors.price ? 'border-red-400 focus:ring-red-400' : ''}`}
              />
              {errors.price && <p className="text-red-500 text-xs mt-1">{errors.price}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">分类</label>
              <select
                value={form.category}
                onChange={(e) => handleChange('category', e.target.value)}
                className="input-field"
              >
                {CATEGORIES.filter(c => c.id !== 'all').map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.icon} {cat.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 图片链接 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              图片链接 <span className="text-gray-400 text-xs">(可选)</span>
            </label>
            <input
              type="url"
              value={form.imageUrl}
              onChange={(e) => handleChange('imageUrl', e.target.value)}
              placeholder="https://example.com/image.jpg"
              className="input-field"
            />
            <p className="text-xs text-gray-400 mt-1">建议使用公开可访问的图片 URL</p>
          </div>

          {/* 提示信息 */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start space-x-3">
              <AlertCircleIcon className="w-5 h-5 text-blue-500 mt-0.5" />
              <div className="text-sm text-blue-700">
                <p className="font-medium mb-1">发布须知</p>
                <ul className="list-disc list-inside space-y-1 text-blue-600">
                  <li>发布商品将产生一笔链上交易 Gas 费</li>
                  <li>请确保商品信息真实准确</li>
                  <li>平台对交易收取 1% 的手续费</li>
                  <li>禁止发布违禁品和违规内容</li>
                </ul>
              </div>
            </div>
          </div>

          {/* 提交按钮 */}
          <button
            type="submit"
            disabled={submitting}
            className="btn-primary w-full flex items-center justify-center space-x-2"
          >
            {submitting ? (
              <>
                <LoaderIcon className="w-5 h-5 animate-spin" />
                <span>发布中...</span>
              </>
            ) : (
              <>
                <PlusCircleIcon className="w-5 h-5" />
                <span>发布商品</span>
              </>
            )}
          </button>
        </form>
      )}
    </div>
  );
}
