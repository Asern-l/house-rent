import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../app/providers/AuthContext';
import { apiPost } from '../shared/api/api';
import toast from 'react-hot-toast';
import { AlertCircleIcon, HomeIcon, LoaderIcon, PlusCircleIcon, XIcon } from 'lucide-react';

const MAX_IMAGE_COUNT = 12;

export default function PublishListing({ onClose }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    title: '', description: '', address: '', district: '',
    rentAmount: '', minLeaseMonths: 1,
    bedrooms: 1, livingrooms: 1, bathrooms: 1, area: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [imageFiles, setImageFiles] = useState([]);
  const [imagePreviews, setImagePreviews] = useState([]);

  const close = () => onClose?.();

  const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });

  const handleImageChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (imageFiles.length + files.length > MAX_IMAGE_COUNT) {
      toast.error(`最多选择 ${MAX_IMAGE_COUNT} 张图片`);
      e.target.value = '';
      return;
    }
    setImageFiles((prev) => [...prev, ...files]);
    setImagePreviews((prev) => [...prev, ...files.map((item) => URL.createObjectURL(item))]);
    e.target.value = '';
  };

  const removeImage = (index) => {
    setImageFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
    setImagePreviews((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target);
      return prev.filter((_, itemIndex) => itemIndex !== index);
    });
  };

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
      close();
      navigate(`/listing/${res.data?.id}`);
    } catch (err) {
      toast.error(err.response?.data?.error || '发布失败');
    } finally {
      setSubmitting(false);
    }
  };

  React.useEffect(() => {
    return () => { imagePreviews.forEach((url) => URL.revokeObjectURL(url)); };
  }, [imagePreviews]);

  if (!user || user.role !== 'landlord') {
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-stone-950/55 px-4 py-6 backdrop-blur-sm">
        <div className="relative w-full max-w-[385px] rounded-[1.5rem] border border-primary-600/20 bg-[#f5f0e8] p-8 text-center shadow-[0_22px_55px_rgba(27,23,18,0.28)]">
          <CloseButton onClose={close} />
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#fbf7ef] text-stone-950 shadow-[0_12px_30px_rgba(36,31,26,0.18)]">
            <AlertCircleIcon className="h-7 w-7 text-primary-700" />
          </div>
          <h1 className="text-2xl font-bold text-stone-950">无法发布房源</h1>
          <p className="mt-3 text-sm leading-6 text-stone-500">只有房东账号可以发布房源。请登录房东账号后再试。</p>
          <Link to="/login" onClick={close} className="mt-7 flex h-11 w-full items-center justify-center rounded-2xl bg-gradient-to-b from-slate-800 to-slate-950 text-base font-semibold text-[#f5f0e8] shadow-[0_6px_12px_rgba(15,23,42,0.32)]">
            去登录
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-stone-950/55 px-4 py-6 backdrop-blur-sm">
      <div
        className="relative w-full max-w-[720px] rounded-[1.5rem] border border-primary-600/20 p-6 shadow-[0_22px_55px_rgba(27,23,18,0.28)] animate-fade-in md:p-8"
        style={{
          background:
            'linear-gradient(180deg, rgba(245,240,232,0.98) 0%, rgba(242,236,226,0.98) 100%)',
        }}
      >
        <CloseButton onClose={close} />

        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#fbf7ef] text-stone-950 shadow-[0_12px_30px_rgba(36,31,26,0.18)]">
            <HomeIcon className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-stone-950">发布房源</h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-stone-500">
            请确保信息真实准确。房源信息会参与后续合同生成与链上核验。
          </p>
        </div>

        <form onSubmit={handleSubmit} className="max-h-[68vh] space-y-4 overflow-y-auto pr-1">
          <Panel>
            <Field label="标题 *">
              <input type="text" className="auth-input" placeholder="例如：朝阳区精装两居"
                value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} required />
            </Field>

            <Field label="描述 *">
              <textarea className="auth-input min-h-[84px] resize-none py-2" placeholder="填写房屋情况、交通、周边配套等"
                value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} required />
            </Field>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="地址 *">
                <input type="text" className="auth-input" placeholder="详细地址"
                  value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} required />
              </Field>
              <Field label="区域">
                <input type="text" className="auth-input" placeholder="例如：朝阳区"
                  value={form.district} onChange={(e) => setForm((p) => ({ ...p, district: e.target.value }))} />
              </Field>
            </div>
          </Panel>

          <Panel>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="月租金(ETH) *">
                <input type="number" step="0.01" min="0" className="auth-input" placeholder="0.1"
                  value={form.rentAmount} onChange={(e) => setForm((p) => ({ ...p, rentAmount: e.target.value }))} required />
              </Field>
              <Field label="面积(㎡)">
                <input type="number" min="0" className="auth-input" placeholder="90"
                  value={form.area} onChange={(e) => setForm((p) => ({ ...p, area: e.target.value }))} />
              </Field>
            </div>

            <Field label="最少租期(月)">
              <select className="auth-input" value={form.minLeaseMonths}
                onChange={(e) => setForm((p) => ({ ...p, minLeaseMonths: parseInt(e.target.value, 10) }))}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{m}个月</option>
                ))}
              </select>
            </Field>

            <div className="grid grid-cols-3 gap-3">
              {[
                { label: '卧室', key: 'bedrooms', min: 1 },
                { label: '客厅', key: 'livingrooms', min: 0 },
                { label: '卫生间', key: 'bathrooms', min: 1 },
              ].map(({ label, key, min }) => (
                <Field key={key} label={label}>
                  <input type="number" min={min} className="auth-input"
                    value={form[key]} onChange={(e) => setForm((p) => ({ ...p, [key]: parseInt(e.target.value, 10) }))} />
                </Field>
              ))}
            </div>
          </Panel>

          <Panel>
            <label className="block text-sm font-semibold text-stone-900">房源图片</label>
            <p className="mt-1 text-xs text-stone-500">可选，最多 {MAX_IMAGE_COUNT} 张，仅支持 jpeg/png/webp。</p>
            <input
              type="file"
              className="mt-3 block w-full rounded-2xl border border-stone-300 bg-[#fbf7ef] px-3 py-2 text-sm text-stone-700 file:mr-3 file:rounded-xl file:border-0 file:bg-stone-950 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-[#f5f0e8]"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={handleImageChange}
            />
            {imagePreviews.length > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-3 md:grid-cols-4">
                {imagePreviews.map((url, index) => (
                  <div key={`${url}_${index}`} className="group relative overflow-hidden rounded-2xl border border-stone-300">
                    <img src={url} alt={`preview_${index}`} className="h-24 w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeImage(index)}
                      className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-stone-950/85 text-[#f5f0e8] shadow-sm transition-colors hover:bg-red-600"
                      aria-label={`删除第 ${index + 1} 张图片`}
                    >
                      <XIcon className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <div className="rounded-2xl border border-primary-600/30 bg-primary-600/15 p-3 text-sm text-stone-700">
            <p className="font-semibold text-stone-900">法律提示</p>
            <p className="mt-1 leading-6">发布房源即表示您承诺该房源可合法出租，建议保留房产证明与委托证明等材料。</p>
          </div>

          <button type="submit" disabled={submitting} className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-slate-800 to-slate-950 text-base font-semibold text-[#f5f0e8] shadow-[0_6px_12px_rgba(15,23,42,0.32)] transition-transform hover:-translate-y-0.5 disabled:opacity-60">
            {submitting ? <LoaderIcon className="h-5 w-5 animate-spin" /> : <PlusCircleIcon className="h-5 w-5" />}
            <span>{submitting ? '提交中...' : '发布房源'}</span>
          </button>
        </form>
      </div>
    </div>
  );
}

function Panel({ children }) {
  return (
    <section className="space-y-3 rounded-2xl border border-stone-300 bg-[#fbf7ef] p-4">
      {children}
    </section>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-stone-500">{label}</span>
      <span className="flex min-h-[40px] items-center rounded-2xl border border-stone-300 bg-[#f5f0e8] px-3 focus-within:border-primary-600/80">
        {children}
      </span>
    </label>
  );
}

function CloseButton({ onClose }) {
  return (
    <button
      type="button"
      onClick={onClose}
      className="absolute right-4 top-4 rounded-full p-1.5 text-stone-400 transition-colors hover:bg-stone-900/5 hover:text-stone-700"
      aria-label="关闭"
    >
      <XIcon className="h-4 w-4" />
    </button>
  );
}
