/**
 * 生成本地安全 staging 部署包（无凭据、不调用 Cloudflare API）
 */
import { execSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  createReadStream,
} from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { pipeline } from "node:stream/promises";

const ROOT = process.cwd();
const ART = "/opt/cursor/artifacts";
const BUNDLE = resolve(ART, "staging-deploy-bundle");

/** 拒绝随机构建/日志泄漏的密钥；允许 env 内用于「生产拒绝默认凭据」的常量字符串 */
const FORBIDDEN_PATTERNS = [
  /test-import-[a-f0-9]{8,}/i,
  /IMPORT_MACHINE_API_KEY\s*[:=]\s*["'][\w-]{12,}/,
  /Bearer\s+[A-Za-z0-9_-]{24,}/,
  /MARKET_DATA_API_KEY\s*[:=]\s*["'][^"']{8,}/,
];

function gitSha() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function scanBundleForSecrets(dir) {
  const hits = [];
  function walk(p) {
    for (const name of readdirSync(p)) {
      const fp = join(p, name);
      const st = statSync(fp);
      if (st.isDirectory()) walk(fp);
      else if (/\.(js|mjs|json|html|css)$/.test(name)) {
        const text = readFileSync(fp, "utf8");
        for (const pat of FORBIDDEN_PATTERNS) {
          if (pat.test(text)) hits.push({ file: fp, pattern: pat.toString() });
        }
      }
    }
  }
  walk(dir);
  return hits;
}

async function sha256File(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function main() {
  mkdirSync(ART, { recursive: true });
  execSync("npm run typecheck", { cwd: ROOT, stdio: "inherit" });
  execSync("npm run build", { cwd: ROOT, stdio: "inherit" });

  mkdirSync(BUNDLE, { recursive: true });
  cpSync(resolve(ROOT, "dist/worker"), resolve(BUNDLE, "dist/worker"), { recursive: true });
  cpSync(resolve(ROOT, "dist/client"), resolve(BUNDLE, "dist/client"), { recursive: true });
  cpSync(resolve(ROOT, "migrations"), resolve(BUNDLE, "migrations"), { recursive: true });
  cpSync(resolve(ROOT, "wrangler.staging.toml"), resolve(BUNDLE, "wrangler.staging.toml"));
  cpSync(
    resolve(ROOT, "docs/deploy-staging-package.md"),
    resolve(BUNDLE, "docs/deploy-staging-package.md"),
  );

  const migrations = readdirSync(resolve(BUNDLE, "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const secretHits = scanBundleForSecrets(resolve(BUNDLE, "dist"));
  if (secretHits.length) {
    console.error(JSON.stringify({ error: "forbidden patterns in bundle", secretHits }, null, 2));
    process.exit(1);
  }

  const commit = gitSha();
  const manifest = {
    generatedAt: new Date().toISOString(),
    gitCommit: commit,
    workerEntry: "dist/worker/index.js",
    staticAssetsDir: "dist/client",
    wranglerConfig: "wrangler.staging.toml",
    suggestedWorkerName: "etai-stock-watch-staging",
    suggestedD1Name: "etai-stock-watch-staging-db",
    migrationApplyOrder: migrations,
    migrationCommands: [
      "wrangler d1 migrations apply etai-stock-watch-staging-db --remote --config wrangler.staging.toml",
    ],
    requiredBindings: {
      D1: { binding: "DB", database_name: "etai-stock-watch-staging-db" },
      Assets: { binding: "ASSETS", directory: "dist/client" },
    },
    requiredVars: {
      APP_ENV: "production",
      DATA_PROVIDER: "none",
      EOD_CRON_ENABLED: "false",
      DATA_DISTRIBUTION_LICENSED: "false",
    },
    optionalSecrets: [
      "IMPORT_MACHINE_API_KEY",
      "MARKET_DATA_API_KEY",
      "BOOTSTRAP_ADMIN_EMAIL",
      "BOOTSTRAP_ADMIN_PASSWORD",
    ],
    secretsNote: "部署包不含 Secret；未配置 IMPORT_MACHINE_API_KEY 时导入 API fail-closed",
    deploySafeWithoutSecrets: true,
    cronEnabled: false,
    notIncluded: ["凭据", "远程 workflow 执行", "定时采集", "数据分发许可"],
    bundlePath: BUNDLE,
  };

  writeFileSync(resolve(BUNDLE, "MANIFEST.json"), JSON.stringify(manifest, null, 2));

  const zipName = `etai-stock-watch-staging-${commit.slice(0, 12)}.zip`;
  const zipPath = resolve(ART, zipName);
  execSync(`cd "${BUNDLE}" && zip -qr "${zipPath}" .`, { stdio: "inherit" });

  const checksum = await sha256File(zipPath);
  const checksumLine = `${checksum}  ${zipName}\n`;
  writeFileSync(resolve(ART, "staging-deploy-sha256.txt"), checksumLine);

  const report = { ...manifest, zipPath, zipName, sha256: checksum };
  writeFileSync(resolve(ART, "staging-deploy-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
