import { Navigate, type RouteObject } from 'react-router';
import { AppLayout } from './components/AppLayout.tsx';
import { RequireRole } from './components/RequireRole.tsx';
import { RequireSession } from './components/RequireSession.tsx';
import { ClientDetailPage } from './pages/clients/ClientDetailPage.tsx';
import { ClientsPage } from './pages/clients/ClientsPage.tsx';
import { FirstAdminPage } from './pages/FirstAdminPage.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { InvoicesPage } from './pages/invoices/InvoicesPage.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { ProductsPage } from './pages/products/ProductsPage.tsx';
import { ProfilePage } from './pages/ProfilePage.tsx';
import { RecoveryRequestPage } from './pages/RecoveryRequestPage.tsx';
import { ResetPasswordPage } from './pages/ResetPasswordPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { UsersPage } from './pages/UsersPage.tsx';

/**
 * Rutas de la web. Todas comparten el layout (header con tema e indicadores); las que requieren sesión
 * cuelgan de RequireSession y cada historia agrega ahí sus pantallas. Una ruta inexistente lleva a Inicio.
 */
export const routes: RouteObject[] = [
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
          { index: true, element: <HomePage /> },
          { path: 'clientes', element: <ClientsPage /> },
          { path: 'clientes/:id', element: <ClientDetailPage /> },
          { path: 'productos', element: <ProductsPage /> },
          { path: 'facturas', element: <InvoicesPage /> },
          { path: 'perfil', element: <ProfilePage /> },
          { path: 'configuracion', element: <SettingsPage /> },
          {
            element: <RequireRole roles={['admin']} />,
            children: [{ path: 'usuarios', element: <UsersPage /> }],
          },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
];
