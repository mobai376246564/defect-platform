import { Spin } from 'antd';
import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { AppLayout } from './layouts/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { MePage } from './pages/MePage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SettingsPage } from './pages/SettingsPage';
import { UsersPage } from './pages/UsersPage';
import { DefectCreatePage } from './pages/defects/DefectCreatePage';
import { DefectDetailPage } from './pages/defects/DefectDetailPage';
import { DefectBoardPage } from './pages/defects/DefectBoardPage';
import { DefectListPage } from './pages/defects/DefectListPage';
import { NotificationsPage } from './pages/notifications/NotificationsPage';
import { ReportsPage } from './pages/reports/ReportsPage';

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
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/me" element={<MePage />} />
        <Route path="/admin/users" element={<UsersPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/p/:key" element={<Navigate to="bugs" replace />} />
        <Route path="/p/:key/bugs" element={<DefectListPage />} />
        <Route path="/p/:key/bugs/new" element={<DefectCreatePage />} />
        <Route path="/p/:key/bugs/board" element={<DefectBoardPage />} />
        <Route path="/p/:key/bugs/:code" element={<DefectDetailPage />} />
        <Route path="/p/:key/reports" element={<ReportsPage />} />
        <Route path="/p/:key/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
