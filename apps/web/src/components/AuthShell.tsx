import { Card, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useThemeMode } from '../theme/theme';

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
  const { mode } = useThemeMode();
  return (
    <div className="auth-bg">
      <div style={{ width: '100%', maxWidth: width }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <span
            className="mono"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 36,
              height: 36,
              border: '1px solid var(--accent)',
              borderRadius: 6,
              fontWeight: 700,
              fontSize: 13,
              color: mode === 'dark' ? '#f0f6fc' : '#1b2430',
            }}
          >
            DP
          </span>
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
