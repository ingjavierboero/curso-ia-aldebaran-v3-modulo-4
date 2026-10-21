import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DatabasePathError, resolveDatabasePath, resolveMode } from '../../../src/config/mode.ts';

const root = '/repo';
const mockDb = resolve(root, 'data/aldebaran-mock.db');

describe('resolveMode (RF-184)', () => {
  it('RF-184: el modo mock se activa solo con MOCK_MODE === "true"', () => {
    expect(resolveMode({ MOCK_MODE: 'true' })).toBe('mock');
  });

  it('AC-195: con cualquier otro valor o sin la variable, el sistema usa los servicios reales (homologación)', () => {
    for (const value of [undefined, '', 'false', 'TRUE', 'True', '1', 'yes', ' true']) {
      expect(resolveMode({ MOCK_MODE: value })).toBe('homologacion');
    }
    expect(resolveMode({})).toBe('homologacion');
  });
});

describe('resolveDatabasePath (RF-211 a RF-213)', () => {
  it('AC-209, RF-211: en mock usa siempre data/aldebaran-mock.db, sin tener en cuenta DATABASE_PATH', () => {
    expect(resolveDatabasePath('mock', {}, root)).toBe(mockDb);
    expect(resolveDatabasePath('mock', { DATABASE_PATH: 'data/aldebaran.db' }, root)).toBe(mockDb);
    expect(resolveDatabasePath('mock', { DATABASE_PATH: '/otra/ruta/base.db' }, root)).toBe(mockDb);
  });

  it('fuera de mock usa DATABASE_PATH o, sin ella, data/aldebaran.db, relativas a la raíz del repo', () => {
    expect(resolveDatabasePath('homologacion', {}, root)).toBe(resolve(root, 'data/aldebaran.db'));
    expect(resolveDatabasePath('homologacion', { DATABASE_PATH: '' }, root)).toBe(resolve(root, 'data/aldebaran.db'));
    expect(resolveDatabasePath('homologacion', { DATABASE_PATH: 'otra/base.db' }, root)).toBe(resolve(root, 'otra/base.db'));
    expect(resolveDatabasePath('homologacion', { DATABASE_PATH: '/var/lib/aldebaran.db' }, root)).toBe(
      '/var/lib/aldebaran.db',
    );
  });

  it('AC-210, RF-212, RF-213: fuera de mock rechaza DATABASE_PATH apuntando a la base mock, aunque esté escrita distinto', () => {
    for (const path of ['data/aldebaran-mock.db', './data/../data/aldebaran-mock.db', `${root}/data/aldebaran-mock.db`]) {
      expect(() => resolveDatabasePath('homologacion', { DATABASE_PATH: path }, root)).toThrow(DatabasePathError);
    }
  });

  it('AC-210: el mensaje de error informa el motivo para que el sistema no arranque', () => {
    expect(() => resolveDatabasePath('homologacion', { DATABASE_PATH: 'data/aldebaran-mock.db' }, root)).toThrow(
      /modo mock/,
    );
  });
});
