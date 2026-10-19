import { BugOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? '/projects';

  if (user) return <Navigate to={from} replace />;

  const onFinish = async (values: { account: string; password: string }) => {
    setSubmitting(true);
    setError(null);
    try {
      await login(values.account, values.password);
      navigate(from, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: '#f5f7fa',
        padding: 16,
      }}
    >
      <Card style={{ width: '100%', maxWidth: 380 }}>
        <Typography.Title level={3} style={{ textAlign: 'center' }}>
          <BugOutlined /> 缺陷管理平台
        </Typography.Title>
        {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
        <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item
            name="account"
            label="账号"
            rules={[{ required: true, whitespace: true, message: '请输入账号或邮箱' }]}
          >
            <Input autoComplete="username" placeholder="账号或邮箱" autoFocus />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={submitting}>
            登录
          </Button>
        </Form>
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          还没有账号？<Link to="/register">注册账号</Link>
        </div>
      </Card>
    </div>
  );
}
