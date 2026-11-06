import { Segmented, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * 自动化测试页签的页头：标题 + 「用例库 / 执行记录」切换，右侧放各页自己的按钮。
 */
export function TestsNav({
  projectKey,
  projectName,
  active,
  children,
}: {
  projectKey: string;
  projectName?: string;
  active: 'cases' | 'runs';
  children?: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <div className="page-header">
      <Typography.Title level={4}>{projectName ?? projectKey} · 自动化测试</Typography.Title>
      <Segmented
        value={active}
        options={[
          { value: 'cases', label: '用例库' },
          { value: 'runs', label: '执行记录' },
        ]}
        onChange={(v) =>
          void navigate(v === 'cases' ? `/p/${projectKey}/tests` : `/p/${projectKey}/tests/runs`)
        }
      />
      <div style={{ flex: 1 }} />
      {children}
    </div>
  );
}
