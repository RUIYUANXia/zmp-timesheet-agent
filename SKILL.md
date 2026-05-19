---
name: zmp-timesheet-agent
description: Build, install, modify, troubleshoot, or operate a local browser automation agent for ZMP工时填报 / 项目任务管理. Use when the user asks for automatic ZMP timesheet filling by either front-end date selection or conversational input, Playwright automation for https://zmp.iwhalecloud.com/newZmp#/, 飞连一键登录 handling, 工时单日期范围 splitting, task-hour entry, 是否出差, per-date save, or auto-submit behavior.
---

# ZMP Timesheet Agent

Use this skill to create, tune, or operate a local ZMP timesheet filling tool. The skill includes a working template at `assets/template/`.

## Template

Copy `assets/template/` into the user's chosen workspace when creating a new tool. The template contains:

- `server.js`: local HTTP server and job runner.
- `public/`: date-selection UI, execution logs, dry-run mode, and settings.
- `agent/zmpAgent.js`: Playwright automation for ZMP.
- `scripts/start-job.js`: conversational-mode helper for starting a job from JSON.
- `package.json`: Node dependencies and scripts.

Do not copy `node_modules`. Run `npm install` in the target workspace after copying.

## Two Operating Modes

### Front-End Mode

Use this when the user wants a page to select dates. Start the server with `npm start`, open `http://127.0.0.1:4173`, then let the user choose dates, 工时类型, 工时, 工作说明, and 是否出差.

### Conversational Mode

Use this when the user says something like “帮我填报 5 月 6 到 9 号工时” and expects Codex to ask for missing information. Gather a complete config, show the JSON in the conversation for confirmation, then start the job through the local API or helper script without writing the config into the workspace.

Ask only for missing information:

- 日期：explicit dates or a date range. If the user gives a range, ask whether to include every date in the range or exclude any rest days. Do not infer weekends.
- 每天工时：default to `8` only if the user accepts the default.
- 工时类型：must be one of the ZMP labels, such as `升级/测试/业务操作`.
- 工作说明：ask if not provided.
- 是否出差：ask if not provided.

Build this config shape:

```json
{
  "selectedDates": ["2026-05-06", "2026-05-07"],
  "hours": 8,
  "category": "升级/测试/业务操作",
  "workDescription": "大版本回归 + 维护支持",
  "isTravel": false,
  "submitAfterEachSheet": true,
  "dryRun": false
}
```

If the server is running, pass the confirmed JSON directly:

```bash
npm run start-job -- --json '{"selectedDates":["2026-05-06"],"hours":8,"category":"升级/测试/业务操作","workDescription":"业务操作","isTravel":false,"submitAfterEachSheet":true,"dryRun":false}'
```

If the server is not running, start it with `npm start` first.

## Expected Flow

Implement and preserve this ZMP flow unless the user gives newer screenshots or DOM details:

1. Open `https://zmp.iwhalecloud.com/newZmp#/`.
2. If `一键登录` or `一键登陆` appears, click it and wait for 飞连 login.
3. Search `项目任务管理` from the workbench Ant Select search box.
4. Enter the 项目任务管理 page and locate `#queryState` / `select[name="queryState"]`, including inside iframes.
5. Ensure 查询状态 is `待我处理的`, then click 查询.
6. Read work order titles and parse date ranges such as `0501-0515`.
7. Split selected dates by the work order date range.
8. Open `任务工时`, click outer `新增`, then for each date:
   - click the dialog's inner `新增`,
   - choose/fill `工时日期`,
   - fill the configured hour field such as `升级/测试/业务操作`,
   - fill 工作说明,
   - click 保存 immediately for that date.
9. If `自动提交` is enabled, click 提交 after the last newly saved date in that work order.

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
- Outer and inner `新增` buttons are not necessarily the same DOM id. For the dialog's inner add, prefer a visible dialog scope plus button text `新增`.
- Save is in the active dialog; prefer `#save-button`, `button.savebutton`, or button text `保存`.

## Important Semantics

- Do not auto-filter weekends. The UI may gray weekends, but selected dates are authoritative because China holiday makeup days can fall on weekends.
- Existing-date detection must be scoped to the `任务工时` table only. Do not scan the whole page, because work-order due dates can cause false `已存在` skips.
- Save after every date entry, then add the next date.
- `自动提交` means submit the current work order only after its last newly saved timesheet row.
- Conversational mode should show a generated plan before execution, but execution defaults to real fill and auto-submit once the user confirms.
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
