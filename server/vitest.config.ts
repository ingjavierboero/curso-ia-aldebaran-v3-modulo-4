import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Los tests nunca usan credenciales reales (AGENTS.md): se vacían aunque el entorno las tenga.
    env: {
      MOCK_MODE: '',
      ANTHROPIC_API_KEY: '',
      GMAIL_USER: '',
      GMAIL_APP_PASSWORD: '',
      ARCA_CUIT: '',
      ARCA_CERT_PATH: '',
      ARCA_KEY_PATH: '',
      SCHEDULER_ENABLED: '',
      EMAIL_REDIRECT_TO: '',
    },
  },
});
