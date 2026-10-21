import { defineConfig } from 'drizzle-kit';

// Genera las migraciones a partir del esquema: npm run db:generate -w server.
// Nunca se editan migraciones ya aplicadas; cada cambio de esquema genera una nueva.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
