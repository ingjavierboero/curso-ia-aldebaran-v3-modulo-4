import { Result } from 'antd';
import { createBrowserRouter } from 'react-router';
import { AppLayout } from './components/AppLayout.tsx';
import { RequireRole } from './components/RequireRole.tsx';
import { RequireSession } from './components/RequireSession.tsx';
import { FirstAdminPage } from './pages/FirstAdminPage.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { ProfilePage } from './pages/ProfilePage.tsx';
import { RecoveryRequestPage } from './pages/RecoveryRequestPage.tsx';
import { ResetPasswordPage } from './pages/ResetPasswordPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { UsersPage } from './pages/UsersPage.tsx';

/**
 * Rutas de la web. Todas comparten el layout (header con tema e indicadores); las que requieren sesión
 * cuelgan de RequireSession y cada historia agrega ahí sus pantallas.
 */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { path: 'login', element: <LoginPage /> },
      { path: 'primer-admin', element: <FirstAdminPage /> },
      { path: 'recuperar-contrasena', element: <RecoveryRequestPage /> },
      { path: 'restablecer-contrasena/:token', element: <ResetPasswordPage /> },
      {
        element: <RequireSession />,
        children: [
          { index: true, element: <Result title="Aldebaran" subTitle="Facturación y cobranza." /> },
          { path: 'perfil', element: <ProfilePage /> },
          { path: 'configuracion', element: <SettingsPage /> },
          {
            element: <RequireRole roles={['admin']} />,
            children: [{ path: 'usuarios', element: <UsersPage /> }],
          },
          { path: '*', element: <Result status="404" title="Página no encontrada" /> },
        ],
      },
    ],
  },
]);
