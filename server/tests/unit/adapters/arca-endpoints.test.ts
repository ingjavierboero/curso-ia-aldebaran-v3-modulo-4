import { describe, expect, it } from 'vitest';
import * as endpoints from '../../../src/adapters/arca/endpoints.ts';

// Hosts productivos de ARCA (WSAA y WSFEv1) a los que el MVP nunca debe apuntar (AGENTS.md).
const PRODUCTION_HOSTS = ['wsaa.afip.gov.ar', 'servicios1.afip.gov.ar'];

const urls: string[] = Object.values(endpoints).filter((value) => typeof value === 'string');

describe('endpoints de ARCA (Constitución V, research R-06)', () => {
  it('exporta las URLs de WSAA y de WSFEv1', () => {
    expect(endpoints.WSAA_URL).toBeTypeOf('string');
    expect(endpoints.WSFEV1_URL).toBeTypeOf('string');
  });

  it('todas las URLs son de homologación y usan HTTPS', () => {
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      const { protocol, hostname } = new URL(url);
      expect(protocol).toBe('https:');
      expect(hostname, url).toMatch(/homo/);
    }
  });

  it('ninguna URL apunta a un host productivo de ARCA', () => {
    for (const url of urls) {
      expect(PRODUCTION_HOSTS, url).not.toContain(new URL(url).hostname);
    }
  });
});
