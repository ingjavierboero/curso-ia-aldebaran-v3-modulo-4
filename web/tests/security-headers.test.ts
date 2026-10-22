// @vitest-environment node
import { describe, expect, it } from 'vitest';
import viteConfig from '../vite.config.ts';

/** Directivas de una Content-Security-Policy: nombre → fuentes. */
function cspDirectives(header: unknown): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of String(header ?? '').split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) directives.set(name, sources);
  }
  return directives;
}

const devCsp = cspDirectives(viteConfig.server?.headers?.['Content-Security-Policy']);
const previewCsp = cspDirectives(viteConfig.preview?.headers?.['Content-Security-Policy']);

describe('CSP de la web servida por Vite (AC-256, research R-16)', () => {
  it('AC-256: la web compilada (vite preview) solo permite scripts propios', () => {
    expect(previewCsp.get('default-src')).toEqual(["'self'"]);
    expect(previewCsp.get('script-src')).toEqual(["'self'"]);
    expect(previewCsp.get('frame-ancestors')).toEqual(["'none'"]);
  });

  it('en desarrollo solo agrega el script inline de la recarga en caliente', () => {
    expect(devCsp.get('script-src')).toEqual(["'self'", "'unsafe-inline'"]);
    const rest = (csp: Map<string, string[]>) => [...csp].filter(([name]) => name !== 'script-src');
    expect(rest(devCsp)).toEqual(rest(previewCsp));
  });
});
