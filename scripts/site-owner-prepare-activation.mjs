#!/usr/bin/env node
/**
 * 离线生成站主激活令牌（明文仅写入 --out 文件 mode 0600）与仅含哈希的 D1 SQL。
 * 禁止将令牌打印到 stdout / 报告。
 */
import { randomBytes } from "node:crypto";
import { writeFile, chmod, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

function parseArgs(argv) {
  const out = {
    login: "",
    ttlMinutes: 120,
    tokenOut: "",
    sqlOut: "",
    metaOut: "",
    rotation: 1,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--login" && argv[i + 1]) out.login = argv[++i];
    else if (a === "--ttl-minutes" && argv[i + 1]) out.ttlMinutes = parseInt(argv[++i], 10);
    else if (a === "--out" && argv[i + 1]) out.tokenOut = argv[++i];
    else if (a === "--meta-out" && argv[i + 1]) out.metaOut = argv[++i];
    else if (a === "--sql-out" && argv[i + 1]) out.sqlOut = argv[++i];
    else if (a === "--rotation" && argv[i + 1]) out.rotation = parseInt(argv[++i], 10);
  }
  return out;
}

async function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function normalizeLogin(login, domain = "staging.local") {
  const t = login.trim().toLowerCase();
  if (t.includes("@")) return t;
  return `${t}@${domain}`;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.login || !args.tokenOut || !args.sqlOut) {
    console.error(
      "用法: node scripts/site-owner-prepare-activation.mjs --login <id> --out <0600-file> --sql-out <hash.sql> [--ttl-minutes 120]",
    );
    process.exit(1);
  }

  const token = randomBytes(32).toString("base64url");
  const hash = await sha256Hex(token);
  const loginId = normalizeLogin(args.login);
  const id = `soa_${hash.slice(0, 16)}`;
  const exp = new Date(Date.now() + args.ttlMinutes * 60_000).toISOString();

  await mkdir(resolve(args.tokenOut, ".."), { recursive: true });
  await mkdir(resolve(args.sqlOut, ".."), { recursive: true });
  // 明文令牌：仅单行秘密（供 Secure Form / 粘贴）；元数据单独文件
  await writeFile(args.tokenOut, `${token}\n`, { mode: 0o600 });
  await chmod(args.tokenOut, 0o600);
  const metaPath = args.metaOut || `${args.tokenOut}.meta.json`;
  await writeFile(
    metaPath,
    JSON.stringify(
      {
        purpose: "site_owner_activation",
        loginId,
        expiresAt: exp,
        tokenFile: args.tokenOut,
        note: "tokenFile 仅含单行令牌；勿将本 JSON 填入浏览器令牌框",
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );

  const sql = `-- 仅哈希入库；父端: wrangler d1 execute ... --file 本文件\n`;
  const insert = `INSERT INTO site_owner_activation (id, login_id, token_hash, expires_at, created_at, rotation_seq)
VALUES ('${id}', '${loginId.replace(/'/g, "''")}', '${hash}', '${exp}', datetime('now'), ${args.rotation});
`;
  await writeFile(args.sqlOut, sql + insert);

  const summary = {
    ok: true,
    loginId,
    expiresAt: exp,
    tokenFile: args.tokenOut,
    metaFile: args.metaOut || `${args.tokenOut}.meta.json`,
    sqlFile: args.sqlOut,
    tokenHashPrefix: `${hash.slice(0, 8)}…`,
    note: "明文令牌未写入 stdout；请通过安全通道交给站主",
  };
  console.log(JSON.stringify(summary));
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
