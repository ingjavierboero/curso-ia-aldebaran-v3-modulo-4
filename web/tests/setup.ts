import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Sin `globals` de Vitest, Testing Library no limpia el DOM sola entre tests.
afterEach(() => cleanup());

// jsdom no implementa matchMedia, que usan antd y el selector de tema. Los tests que corren en el
// entorno node (por ejemplo, el de la configuración de Vite) no tienen window.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
