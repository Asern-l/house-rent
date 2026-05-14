/**
 * 文件说明：首页
 * - 展示平台简介、核心能力与快捷入口。
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../app/providers/AuthContext';
import { FileTextIcon, HomeIcon, ShieldCheckIcon } from 'lucide-react';

// 函数 1: 页面主组件。
export default function HomePage() {
  const { user } = useAuth();

  const features = [
    {
      icon: ShieldCheckIcon,
      title: '房源信息存证',
      desc: '支持房源关键字段上链留痕，降低信息篡改风险。',
    },
    {
      icon: FileTextIcon,
      title: '合同签署上链',
      desc: '合同签署后记录合同哈希与交易编号，便于后续核验。',
    },
    {
      icon: HomeIcon,
      title: '按月支付记录',
      desc: '围绕合同记录一次性支付与后续续约等交易事件。',
    },
  ];

  return (
    <div className="space-y-10 animate-fade-in">
      <section className="card p-8">
        <h1 className="text-3xl font-bold text-gray-900">信源链租房平台</h1>
        <p className="mt-3 text-gray-600">面向房东与租客的区块链租房流程演示系统。</p>
        <p className="mt-2 text-sm text-amber-700">
          当前版本说明：押金功能暂未启用，当前采用一次性支付流程。
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/listings" className="btn-primary">
            浏览房源
          </Link>
          {user?.role === 'landlord' && (
            <Link to="/publish" className="btn-secondary">
              发布房源
            </Link>
          )}
          {user ? (
            <Link to="/contracts" className="btn-secondary">
              我的合同
            </Link>
          ) : (
            <Link to="/login" className="btn-secondary">
              登录开始
            </Link>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold text-gray-800">核心能力</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <div key={feature.title} className="card p-5">
                <Icon className="mb-3 h-8 w-8 text-primary-600" />
                <h3 className="text-base font-semibold text-gray-800">{feature.title}</h3>
                <p className="mt-2 text-sm text-gray-600">{feature.desc}</p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}






