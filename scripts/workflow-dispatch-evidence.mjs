import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const wf = readFileSync(resolve(".github/workflows/collector-ci.yml"), "utf8");
const hasDispatch = wf.includes("workflow_dispatch:");
const hasSchedule = /^on:[\s\S]*schedule:/m.test(wf);

const evidence = {
  file: ".github/workflows/collector-ci.yml",
  workflow_dispatch: hasDispatch,
  schedule_enabled: hasSchedule,
  note: "未触发远程 workflow；仅静态核对触发器配置",
  excerpt_on_block: wf.split("\n").slice(0, 8).join("\n"),
};

mkdirSync("/opt/cursor/artifacts", { recursive: true });
writeFileSync(
  "/opt/cursor/artifacts/workflow-dispatch-evidence.json",
  JSON.stringify(evidence, null, 2),
);
console.log(JSON.stringify(evidence));
