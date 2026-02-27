import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth';
import Layout from '@/components/Layout';
import Login from '@/pages/Login';
import Bots from '@/pages/Bots';
import Links from '@/pages/Links';
import Resources from '@/pages/Resources';
import Contents from '@/pages/Contents';
import Ads from '@/pages/Ads';
import Users from '@/pages/Users';
import Stats from '@/pages/Stats';
import Settings from '@/pages/Settings';
import Manual from '@/pages/Manual';

function AuthGuard({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  {
    path: '/',
    element: (
      <AuthGuard>
        <Layout />
      </AuthGuard>
    ),
    children: [
      { index: true, element: <Navigate to="/bots" replace /> },
      { path: 'bots', element: <Bots /> },
      { path: 'bots/:botId/links', element: <Links /> },
      { path: 'resources', element: <Resources /> },
      { path: 'contents', element: <Contents /> },
      { path: 'ads', element: <Ads /> },
      { path: 'users', element: <Users /> },
      { path: 'stats', element: <Stats /> },
      { path: 'settings', element: <Settings /> },
      { path: 'manual', element: <Manual /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
