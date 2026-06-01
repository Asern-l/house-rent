import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Vite 打包时 Leaflet 默认图标路径会断，手动修复
import markerIconPng from 'leaflet/dist/images/marker-icon.png';
import markerIcon2xPng from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadowPng from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIconPng,
  iconRetinaUrl: markerIcon2xPng,
  shadowUrl: markerShadowPng,
});

// 用 Nominatim (OSM 免费服务) 反向解析坐标为中文地址
async function reverseGeocode(lat, lng) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=zh-CN`,
    { headers: { 'Accept-Language': 'zh-CN,zh' } }
  );
  if (!res.ok) throw new Error('geocode failed');
  return res.json();
}

export default function LocationPicker({ onSelect, initialAddress }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const [status, setStatus] = useState('idle'); // idle | loading | done | error

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current).setView([39.9042, 116.4074], 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    map.on('click', async (e) => {
      const { lat, lng } = e.latlng;

      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
      } else {
        markerRef.current = L.marker([lat, lng]).addTo(map);
      }

      setStatus('loading');
      try {
        const data = await reverseGeocode(lat, lng);
        const addr = data.display_name || '';
        const district =
          data.address?.city_district ||
          data.address?.suburb ||
          data.address?.county ||
          '';
        setStatus('done');
        onSelect?.({ address: addr, district, lat, lng });
        markerRef.current?.bindPopup(addr.split(',')[0]).openPopup();
      } catch {
        setStatus('error');
        onSelect?.({ address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, district: '', lat, lng });
      }
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-stone-500">在地图上点击选择位置</span>
        {status === 'loading' && (
          <span className="text-xs text-stone-400 animate-pulse">正在解析地址…</span>
        )}
        {status === 'done' && (
          <span className="text-xs text-emerald-600">✓ 地址已填入</span>
        )}
        {status === 'error' && (
          <span className="text-xs text-red-500">解析失败，已填入坐标</span>
        )}
      </div>
      <div
        ref={containerRef}
        className="w-full rounded-2xl border border-stone-300 overflow-hidden"
        style={{ height: 280 }}
      />
      <p className="text-[11px] text-stone-400">
        点击地图后会自动填入地址，你也可以在下方手动修改。
      </p>
    </div>
  );
}
