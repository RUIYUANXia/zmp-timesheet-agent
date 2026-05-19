#!/usr/bin/env node
const fs = require("fs");

const BASE_URL = process.env.ZMP_AGENT_URL || "http://127.0.0.1:4173";

function usage() {
  console.error("Usage: node scripts/start-job.js (--config <config.json> | --json '<json>' | --stdin)");
  process.exit(2);
}

function parseArgs(argv) {
  const configIndex = argv.indexOf("--config");
  if (configIndex !== -1) {
    if (!argv[configIndex + 1]) usage();
    return { mode: "file", value: argv[configIndex + 1] };
  }

  const jsonIndex = argv.indexOf("--json");
  if (jsonIndex !== -1) {
    if (!argv[jsonIndex + 1]) usage();
    return { mode: "json", value: argv[jsonIndex + 1] };
  }

  if (argv.includes("--stdin")) {
    return { mode: "stdin" };
  }

  usage();
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let body = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => {
      body += chunk;
    });
    process.stdin.on("end", () => resolve(body));
    process.stdin.on("error", reject);
  });
}

async function readConfig(input) {
  if (input.mode === "file") {
    return JSON.parse(fs.readFileSync(input.value, "utf8"));
  }
  if (input.mode === "json") {
    return JSON.parse(input.value);
  }
  return JSON.parse(await readStdin());
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

async function main() {
  const input = parseArgs(process.argv.slice(2));
  const config = await readConfig(input);

  const plan = await requestJson(`${BASE_URL}/api/plan`, {
    method: "POST",
    body: JSON.stringify(config)
  });
  console.log("Plan:");
  console.log(JSON.stringify(plan, null, 2));

  const { id } = await requestJson(`${BASE_URL}/api/jobs`, {
    method: "POST",
    body: JSON.stringify(config)
  });
  console.log(`Started job: ${id}`);

  while (true) {
    const job = await requestJson(`${BASE_URL}/api/jobs/${encodeURIComponent(id)}`);
    const lastLog = job.logs.at(-1);
    if (lastLog) {
      console.log(`[${lastLog.at.slice(11, 19)}] ${lastLog.message}`);
    }

    if (job.status !== "running") {
      console.log(`Status: ${job.status}`);
      if (job.error) console.error(job.error);
      if (job.result) console.log(JSON.stringify(job.result, null, 2));
      process.exit(job.status === "completed" ? 0 : 1);
    }

    await new Promise(resolve => setTimeout(resolve, 1500));
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
