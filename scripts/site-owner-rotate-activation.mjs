#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";

async function main() {
  const args = process.argv.slice(2);
  const sqlOutIdx = args.indexOf("--sql-out");
  if (sqlOutIdx < 0) {
    console.error(
      "用法: node scripts/site-owner-rotate-activation.mjs --login <id> --out <token-file> --sql-out <sql-file>",
    );
    process.exit(1);
  }

  const supersedeSql = args[sqlOutIdx + 1].replace(/\.sql$/, ".supersede.sql");
  await writeFile(
    supersedeSql,
    `UPDATE site_owner_activation SET superseded_at = datetime('now') WHERE consumed_at IS NULL AND superseded_at IS NULL;\n`,
  );

  execSync(`node scripts/site-owner-prepare-activation.mjs ${args.join(" ")}`, { stdio: "inherit" });

  console.log(JSON.stringify({ ok: true, supersedeSql }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
