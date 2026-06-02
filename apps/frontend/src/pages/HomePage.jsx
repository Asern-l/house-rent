import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../app/providers/AuthContext';

const BG_IMAGE =
  'https://hoirqrkdgbmvpwutwuwj.supabase.co/storage/v1/object/public/assets/assets/b88b71ee-6e8c-4230-b004-094bc0a9f86f_3840w.jpg';
const CREAM = '#F2EFE4';

export default function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const bgRef = useRef(null);

  // ── Parallax scroll (same ratio as RelayEstate: 0.25) ──
  useEffect(() => {
    const onScroll = () => {
      if (!bgRef.current) return;
      if (window.scrollY < window.innerHeight) {
        bgRef.current.style.transform = `translateY(${window.scrollY * 0.25}px)`;
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // ── RevealFlow animation via IntersectionObserver ──
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add('reveal-active'); }),
      { threshold: 0.1 }
    );
    document.querySelectorAll('.reveal-item').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className="relative overflow-hidden"
      style={{ minHeight: 'calc(100vh - 56px)' }}
    >
      {/* ── Background layer: absolutely positioned, 116% tall for parallax room ── */}
      <div className="absolute inset-0 overflow-hidden">
        <img
          ref={bgRef}
          src={BG_IMAGE}
          alt=""
          style={{
            position: 'absolute',
            top: '-8%',
            left: 0,
            right: 0,
            width: '100%',
            height: '116%',
            objectFit: 'cover',
            objectPosition: 'center 30%',
            opacity: 0.88,
            willChange: 'transform',
          }}
        />

        {/* Gradient overlay: left-heavy dark + amber accent + bottom darkening */}
        <div
          className="absolute inset-0"
          style={{
            background: `
              radial-gradient(circle at 70% 32%, rgba(201, 135, 85, 0.14), transparent 36%),
              linear-gradient(90deg, rgba(18,15,12,0.62), rgba(18,15,12,0.22) 48%, rgba(18,15,12,0.52)),
              linear-gradient(180deg, rgba(18,15,12,0.18), transparent 40%, rgba(18,15,12,0.82))
            `,
          }}
        />

        {/* Subtle grid texture (same as reference) */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `
              linear-gradient(rgba(251,246,238,0.055) 1px, transparent 1px),
              linear-gradient(90deg, rgba(251,246,238,0.055) 1px, transparent 1px)
            `,
            backgroundSize: '72px 72px',
            opacity: 0.18,
            maskImage: 'radial-gradient(circle at 55% 50%, black, transparent 72%)',
            WebkitMaskImage: 'radial-gradient(circle at 55% 50%, black, transparent 72%)',
          }}
        />
      </div>

      {/* ── Content ── */}
      <div
        className="relative flex flex-col px-8 py-10 md:px-14 lg:px-20"
        style={{ minHeight: 'calc(100vh - 56px)', zIndex: 5 }}
      >
        {/* Top meta strip */}
        <div className="reveal-item reveal-delay-200 flex items-start justify-between">
          <div>
            <p className="text-[11px] tracking-[0.2em] uppercase" style={{ color: CREAM, opacity: 0.7 }}>
              // 区块链租房平台
            </p>
            <p className="mt-1 text-xs" style={{ color: CREAM, opacity: 0.45 }}>
              房源存证 · 合同上链 · 支付核验
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] tracking-[0.2em] uppercase" style={{ color: CREAM, opacity: 0.7 }}>
              智能合约层
            </p>
            <p className="mt-1 text-xs" style={{ color: CREAM, opacity: 0.45 }}>
              Sepolia / Local EVM
            </p>
          </div>
        </div>

        {/* Bottom content */}
        <div className="mt-auto grid grid-cols-1 items-end gap-10 pb-12 md:grid-cols-2 lg:pb-16">
          {/* Headline */}
          <h1
            className="reveal-item reveal-delay-100 text-5xl font-bold leading-[1.05] tracking-tight md:pl-8 md:text-6xl lg:pl-14 lg:text-7xl"
            style={{ color: CREAM }}
          >
            每一份合同<br />上链留存
          </h1>

          {/* Right: description + CTA */}
          <div className="reveal-item reveal-delay-300 md:justify-self-end">
            <p
              className="mb-7 max-w-sm text-base leading-relaxed"
              style={{ color: CREAM, opacity: 0.75 }}
            >
              基于区块链的租房流程演示系统。合同哈希上链，签署记录不可篡改，随时可链上核验。
            </p>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => navigate('/listings')}
                className="btn-primary flex items-center gap-2"
              >
                浏览房源
              </button>
              {user ? (
                <button
                  type="button"
                  onClick={() => navigate('/contracts')}
                  className="flex items-center gap-2 rounded-xl border px-6 py-2.5 text-sm font-medium backdrop-blur-sm"
                  style={{ color: '#A47864', borderColor: 'rgba(164,120,100,0.55)', background: 'rgba(164,120,100,0.08)' }}
                >
                  我的合同
                </button>
              ) : null}
            </div>

            {/* Feature tags */}
            <div className="mt-6 flex flex-wrap gap-6 text-xs" style={{ color: CREAM, opacity: 0.6 }}>
              {['哈希上链', '合同存证', '支付核验'].map((tag) => (
                <span key={tag} className="flex items-center gap-2">
                  <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: '#A47864' }} />
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
