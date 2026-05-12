import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiPost } from '../utils/api';
import toast from 'react-hot-toast';
import { PlusCircleIcon, LoaderIcon, AlertCircleIcon } from 'lucide-react';

export default function PublishListing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    title: '', description: '', address: '', district: '',
    rentAmount: '', depositMonths: 2,
    bedrooms: 1, livingrooms: 1, bathrooms: 1, area: '',
  });
  const [submitting, setSubmitting] = useState(false);

  if (!user || user.role !== 'landlord') {
    return <div className="card p-8 text-center"><AlertCircleIcon className="w-12 h-12 mx-auto text-yellow-400 mb-3" /><p className="text-gray-500">只有房东可以发布房源</p></div>;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title || !form.description || !form.address || !form.rentAmount) {
      toast.error('请填写必填项'); return;
    }
    setSubmitting(true);
    try {
      const res = await apiPost('/listings', { ...form, rentAmount: form.rentAmount, imageUrls: [] });
      toast.success(res.data.message || '发布成功！');
      navigate(`/listing/${res.data.id}`);
    } catch (err) {
      toast.error(err.response?.data?.error || '发布失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto animate-fade-in">
      <h1 className="text-2xl font-bold text-gray-800 mb-2">发布房源</h1>
      <p className="text-gray-500 mb-6">请确保房源信息真实准确，AI系统将对图片进行可信度检测</p>

      <form onSubmit={handleSubmit} className="card p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">标题 *</label>
          <input type="text" className="input-field" placeholder="例如：朝阳区精装两居室"
            value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">描述 *</label>
          <textarea className="input-field" rows={3} placeholder="房屋状况、周边环境、交通等"
            value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} required />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">地址 *</label>
            <input type="text" className="input-field" placeholder="详细地址"
              value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">区域</label>
            <input type="text" className="input-field" placeholder="如：朝阳区"
              value={form.district} onChange={e => setForm(p => ({ ...p, district: e.target.value }))} />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">月租金 (ETH) *</label>
            <input type="number" step="0.01" min="0" className="input-field" placeholder="0.1"
              value={form.rentAmount} onChange={e => setForm(p => ({ ...p, rentAmount: e.target.value }))} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">押金 (月数)</label>
            <select className="input-field" value={form.depositMonths}
              onChange={e => setForm(p => ({ ...p, depositMonths: parseInt(e.target.value) }))}>
              <option value={1}>1个月</option><option value={2}>2个月</option><option value={3}>3个月</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">面积 (㎡)</label>
            <input type="number" className="input-field" placeholder="90"
              value={form.area} onChange={e => setForm(p => ({ ...p, area: e.target.value }))} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">室</label>
            <input type="number" min={1} className="input-field" value={form.bedrooms}
              onChange={e => setForm(p => ({ ...p, bedrooms: parseInt(e.target.value) }))} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">厅</label>
            <input type="number" min={0} className="input-field" value={form.livingrooms}
              onChange={e => setForm(p => ({ ...p, livingrooms: parseInt(e.target.value) }))} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">卫</label>
            <input type="number" min={1} className="input-field" value={form.bathrooms}
              onChange={e => setForm(p => ({ ...p, bathrooms: parseInt(e.target.value) }))} /></div>
        </div>

        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-700">
          <p className="font-medium mb-1">⚠️ 法律须知</p>
          <p>发布房源即表示您保证该房屋为合法可出租房源。根据《商品房屋租赁管理办法》，不符合规定的房屋不得出租。</p>
        </div>

        <button type="submit" disabled={submitting} className="btn-primary w-full flex items-center justify-center space-x-2">
          {submitting ? <LoaderIcon className="w-5 h-5 animate-spin" /> : <PlusCircleIcon className="w-5 h-5" />}
          <span>{submitting ? 'AI检测中...' : '发布房源（AI检测将自动进行）'}</span>
        </button>
      </form>
    </div>
  );
}
