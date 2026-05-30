---
name: xls-zmp-timesheet-filler
description: Build, install, modify, troubleshoot, or operate a local browser automation agent for ZMP工时填报 / 项目任务管理. Use when the user asks for automatic ZMP timesheet filling by front-end date selection or conversational input, including natural-language requests like “帮我填写本月工时” that require China workday/holiday API lookup, Playwright automation for https://zmp.iwhalecloud.com/newZmp#/, 飞连一键登录 handling, work-order total-hours allocation, task-hour entry, 是否出差, per-date save, and fixed submit behavior.
---

# XLS ZMP Timesheet Filler

Use this skill to operate or tune the bundled local ZMP timesheet filling tool. The runnable app lives directly in this skill directory; do not copy files into the user's workspace for normal use.

## Bundled Tool

Run commands from the skill directory `~/.codex/skills/xls-zmp-timesheet-filler` unless the user is explicitly developing a separate copy. The tool contains:

- `server.js`: local HTTP server and job runner.
- `public/`: date-selection UI, execution logs, and settings.
- `agent/zmpAgent.js`: Playwright automation for ZMP.
- `agent/workCalendar.js`: China workday resolver for “本月工时” using the holiday API plus local cache.
- `scripts/start-job.js`: conversational-mode helper for starting a job from JSON or `--text`.
- `scripts/verify-holiday-api.js`: API/plan smoke test for holiday data.
- `package.json`: Node dependencies and scripts.

If dependencies are missing, run `npm install` once in the skill directory. Do not copy `node_modules` or `.cache`.

## Two Operating Modes

### Front-End Mode

Use this when the user wants a page to select dates. Start the server with `npm start`, open `http://127.0.0.1:4173`, then let the user choose dates, 工时类型, 工时, 工作说明, and 是否出差.

The front end also accepts a natural-language instruction such as `帮我填写本月工时`. If no manual dates are selected, the app resolves the current month-to-date workdays before planning or filling.

### Conversational Mode

Use this when the user says something like “帮我填报 5 月 6 到 9 号工时” and expects Codex to ask for missing information. Gather a complete config, show the JSON in the conversation for confirmation, then start the job through the local API or helper script without writing the config into the workspace.

Ask only for missing information:

- 日期：explicit dates or a date range. If the user gives a range, ask whether to include every date in the range or exclude any rest days. Do not infer weekends.
- 本月工时：if the user says “帮我填写本月工时” or equivalent, set `requestText` instead of manually enumerating dates. The tool resolves current month-to-date China workdays from the holiday API, then allocates dates across work orders by each dialog's `总工时`.
- 每天工时：default to `8` only if the user accepts the default.
- 工时类型：required. There is no default 工时类型. It must be exactly one of these 10 complete labels and no other values:
  `服务台/监控`, `投诉/问题排查&处理`, `升级/测试/业务操作`, `培训`, `部署/配置`, `日常维护/数据治理`, `故障/软硬件BUG处理`, `需求调研`, `管理和沟通`, `割接对账`.
  The `/` characters are part of the label text, not separators. For example, `升级/测试/业务操作` is one complete label, not three choices. Do not invent, translate, abbreviate, normalize, split, or map synonyms for 工时类型. Do not offer `其他`. If the user provides a type outside this list, ask them to choose one of these 10 full labels before execution. When building JSON, `category` must be copied verbatim from this list.
- 工作说明：ask if not provided.
- 是否出差：ask if not provided.

Build this config shape:

```json
{
  "selectedDates": ["2026-05-06", "2026-05-07"],
  "hours": 8,
  "category": "升级/测试/业务操作",
  "workDescription": "大版本回归 + 维护支持",
  "isTravel": false
}
```

If the server is running, pass the confirmed JSON directly:

```bash
npm run start-job -- --json '{"selectedDates":["2026-05-06"],"hours":8,"category":"升级/测试/业务操作","workDescription":"业务操作","isTravel":false}'
```

For current-month workdays, pass natural language directly:

```bash
npm run start-job -- --text '帮我填写本月工时'
```

If the server is not running, start it with `npm start` first.

## Holiday API

For “本月工时”, resolve dates with `https://api.jiejiariapi.com/v1/holidays/{year}`. Treat API entries as authoritative:

- `isOffDay: true`: rest day; exclude it.
- `isOffDay: false`: adjusted workday; include it even if it is Saturday or Sunday.
- missing API entry: use the normal weekday rule; Monday-Friday are workdays, Saturday-Sunday are rest days.

Cache yearly API responses in `.cache/holiday-cache` by default. If the API fails, use cache when available. If both API and cache are unavailable, fall back to weekday-only logic and include the warning in the generated plan.

Support these environment variables:

- `JIEJIARI_API_KEY`: optional API key, sent as `Authorization: Bearer ...`.
- `JIEJIARI_API_BASE_URL`: alternate API base URL.
- `ZMP_HOLIDAY_CACHE_DIR`: custom holiday cache directory.
- `ZMP_DISABLE_HOLIDAY_API=1`: skip network and use cache or weekday fallback.

