import { BugOutlined } from '@ant-design/icons';
import { POSITION, POSITIONS, USERNAME_PATTERN, type Position } from '@defect/shared';
import { Alert, Button, Card, Form, Input, Result, Select, Typography } from 'antd';
import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

interface RegisterValues {
  position: Position;
  username: string;
  name?: string;
  password: string;
  confirm: string;
}

const positionOptions = POSITIONS.map((p) => ({ value: p, label: POSITION[p] }));

/** 自助注册：提交后账号为待审核状态，系统管理员通过后才能登录。 */
export function RegisterPage() {
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  if (user) return <Navigate to="/projects" replace />;

  const onFinish = async (v: RegisterValues) => {
    setSubmitting(true);
    setError(null);
    try {
      await api('/auth/register', {
        method: 'POST',
        body: {
          position: v.position,
          username: v.username.trim(),
          name: v.name?.trim() || undefined,
          password: v.password,
        },
      });
      setDone(v.username.trim().toLowerCase());
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
      <Card style={{ width: '100%', maxWidth: 420 }}>
        <Typography.Title level={3} style={{ textAlign: 'center' }}>
          <BugOutlined /> 注册账号
        </Typography.Title>
        {done ? (
          <Result
            status="success"
            title="注册成功，等待管理员审核"
            subTitle={`账号 ${done} 审核通过后即可登录`}
            extra={
              <Link to="/login">
                <Button type="primary">返回登录</Button>
              </Link>
            }
          />
        ) : (
          <>
            {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
            <Form<RegisterValues> layout="vertical" onFinish={(v) => void onFinish(v)}>
              <Form.Item
                name="position"
                label="职位"
                rules={[{ required: true, message: '请选择职位' }]}
              >
                <Select options={positionOptions} placeholder="请选择职位" />
              </Form.Item>
              <Form.Item
                name="username"
                label="账号"
                extra="3–32 位字母、数字、下划线、点或横线，登录时使用"
                rules={[
                  { required: true, message: '请输入账号' },
                  { pattern: USERNAME_PATTERN, message: '账号格式不正确' },
                ]}
              >
                <Input autoComplete="username" />
              </Form.Item>
              <Form.Item
                name="name"
                label="姓名"
                extra="选填，默认与账号相同"
                rules={[{ max: 50 }]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="password"
                label="密码"
                rules={[
                  { required: true, message: '请输入密码' },
                  { min: 8, message: '密码至少 8 位' },
                  { max: 72, message: '密码最多 72 位' },
                ]}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Form.Item
                name="confirm"
                label="确认密码"
                dependencies={['password']}
                rules={[
                  { required: true, message: '请再次输入密码' },
                  ({ getFieldValue }) => ({
                    validator: (_, value) =>
                      !value || value === getFieldValue('password')
                        ? Promise.resolve()
                        : Promise.reject(new Error('两次输入的密码不一致')),
                  }),
                ]}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Button type="primary" htmlType="submit" block loading={submitting}>
                注册
              </Button>
            </Form>
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              已有账号？<Link to="/login">去登录</Link>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
