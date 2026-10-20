import { Spin } from 'antd';
import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { AppLayout } from './layouts/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { TodoPage } from './pages/TodoPage';

/**
 * 除登录页和首页（我的待办）外，其余页面按需加载：首屏只下载用得到的代码，
 * 报表的图表库等大依赖只在打开对应页面时才加载。
 */
const page = <K extends string>(load: () => Promise<Record<K, () => ReactNode>>, name: K) =>
  lazy(async () => ({ default: (await load())[name] }));

const RegisterPage = page(() => import('./pages/RegisterPage'), 'RegisterPage');
const MePage = page(() => import('./pages/MePage'), 'MePage');
const ProjectsPage = page(() => import('./pages/ProjectsPage'), 'ProjectsPage');
const SettingsPage = page(() => import('./pages/SettingsPage'), 'SettingsPage');
const SystemPage = page(() => import('./pages/SystemPage'), 'SystemPage');
const UsersPage = page(() => import('./pages/UsersPage'), 'UsersPage');
const DefectCreatePage = page(() => import('./pages/defects/DefectCreatePage'), 'DefectCreatePage');
const DefectDetailPage = page(() => import('./pages/defects/DefectDetailPage'), 'DefectDetailPage');
const DefectBoardPage = page(() => import('./pages/defects/DefectBoardPage'), 'DefectBoardPage');
const DefectListPage = page(() => import('./pages/defects/DefectListPage'), 'DefectListPage');
const NotificationsPage = page(
  () => import('./pages/notifications/NotificationsPage'),
  'NotificationsPage',
);
const ReportsPage = page(() => import('./pages/reports/ReportsPage'), 'ReportsPage');

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spin fullscreen />;
  if (!user)
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/register"
        element={
          <Suspense fallback={<Spin fullscreen />}>
            <RegisterPage />
          </Suspense>
        }
      />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/todo" element={<TodoPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/me" element={<MePage />} />
        <Route path="/admin/users" element={<UsersPage />} />
        <Route path="/admin/system" element={<SystemPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/p/:key" element={<Navigate to="bugs" replace />} />
        <Route path="/p/:key/bugs" element={<DefectListPage />} />
        <Route path="/p/:key/bugs/new" element={<DefectCreatePage />} />
        <Route path="/p/:key/bugs/board" element={<DefectBoardPage />} />
        <Route path="/p/:key/bugs/:code" element={<DefectDetailPage />} />
        <Route path="/p/:key/reports" element={<ReportsPage />} />
        <Route path="/p/:key/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/todo" replace />} />
    </Routes>
  );
}
