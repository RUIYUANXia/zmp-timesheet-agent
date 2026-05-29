#!/usr/bin/env node
const { buildPlan } = require("../agent/zmpAgent");
const { verifyHolidayApi } = require("../agent/workCalendar");

function parseArgs(argv) {
  const options = {
    year: new Date().getFullYear(),
    today: null,
    requestText: "帮我填写本月工时",
    refreshHolidayCache: true
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--year") options.year = Number(argv[++i]);
    else if (arg === "--today") options.today = argv[++i];
    else if (arg === "--text") options.requestText = argv[++i];
    else if (arg === "--cache-dir") options.holidayCacheDir = argv[++i];
    else if (arg === "--help") {
      console.log("Usage: node scripts/verify-holiday-api.js [--year 2026] [--today 2026-05-20] [--text '帮我填写本月工时'] [--cache-dir ./.cache/holiday-cache]");
      process.exit(0);
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const api = await verifyHolidayApi(options.year, options);
  const planConfig = {
    requestText: options.requestText,
    today: options.today || `${options.year}-05-20`,
    refreshHolidayCache: true,
    holidayCacheDir: options.holidayCacheDir
  };
  const plan = await buildPlan(planConfig);

  console.log(JSON.stringify({
    api,
    plan: {
      dateSource: plan.dateSource,
      dates: plan.dates,
      totalHours: plan.totalHours,
      notes: plan.notes
    }
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
