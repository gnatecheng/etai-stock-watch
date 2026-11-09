import { beforeAll } from "vitest";
import { applyD1Migrations, env } from "cloudflare:test";

declare const __TEST_D1_MIGRATIONS__: string;

beforeAll(async () => {
  const migrations = JSON.parse(__TEST_D1_MIGRATIONS__) as Parameters<
    typeof applyD1Migrations
  >[1];
  await applyD1Migrations(env.DB, migrations);
});
