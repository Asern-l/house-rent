import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../app/providers/AuthContext';

export default function HomePage() {
  const { user } = useAuth();

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
      className="-mx-6 -mt-6 flex flex-col px-8 py-10 md:px-14 lg:px-20"
      style={{ minHeight: 'calc(100vh - 56px)' }}
    >
      {/* Top meta strip */}
      <div className="reveal-item reveal-delay-200 flex items-start justify-between">
        <div>
          <p className="text-[11px] tracking-[0.2em] uppercase text-white/60">
            // 区块链租房平台
          </p>
          <p className="mt-1 text-xs text-white/40">
            房源存证 · 合同上链 · 支付核验
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] tracking-[0.2em] uppercase text-white/60">
            智能合约层
          </p>
          <p className="mt-1 text-xs text-white/40">
            Sepolia / Local EVM
          </p>
        </div>
      </div>

      {/* Bottom content */}
      <div className="mt-auto grid grid-cols-1 items-end gap-10 pb-12 md:grid-cols-2 lg:pb-16">
        {/* Headline */}
        <h1 className="reveal-item reveal-delay-100 text-5xl font-bold leading-[1.05] tracking-tight text-white md:pl-8 md:text-6xl lg:pl-14 lg:text-7xl">
          每一份合同<br />上链留存
        </h1>

        {/* Right: description + CTA */}
        <div className="reveal-item reveal-delay-300 md:justify-self-end">
          <p className="mb-7 max-w-sm text-base leading-relaxed text-white/70">
            基于区块链的租房流程演示系统。合同哈希上链，签署记录不可篡改，随时可链上核验。
          </p>

          <div className="flex flex-wrap gap-3">
            <Link to="/listings" className="btn-primary flex items-center gap-2">
              浏览房源
            </Link>
            {user && (
              <Link
                to="/contracts"
                className="flex items-center gap-2 border border-white/30 text-sm font-medium px-6 py-2.5 rounded-lg backdrop-blur-sm hover:bg-white/10 transition-colors text-white/80"
              >
                我的合同
              </Link>
            )}
          </div>

          {/* Feature tags */}
          <div className="mt-6 flex flex-wrap gap-6 text-xs text-white/50">
            {['哈希上链', '合同存证', '支付核验'].map((tag) => (
              <span key={tag} className="flex items-center gap-2">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary-600" />
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
