import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll } from 'vitest';

interface TestMigration {
  name: string;
  queries: string[];
}

beforeAll(async () => {
  const migrations = (env as typeof env & { TEST_MIGRATIONS: TestMigration[] }).TEST_MIGRATIONS;
  await applyD1Migrations(env.DB, migrations);
});
