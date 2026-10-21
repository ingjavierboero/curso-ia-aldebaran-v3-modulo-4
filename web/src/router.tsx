import { Result } from 'antd';
import { createBrowserRouter } from 'react-router';
import { AppLayout } from './components/AppLayout.tsx';

/** Rutas de la web; cada historia agrega sus pantallas como hijas del layout. */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Result title="Aldebaran" subTitle="Facturación y cobranza." /> },
      { path: '*', element: <Result status="404" title="Página no encontrada" /> },
    ],
  },
]);
