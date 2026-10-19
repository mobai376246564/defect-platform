import { BugOutlined, PlusOutlined, SettingOutlined, UserOutlined } from '@ant-design/icons';
import { Avatar, Dropdown, Layout, Menu, Select, Space, Typography } from 'antd';
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useProjects } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';

const { Header, Sider, Content } = Layout;

export function AppLayout() {
  const { user, logout } = useAuth();
  const { key } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const projects = useProjects();

  const section = location.pathname.includes('/settings')
    ? 'settings'
    : location.pathname.endsWith('/new')
      ? 'new'
      : 'bugs';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          background: '#001529',
          paddingInline: 20,
        }}
      >
        <Link
          to="/projects"
          style={{ color: '#fff', fontWeight: 600, fontSize: 16, whiteSpace: 'nowrap' }}
        >
          <BugOutlined /> 缺陷管理平台
        </Link>
        {key && (
          <Select
            value={key}
            style={{ minWidth: 200 }}
            options={(projects.data ?? []).map((p) => ({
              value: p.key,
              label: `${p.name}（${p.key}）`,
            }))}
            onChange={(k) => navigate(`/p/${k}/bugs`)}
            aria-label="切换项目"
          />
        )}
        <div style={{ flex: 1 }} />
        <Dropdown
          menu={{
            items: [
              { key: 'me', label: '个人设置与 Claude Code 接入', onClick: () => navigate('/me') },
              { type: 'divider' },
              { key: 'logout', label: '退出登录', onClick: logout },
            ],
          }}
        >
          <Space style={{ color: '#fff', cursor: 'pointer' }}>
            <Avatar size="small" icon={<UserOutlined />} />
            <Typography.Text style={{ color: '#fff' }}>{user?.name}</Typography.Text>
          </Space>
        </Dropdown>
      </Header>
      <Layout>
        {key && (
          <Sider width={180} theme="light" breakpoint="lg" collapsedWidth={0}>
            <Menu
              mode="inline"
              selectedKeys={[section]}
              style={{ height: '100%', paddingTop: 8 }}
              items={[
                {
                  key: 'bugs',
                  icon: <BugOutlined />,
                  label: <Link to={`/p/${key}/bugs`}>缺陷列表</Link>,
                },
                {
                  key: 'new',
                  icon: <PlusOutlined />,
                  label: <Link to={`/p/${key}/bugs/new`}>新建缺陷</Link>,
                },
                {
                  key: 'settings',
                  icon: <SettingOutlined />,
                  label: <Link to={`/p/${key}/settings`}>项目设置</Link>,
                },
              ]}
            />
          </Sider>
        )}
        <Content style={{ padding: 20, minWidth: 0 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
