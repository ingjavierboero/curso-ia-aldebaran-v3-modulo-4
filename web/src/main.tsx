import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { router } from './router.tsx';
import { ThemeProvider } from './theme/theme.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('No se encontró el elemento #root.');

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  </StrictMode>,
);
