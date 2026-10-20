import {
  AppstoreOutlined,
  BellOutlined,
  BugOutlined,
  CheckSquareOutlined,
  CloudSyncOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  PieChartOutlined,
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
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useProjects, useTodos, useUnreadCount } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { UpdateBanner } from '../components/UpdateBanner';
import { usePendingUserCount } from '../pages/UsersPage';
import { CHROME, themeConfig, useThemeMode } from '../theme/theme';
import { menuSection } from './section';

const { Header, Sider, Content } = Layout;

const COLLAPSE_KEY = 'defect.sider-collapsed';
const LAST_PROJECT_KEY = 'defect.last-project';

function readLastProject(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}

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
  // 侧边栏“我的待办”上的未完成数量
  const todoCount = useTodos({ statusCategory: 'todo,doing,verifying', pageSize: '1' });
  const { mode, toggle } = useThemeMode();
  const screens = Grid.useBreakpoint();
  const mobile = !screens.md;
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // 侧边栏的“项目”分组常驻：在项目页时用当前项目，其他页面用上次打开的项目
  const [lastProject, setLastProject] = useState(readLastProject);
  useEffect(() => {
    if (!key) return;
    setLastProject(key);
    try {
      localStorage.setItem(LAST_PROJECT_KEY, key);
    } catch {
      // 只是记住偏好
    }
  }, [key]);
  const projectKey =
    key ??
    (projects.data?.some((p) => p.key === lastProject) ? lastProject : projects.data?.[0]?.key) ??
    undefined;

  const section = menuSection(location.pathname);
  const setCollapsedSaved = (v: boolean) => {
    setCollapsed(v);
    try {
      localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0');
    } catch {
      // 只是记住偏好
    }
  };

  /** 菜单图标：带底色的圆角方块，每项一种颜色便于区分；选中时变为实色 */
  const chip = (icon: ReactNode, color: string) => (
    <span className="nav-icon" style={{ '--chip': color } as CSSProperties}>
      {icon}
    </span>
  );
  const workItems: MenuProps['items'] = [
    {
      key: 'todo',
      icon: chip(<CheckSquareOutlined />, '#f59e0b'),
      label: (
        <Link to="/todo" className="nav-label">
          我的待办
          {!!todoCount.data?.total && (
            <span className="nav-count mono">{todoCount.data.total}</span>
          )}
        </Link>
      ),
    },
  ];
  const projectItems: MenuProps['items'] = projectKey
    ? [
        {
          key: 'bugs',
          icon: chip(<BugOutlined />, '#3b82f6'),
          label: <Link to={`/p/${projectKey}/bugs`}>缺陷列表</Link>,
        },
        {
          key: 'board',
          icon: chip(<ProjectOutlined />, '#8b5cf6'),
          label: <Link to={`/p/${projectKey}/bugs/board`}>缺陷看板</Link>,
        },
        {
          key: 'reports',
          icon: chip(<PieChartOutlined />, '#06b6d4'),
          label: <Link to={`/p/${projectKey}/reports`}>统计报表</Link>,
        },
        {
          key: 'settings',
          icon: chip(<SettingOutlined />, '#64748b'),
          label: <Link to={`/p/${projectKey}/settings`}>项目设置</Link>,
        },
      ]
    : [];
  // 全局功能只有系统管理员可见，入口只放在侧边栏
  const globalItems: MenuProps['items'] = user?.isSystemAdmin
    ? [
        {
          key: 'projects',
          icon: chip(<AppstoreOutlined />, '#10b981'),
          label: <Link to="/projects">项目管理</Link>,
        },
        {
          key: 'users',
          icon: chip(<TeamOutlined />, '#ec4899'),
          label: (
            <Link to="/admin/users" className="nav-label">
              用户管理
              {!!pendingUsers.data?.count && (
                <Tooltip title={`${pendingUsers.data.count} 个注册待审核`}>
                  <span className="nav-count mono">{pendingUsers.data.count}</span>
                </Tooltip>
              )}
            </Link>
          ),
        },
        {
          key: 'system',
          icon: chip(<CloudSyncOutlined />, '#14b8a6'),
          label: <Link to="/admin/system">系统更新</Link>,
        },
      ]
    : [];
  const selected = key
    ? [section]
    : location.pathname.startsWith('/todo')
      ? ['todo']
      : location.pathname.startsWith('/admin/users')
        ? ['users']
        : location.pathname.startsWith('/admin/system')
          ? ['system']
          : location.pathname.startsWith('/projects')
            ? ['projects']
            : [];
  const currentProject = projects.data?.find((p) => p.key === projectKey);
  const menu = (
    <Menu
      mode="inline"
      className="app-nav"
      selectedKeys={selected}
      onClick={() => setDrawerOpen(false)}
      style={{ borderInlineEnd: 'none', paddingBlock: 4 }}
      items={[
        { type: 'group' as const, label: '工作台', children: workItems },
        ...(projectKey
          ? [
              {
                type: 'group' as const,
                label: currentProject ? `项目 · ${currentProject.name}` : '项目',
                children: projectItems,
              },
            ]
          : []),
        ...(globalItems.length
          ? [{ type: 'group' as const, label: '全局', children: globalItems }]
          : []),
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
          to="/todo"
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
        {projectKey && (
          // 顶栏始终是深色，切换器固定用深色主题，浅色模式下也看得清
          <ConfigProvider theme={themeConfig('dark')}>
            <Select
              value={projectKey}
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
            width={220}
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
        <Content style={{ padding: mobile ? 12 : '16px 20px', minWidth: 0 }}>
          <div className="page">
            <UpdateBanner />
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
