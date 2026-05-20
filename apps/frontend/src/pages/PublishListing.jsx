/**
 * 文件说明：PublishListing.jsx
 * - 房东发布房源页面。
 * - 提交后调用 /api/listings 创建房源，成功后跳转房源详情页。
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../app/providers/AuthContext';
import { apiPost } from '../shared/api/api';
import toast from 'react-hot-toast';
import { PlusCircleIcon, LoaderIcon, AlertCircleIcon } from 'lucide-react';

const MAX_IMAGE_COUNT = 12;

// 函数 1: 页面主组件。
export default function PublishListing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    title: '',
    description: '',
    address: '',
    district: '',
    rentAmount: '',
    minLeaseMonths: 1,
    bedrooms: 1,
    livingrooms: 1,
    bathrooms: 1,
    area: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [imageFiles, setImageFiles] = useState([]);
  const [imagePreviews, setImagePreviews] = useState([]);

  if (!user || user.role !== 'landlord') {
    return (
      <div className="card p-8 text-center">
        <AlertCircleIcon className="w-12 h-12 mx-auto text-yellow-400 mb-3" />
        <p className="text-gray-500">只有房东可以发布房源</p>
      </div>
    );
  }

  // 函数 2: 把文件读取为 dataUrl 供上传接口使用。
  const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });

  // 函数 3: 处理图片选择（可选，最多 12 张）。
  const handleImageChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length > MAX_IMAGE_COUNT) {
      toast.error(`最多选择 ${MAX_IMAGE_COUNT} 张图片`);
      return;
    }
    imagePreviews.forEach((url) => URL.revokeObjectURL(url));
    setImageFiles(files);
    setImagePreviews(files.map((item) => URL.createObjectURL(item)));
  };

  // 函数 4: 提交房源发布请求。
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title || !form.description || !form.address || !form.rentAmount) {
      toast.error('请填写必填项');
      return;
    }

    setSubmitting(true);
    try {
      let uploadedImageUrls = [];
      if (imageFiles.length > 0) {
        const images = [];
        for (const file of imageFiles) {
          const dataUrl = await readFileAsDataUrl(file);
          images.push({ dataUrl });
        }
        const uploadRes = await apiPost('/listings/upload-images', { images });
        uploadedImageUrls = Array.isArray(uploadRes?.data?.images)
          ? uploadRes.data.images.map((item) => item.url).filter(Boolean)
          : [];
      }

      const res = await apiPost('/listings', { ...form, imageUrls: uploadedImageUrls });
      toast.success(res.data?.message || '发布成功');
      navigate(`/listing/${res.data?.id}`);
    } catch (err) {
      toast.error(err.response?.data?.error || '发布失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 函数 5: 组件卸载时释放预览 URL，防止内存泄漏。
  React.useEffect(() => {
    return () => {
      imagePreviews.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [imagePreviews]);

  return (
    <div className="max-w-2xl mx-auto animate-fade-in">
      <h1 className="text-2xl font-bold text-gray-800 mb-2">发布房源</h1>
      <p className="text-gray-500 mb-6">请确保信息真实准确，便于租客快速决策。</p>
      <p className="text-sm text-amber-700 mb-4">当前版本说明：押金功能暂未启用，支付方式为一次性支付。</p>

      <form onSubmit={handleSubmit} className="card p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">标题 *</label>
          <input
            type="text"
            className="input-field"
            placeholder="例如：朝阳区精装两居"
            value={form.title}
            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">描述 *</label>
          <textarea
            className="input-field"
            rows={3}
            placeholder="填写房屋情况、交通、周边配套等"
            value={form.description}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            required
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">地址 *</label>
            <input
              type="text"
              className="input-field"
              placeholder="详细地址"
              value={form.address}
              onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">区域</label>
            <input
              type="text"
              className="input-field"
              placeholder="例如：朝阳区"
              value={form.district}
              onChange={(e) => setForm((p) => ({ ...p, district: e.target.value }))}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">月租金(ETH) *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="input-field"
              placeholder="0.1"
              value={form.rentAmount}
              onChange={(e) => setForm((p) => ({ ...p, rentAmount: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">面积(㎡)</label>
            <input
              type="number"
              className="input-field"
              placeholder="90"
              value={form.area}
              onChange={(e) => setForm((p) => ({ ...p, area: e.target.value }))}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">最少租期(月)</label>
            <select
              className="input-field"
              value={form.minLeaseMonths}
              onChange={(e) => setForm((p) => ({ ...p, minLeaseMonths: parseInt(e.target.value, 10) }))}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>{m}个月</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">卧室</label>
            <input
              type="number"
              min={1}
              className="input-field"
              value={form.bedrooms}
              onChange={(e) => setForm((p) => ({ ...p, bedrooms: parseInt(e.target.value, 10) }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">客厅</label>
            <input
              type="number"
              min={0}
              className="input-field"
              value={form.livingrooms}
              onChange={(e) => setForm((p) => ({ ...p, livingrooms: parseInt(e.target.value, 10) }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">卫生间</label>
            <input
              type="number"
              min={1}
              className="input-field"
              value={form.bathrooms}
              onChange={(e) => setForm((p) => ({ ...p, bathrooms: parseInt(e.target.value, 10) }))}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">房源图片（可选，最多12张）</label>
          <input
            type="file"
            className="input-field"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={handleImageChange}
          />
          {imagePreviews.length > 0 && (
            <div className="grid grid-cols-3 gap-3 mt-3">
              {imagePreviews.map((url, index) => (
                <img key={`${url}_${index}`} src={url} alt={`preview_${index}`} className="w-full h-24 object-cover rounded-lg border" />
              ))}
            </div>
          )}
        </div>

        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-700">
          <p className="font-medium mb-1">法律提示</p>
          <p>发布房源即表示您承诺该房源可合法出租，建议保留房产证明与委托证明等材料。</p>
        </div>

        <button type="submit" disabled={submitting} className="btn-primary w-full flex items-center justify-center space-x-2">
          {submitting ? <LoaderIcon className="w-5 h-5 animate-spin" /> : <PlusCircleIcon className="w-5 h-5" />}
          <span>{submitting ? '提交中...' : '发布房源'}</span>
        </button>
      </form>
    </div>
  );
}