Before relying on current-month natural-language filling in a new environment, run:

```bash
npm run verify-holiday-api -- --year 2026 --today 2026-05-20
```

Expected 2026-05-20 sample dates are `2026-05-06` through `2026-05-09`, `2026-05-11` through `2026-05-15`, and `2026-05-18` through `2026-05-20`.

## Expected Flow

Implement and preserve this ZMP flow unless the user gives newer screenshots or DOM details:

1. Open `https://zmp.iwhalecloud.com/newZmp#/`.
2. If `一键登录` or `一键登陆` appears, click it and wait for 飞连 login.
3. Search `项目任务管理` from the workbench Ant Select search box.
4. Enter the 项目任务管理 page and locate `#queryState` / `select[name="queryState"]`, including inside iframes.
5. Ensure 查询状态 is `待我处理的`, then click 查询.
6. Read pending work-order rows and identify each row by 工单号 when available. Do not rely on title date ranges for allocation; titles can be inaccurate and submitted work orders may remain in `待我处理的`.
7. Open one work order at a time, enter `任务工时`, click outer `新增`, and read the dialog's `总工时` from `#totalHours` / `input[name="totalHours"]`. Compute how many dates this work order should receive as `Math.floor(totalHours / dailyHours)`.
8. Fill that many dates from the pending-date list, one row at a time:
   - click the dialog's inner `新增`,
   - find `工时日期`, directly fill `YYYY-MM-DD` when possible; if the picker opens, select the day from `.datetimepicker.datetimepicker-dropdown.dropdown-menu`,
   - find the configured hour field using the chosen complete 工时类型 label and fill the daily hours,
   - find 工作说明 and fill it,
   - click 保存 immediately for that date.
9. Always click 提交 after this work order has received the number of dates computed from `总工时`. Then move to the next distinct 工单号 and continue with the remaining dates.

## Current DOM Knowledge

Prefer these selectors and behaviors before inventing new ones:

- Workbench search is an Ant Design searchable select:
  `.ant-select.indexSearch`
  with inner input `input.ant-select-selection-search-input` or `input[role="combobox"]`.
- 查询状态 may be a hidden select:
  `#queryState` or `select[name="queryState"]`.
- Project task pages may be inside iframes; scan `page.frames()` for `#queryState` and continue automation in the matching frame.
- The date picker may appear as:
  `.datetimepicker.datetimepicker-dropdown.dropdown-menu`.
- The task-hours dialog exposes `总工时(小时)` as a disabled input with `id="totalHours"`:
  `input#totalHours.form-control[disabled][type="text"]`.
- `已填报工时` may be present, but do not use it to decide how many dates to fill. Use `总工时 / dailyHours`.
- Outer and inner `新增` buttons are not necessarily the same DOM id. For the dialog's inner add, prefer a visible dialog scope plus button text `新增`.
- Save is in the active dialog; prefer `#save-button`, `button.savebutton`, or button text `保存`.

## Important Semantics

- Do not auto-filter weekends. The UI may gray weekends, but selected dates are authoritative because China holiday makeup days can fall on weekends.
- For natural-language “本月工时”, do not hardcode yearly holidays. Use `agent/workCalendar.js`, the holiday API, and cache/fallback semantics above.
- Do not allocate dates by parsing the work-order title date range. Use the order's `总工时` to decide how many dates to fill in that order.
- De-duplicate work orders by 工单号 when possible. A submitted work order may remain in `待我处理的`, so row status alone is not enough to avoid re-clicking the same work order.
- Existing-date detection must be scoped to the `任务工时` table only. Do not scan the whole page, because work-order due dates can cause false `已存在` skips.
- Save after every date entry, then add the next date.
- Submission is fixed on: submit the current work order after it has received the number of dates computed from `总工时 / dailyHours`.
- Each job should attempt browser automation only once. Do not retry automatically after login, navigation, selector, or fill failures.
- After a job completes or fails, close the local HTTP server and release its port. Leave only a short delay for the CLI/frontend to read the final result.
- Conversational mode should show a generated plan before execution, but execution defaults to real fill and fixed submit behavior once the user confirms.
- Do not create persistent config JSON files in the workspace for conversational runs. Use inline JSON, stdin, or an ephemeral temp file only if shell quoting makes inline JSON impractical.

## Tuning Workflow

When the user reports a failure:

1. Read the latest execution log and identify the exact failed step.
2. Ask for or use screenshots/DOM snippets when selectors are ambiguous.
3. Patch the smallest relevant selector or sequencing rule.
4. Run `npm run check`.
5. Restart the local server so changed code is loaded.
6. Tell the user what log line should confirm the fix.

For live ZMP runs, avoid destructive browser actions. Prefer visible logs and short waits keyed to concrete elements (`#queryState`, dialog title, visible table) over long fixed sleeps.
