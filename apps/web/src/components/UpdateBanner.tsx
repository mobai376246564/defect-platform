import { Alert, Button, Space } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSystemVersion } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';

const DISMISS_KEY = 'defect.update-dismissed';

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

/**
 * 顶部版本提示：
 * 1. 服务端已经更新、当前页面还是旧版本时，提示刷新；
 * 2. 远程有新版本时提示，系统管理员可直接进入“系统更新”，可按版本关闭提示。
 */
export function UpdateBanner() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data } = useSystemVersion();
  const [dismissed, setDismissed] = useState(readDismissed);

  if (!data?.current) return null;

  if (__APP_COMMIT__ && data.current.commit !== __APP_COMMIT__) {
    return (
      <Alert
        type="success"
        showIcon
        banner
        style={{ marginBottom: 12, borderRadius: 4 }}
        message={`平台已更新到新版本 ${data.current.shortCommit}，刷新页面后生效`}
        action={
          <Button size="small" type="primary" onClick={() => window.location.reload()}>
            刷新
          </Button>
        }
      />
    );
  }

  const latest = data.latest;
  if (!data.selfUpdate.enabled || data.behind === 0 || !latest || dismissed === latest.commit) {
    return null;
  }
  return (
    <Alert
      type="info"
      showIcon
      banner
      closable
      style={{ marginBottom: 12, borderRadius: 4 }}
      onClose={() => {
        setDismissed(latest.commit);
        try {
          localStorage.setItem(DISMISS_KEY, latest.commit);
        } catch {
          // 只是记住关闭状态
        }
      }}
      message={
        <span>
          发现新版本 <span className="mono">{latest.shortCommit}</span>：{latest.subject}
          {data.behind > 1 ? ` 等 ${data.behind} 项更新` : ''}
          {user?.isSystemAdmin ? '' : '，等待管理员更新'}
        </span>
      }
      action={
        user?.isSystemAdmin && (
          <Space>
            <Button size="small" type="primary" onClick={() => navigate('/admin/system')}>
              查看并更新
            </Button>
          </Space>
        )
      }
    />
  );
}
