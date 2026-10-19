import {
  AppstoreOutlined,
  BarChartOutlined,
  BellOutlined,
  BugOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  ProjectOutlined,
  SettingOutlined,
  SunOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import {
  Avatar,
  Badge,
  Button,
  ConfigProvider,
  Drawer,
  Dropdown,
  Grid,
  Layout,
  Menu,
  Select,
  Tooltip,
  type MenuProps,
} from 'antd';
import { useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useProjects, useUnreadCount } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { usePendingUserCount } from '../pages/UsersPage';
import { CHROME, themeConfig, useThemeMode } from '../theme/theme';
import { menuSection } from './section';

const { Header, Sider, Content } = Layout;

const COLLAPSE_KEY = 'defect.sider-collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

/** 顶栏上的图标按钮：深色底上统一浅色图标 */
function HeaderIcon({
  title,
  icon,
  count,
  onClick,
}: {
  title: string;
  icon: ReactNode;
  count?: number;
  onClick: () => void;
}) {
  return (
    <Tooltip title={title}>
      <Badge count={count ?? 0} size="small" offset={[-6, 6]}>
        <Button
          type="text"
          aria-label={title}
          icon={icon}
          onClick={onClick}
          style={{ color: CHROME.headerText, fontSize: 16 }}
        />
      </Badge>
    </Tooltip>
  );
}

export function AppLayout() {
  const { user, logout } = useAuth();
  const { key } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const projects = useProjects();
  const unread = useUnreadCount();
  const pendingUsers = usePendingUserCount(!!user?.isSystemAdmin);
  const { mode, toggle } = useThemeMode();
  const screens = Grid.useBreakpoint();
  const mobile = !screens.md;
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const section = menuSection(location.pathname);
  const setCollapsedSaved = (v: boolean) => {
    setCollapsed(v);
    try {
      localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0');
    } catch {
      // 只是记住偏好
    }
  };

  const projectItems: MenuProps['items'] = key
    ? [
        {
          key: 'bugs',
          icon: <BugOutlined />,
          label: <Link to={`/p/${key}/bugs`}>缺陷列表</Link>,
        },
        {
          key: 'board',
          icon: <ProjectOutlined />,
          label: <Link to={`/p/${key}/bugs/board`}>缺陷看板</Link>,
        },
        {
          key: 'reports',
          icon: <BarChartOutlined />,
          label: <Link to={`/p/${key}/reports`}>统计报表</Link>,
        },
        {
          key: 'settings',
          icon: <SettingOutlined />,
          label: <Link to={`/p/${key}/settings`}>项目设置</Link>,
        },
      ]
    : [];
  const globalItems: MenuProps['items'] = [
    {
      key: 'projects',
      icon: <AppstoreOutlined />,
      label: <Link to="/projects">{user?.isSystemAdmin ? '项目管理' : '全部项目'}</Link>,
    },
    ...(user?.isSystemAdmin
      ? [
          {
            key: 'users',
            icon: <TeamOutlined />,
            label: <Link to="/admin/users">用户管理</Link>,
          },
        ]
      : []),
  ];
  const selected = key
    ? [section]
    : location.pathname.startsWith('/admin/users')
      ? ['users']
      : location.pathname.startsWith('/projects')
        ? ['projects']
        : [];
  const menu = (
    <Menu
      mode="inline"
      selectedKeys={selected}
      onClick={() => setDrawerOpen(false)}
      style={{ borderInlineEnd: 'none', paddingBlock: 8 }}
      items={[
        ...(key ? [{ type: 'group' as const, label: '项目', children: projectItems }] : []),
        {
          type: 'group' as const,
          label: key ? '全局' : undefined,
          children: globalItems,
        },
      ]}
    />
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: mobile ? 8 : 16,
          position: 'sticky',
          top: 0,
          zIndex: 100,
          borderBottom: `1px solid ${CHROME.headerBorder}`,
        }}
      >
        {mobile && (
          <Button
            type="text"
            aria-label="打开菜单"
            icon={<MenuOutlined />}
            style={{ color: CHROME.headerText }}
            onClick={() => setDrawerOpen(true)}
          />
        )}
        <Link
          to="/projects"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            color: CHROME.headerTextStrong,
            fontWeight: 600,
            fontSize: 15,
            whiteSpace: 'nowrap',
          }}
        >
          <span
            className="mono"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 26,
              height: 26,
              border: `1px solid ${CHROME.accent}`,
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 700,
              color: CHROME.headerTextStrong,
            }}
          >
            DP
          </span>
          {!mobile && '缺陷管理平台'}
        </Link>
        {key && (
          // 顶栏始终是深色，切换器固定用深色主题，浅色模式下也看得清
          <ConfigProvider theme={themeConfig('dark')}>
            <Select
              value={key}
              variant="filled"
              popupMatchSelectWidth={false}
              style={{ minWidth: mobile ? 120 : 200, maxWidth: 280 }}
              options={(projects.data ?? []).map((p) => ({
                value: p.key,
                label: `${p.name}（${p.key}）`,
              }))}
              onChange={(k) => navigate(`/p/${k}/bugs`)}
              aria-label="切换项目"
            />
          </ConfigProvider>
        )}
        <div style={{ flex: 1 }} />
        <HeaderIcon
          title={mode === 'dark' ? '切换到浅色' : '切换到深色'}
          icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
          onClick={toggle}
        />
        {user?.isSystemAdmin && !mobile && (
          <HeaderIcon
            title={
              pendingUsers.data?.count
                ? `用户管理（${pendingUsers.data.count} 个注册待审核）`
                : '用户管理'
            }
            icon={<TeamOutlined />}
            count={pendingUsers.data?.count}
            onClick={() => navigate('/admin/users')}
          />
        )}
        <HeaderIcon
          title="通知中心"
          icon={<BellOutlined />}
          count={unread.data?.count}
          onClick={() => navigate('/notifications')}
        />
        <Dropdown
          menu={{
            items: [
              { key: 'me', label: '个人设置与 Claude Code 接入', onClick: () => navigate('/me') },
              ...(user?.isSystemAdmin
                ? [{ key: 'users', label: '用户管理', onClick: () => navigate('/admin/users') }]
                : []),
              { type: 'divider' },
              { key: 'logout', label: '退出登录', onClick: logout },
            ],
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'pointer',
              color: CHROME.headerText,
            }}
          >
            <Avatar
              size={26}
              icon={<UserOutlined />}
              style={{ background: '#1f2937', color: CHROME.headerText }}
            />
            {!mobile && <span>{user?.name}</span>}
          </div>
        </Dropdown>
      </Header>
      <Layout>
        {!mobile && (
          <Sider
            width={208}
            collapsible
            collapsed={collapsed}
            collapsedWidth={56}
            trigger={null}
            style={{
              position: 'sticky',
              top: 52,
              height: 'calc(100vh - 52px)',
              overflow: 'auto',
              borderInlineEnd: '1px solid var(--sider-border)',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ flex: 1 }}>{menu}</div>
              <Button
                type="text"
                aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
                icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setCollapsedSaved(!collapsed)}
                style={{ margin: 8, alignSelf: collapsed ? 'center' : 'flex-start' }}
              />
            </div>
          </Sider>
        )}
        <Drawer
          placement="left"
          width={240}
          open={mobile && drawerOpen}
          onClose={() => setDrawerOpen(false)}
          styles={{ body: { padding: 0 } }}
          title="缺陷管理平台"
        >
          {menu}
        </Drawer>
        <Content style={{ padding: mobile ? 12 : '20px 24px', minWidth: 0 }}>
          <div className="page">
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
