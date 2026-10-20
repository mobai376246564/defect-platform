import { Card, Typography } from 'antd';
import type { ReactNode } from 'react';
import { BrandLogo } from './BrandLogo';

/** 登录、注册页的外框：网格底纹 + 品牌标识 + 卡片 */
export function AuthShell({
  title,
  width = 380,
  children,
}: {
  title: string;
  width?: number;
  children: ReactNode;
}) {
  return (
    <div className="auth-bg">
      <div style={{ width: '100%', maxWidth: width }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <BrandLogo className="brand-mark" size={44} />
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              缺陷管理平台
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              缺陷跟踪 · APP 反馈建单 · Claude Code 修复
            </Typography.Text>
          </div>
        </div>
        <Card title={title} styles={{ header: { fontSize: 15 } }}>
          {children}
        </Card>
      </div>
    </div>
  );
}
