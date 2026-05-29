const os = require("os");
const path = require("path");
const { resolveDatesFromRequest } = require("./workCalendar");

const ZMP_URL = "https://zmp.iwhalecloud.com/newZmp#/";
const DEFAULT_CATEGORY = "升级/测试/业务操作";

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function normalizeConfig(config) {
  const requestedDates = await resolveDatesFromRequest(config);
  const selectedDates = [...new Set(config.selectedDates?.length ? config.selectedDates : requestedDates?.dates || [])].sort();
  return {
    url: config.url || ZMP_URL,
    selectedDates,
    requestedDates,
    hours: Number(config.hours || 8),
    workDescription: config.workDescription || "日常维护支持",
    category: config.category || DEFAULT_CATEGORY,
    isTravel: Boolean(config.isTravel),
    loginWaitMs: Number(config.loginWaitMs || 12000),
    stepWaitMs: Number(config.stepWaitMs || 1200),
    userDataDir: config.userDataDir || path.join(os.homedir(), ".zmp-timesheet-agent", "browser-profile")
  };
}

function buildPlanFromNormalized(config, normalized) {
  const dates = normalized.selectedDates;
  const requestNote = normalized.requestedDates
    ? `已按请求识别 ${normalized.requestedDates.month} 月截至 ${normalized.requestedDates.through} 的中国工作日，节假日数据来源：${normalized.requestedDates.holidayDataSource}。`
    : null;
  const requestWarning = normalized.requestedDates?.warning || null;

  return {
    url: normalized.url,
    hours: normalized.hours,
    category: normalized.category,
    workDescription: normalized.workDescription,
    isTravel: normalized.isTravel,
    loginWaitMs: normalized.loginWaitMs,
    stepWaitMs: normalized.stepWaitMs,
    requestText: config.requestText || config.text || config.prompt || "",
    dateSource: normalized.requestedDates?.source || "selectedDates",
    dates,
    totalHours: dates.length * normalized.hours,
    notes: [
      requestNote,
      requestWarning,
      "进入 ZMP 后如出现“一键登录”，先点击并等待飞连登录完成。",
      "进入工作台后搜索“项目任务管理”，直接进入工时单填报页面。",
      "确认查询状态为“待我处理的”，必要时调整后查询。",
      "逐张工时单打开新增任务工时弹窗，按弹窗总工时计算可填天数。",
      "用待填日期队列记录剩余日期，每保存或发现已有一条记录就更新一次。"
    ].filter(Boolean)
  };
}

async function buildPlan(config) {
  const normalized = await normalizeConfig(config);
  return buildPlanFromNormalized(config, normalized);
}

async function requirePlaywright() {
  try {
    return require("playwright");
  } catch (error) {
    throw new Error("缺少 Playwright。请先在当前目录运行 npm install，然后重新启动本工具。");
  }
}

async function clickByText(page, textOrRegex, options = {}) {
  const locator = page.getByText(textOrRegex, { exact: options.exact || false }).first();
  await locator.waitFor({ state: "visible", timeout: options.timeout || 15000 });
  await locator.click();
}

async function fillFirstVisible(locator, value) {
  await locator.first().waitFor({ state: "visible", timeout: 10000 });
  await locator.first().fill(String(value));
}

function keyboardFor(surface) {
  return typeof surface.page === "function" ? surface.page().keyboard : surface.keyboard;
}

async function findWorkbenchSearch(page) {
  const antSelect = page.locator(".ant-select.indexSearch:visible").first();
  if (await antSelect.isVisible({ timeout: 1000 }).catch(() => false)) {
    const input = antSelect.locator("input.ant-select-selection-search-input, input[role='combobox'], input").first();
    return { container: antSelect, input, kind: "ant-select" };
  }

  const inputs = [
    page.locator('input:visible[placeholder*="输入关键字"]').first(),
    page.locator('input:visible[placeholder*="关键字"]').first(),
    page.getByPlaceholder(/输入关键字|关键字/).first()
  ];

  for (const input of inputs) {
    const visible = await input.isVisible({ timeout: 1000 }).catch(() => false);
    if (visible) return { container: input, input, kind: "input" };
  }

  throw new Error("未找到工作台的“输入关键字”搜索框。");
}

async function fillWorkbenchSearch(page, value, log) {
  const search = await findWorkbenchSearch(page);
  await search.container.scrollIntoViewIfNeeded().catch(() => {});
  await search.container.click({ delay: 80 });
  await search.input.waitFor({ state: "attached", timeout: 5000 });
  await search.input.click({ delay: 80 }).catch(() => {});
  await page.keyboard.press("Meta+A").catch(() => {});
  await page.keyboard.press("Control+A").catch(() => {});
  await page.keyboard.press("Backspace").catch(() => {});
  await page.keyboard.type(value, { delay: 80 });
  await search.input.evaluate((element, nextValue) => {
    element.value = nextValue;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);

  const actual = await search.input.inputValue().catch(() => "");
  if (!actual.includes(value)) {
    await search.input.fill(value);
  }

  log(`搜索框已输入：${value}（${search.kind}）`);
  return search;
}

async function triggerWorkbenchSearch(page, search, config, optionText) {
  await page.waitForTimeout(Math.min(config.stepWaitMs, 500));

  const optionLocators = [
    page.locator(".ant-select-dropdown:visible").getByText(optionText, { exact: false }).first(),
    page.getByText(optionText, { exact: false }).last()
  ];

  for (const option of optionLocators) {
    if (await option.isVisible({ timeout: 800 }).catch(() => false)) {
      await option.click({ timeout: 1000, force: true }).catch(() => {});
      await page.waitForTimeout(300);
      return;
    }
  }

  await search.input.press("Enter", { timeout: 1000 }).catch(() => {});
  await page.waitForTimeout(300);

  if (search.kind === "ant-select") return;

  const searchIconNearInput = search.container.locator("xpath=ancestor-or-self::*[contains(@class,'ant-select') or contains(@class,'el-input') or contains(@class,'search')][1]//*[contains(@class,'search') or contains(@class,'Search')]");
  if (await searchIconNearInput.count().catch(() => 0)) {
    await searchIconNearInput.first().click({ timeout: 1000 }).catch(() => {});
    await page.waitForTimeout(300);
  }

  const globalSearchIcon = page.locator(".el-icon-search:visible, .anticon-search:visible").first();
  if (await globalSearchIcon.count().catch(() => 0)) {
    await globalSearchIcon.click({ timeout: 1000 }).catch(() => {});
  }
}

async function settle(page, ms) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: ms }).catch(() => {});
  await page.waitForTimeout(Math.min(ms, 2000));
}

async function waitForQueryStateFrame(page, timeoutMs, log) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    for (const frame of page.frames()) {
      const queryState = frame.locator("#queryState, select[name='queryState']").first();
      if (await queryState.count().catch(() => 0)) {
        log(`已找到查询状态表单，frame：${frame.url() || "main"}`);
        return frame;
      }
    }
    await page.waitForTimeout(500);
  }

  const frameUrls = page.frames().map(frame => frame.url()).filter(Boolean);
  throw new Error(`未找到项目任务管理查询表单 #queryState。当前 frame：${frameUrls.join(" | ") || "无"}`);
}

async function findOneClickLogin(page) {
  const selectors = [
    "button:has-text('一键登录')",
    "button:has-text('一键登陆')",
    "a:has-text('一键登录')",
    "a:has-text('一键登陆')",
    "text=/一键登[录陆]/",
    "[title*='一键登录']",
    "[title*='一键登陆']",
    "[alt*='一键登录']",
    "[alt*='一键登陆']",
    "[class*='login' i]:visible",
    "[class*='feilian' i]:visible"
  ];

  for (const frame of page.frames()) {
    for (const selector of selectors) {
      const locator = frame.locator(selector).first();
      if (await locator.isVisible({ timeout: 500 }).catch(() => false)) {
        return { locator, frameUrl: frame.url() || "main", selector };
      }
    }
  }

  return null;
}

async function completeLoginIfNeeded(page, config, log) {
  log("检查是否需要一键登录。");
  await settle(page, config.stepWaitMs);

  const loginTarget = await findOneClickLogin(page);

  if (!loginTarget) {
    log("未发现一键登录按钮，继续进入工作台。");
    return;
  }

  log(`点击一键登录，等待飞连登录完成。frame=${loginTarget.frameUrl}`);
  await loginTarget.locator.click({ timeout: 5000, force: true });
  await page.waitForTimeout(config.loginWaitMs);

  log("等待工作台搜索框出现。");
  await findWorkbenchSearch(page).then(search => search.container.waitFor({
    state: "visible",
    timeout: 90000
  }));
  await settle(page, config.stepWaitMs);
}

async function openTodoTaskList(page, config, log) {
  log("打开 ZMP 工作台。");
  await page.goto(ZMP_URL, { waitUntil: "domcontentloaded" });
  await settle(page, config.stepWaitMs);
  await completeLoginIfNeeded(page, config, log);

  log("搜索“项目任务管理”。");
  const search = await fillWorkbenchSearch(page, "项目任务管理", log);
  await triggerWorkbenchSearch(page, search, config, "项目任务管理");
  log("等待项目任务管理查询表单出现。");
  const taskFrame = await waitForQueryStateFrame(page, 25000, log);
  await page.waitForTimeout(Math.min(config.stepWaitMs, 800));
  return taskFrame;
}

async function ensureWaitingQuery(page, log) {
  log("确认查询状态为“待我处理的”。");
  const stateSelect = page.locator("#queryState, select[name='queryState']").first();
  await stateSelect.waitFor({ state: "attached", timeout: 20000 });

  const state = await stateSelect.evaluate(select => {
    const selected = select.options[select.selectedIndex];
    return {
      value: select.value,
      text: selected ? selected.textContent.trim() : "",
      options: Array.from(select.options).map(option => ({
        value: option.value,
        text: option.textContent.trim()
      }))
    };
  });

  if (!state.text.includes("待我处理的")) {
    log(`当前查询状态为“${state.text || state.value || "空"}”，切换为“待我处理的”。`);
    const changed = await stateSelect.evaluate(select => {
      const target = Array.from(select.options).find(option =>
        option.textContent.includes("待我处理的") || option.value.includes("待我处理的")
      );
      if (!target) return false;
      select.value = target.value;
      target.selected = true;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    });

    if (!changed) {
      throw new Error(`查询状态下拉中未找到“待我处理的”，可选项：${state.options.map(option => option.text || option.value).join("、")}`);
    }
    await page.waitForTimeout(500);
  } else {
    log("查询状态已经是“待我处理的”。");
  }

  const queryButton = page.getByRole("button", { name: "查询" }).first();
  if (await queryButton.count()) {
    await queryButton.click();
    await page.waitForTimeout(1000);
  }
}

async function readSheetRows(page) {
  const rows = await page.locator("tr:visible").evaluateAll(trs => trs.map((tr, visibleIndex) => {
    const text = (tr.innerText || "").replace(/\s+/g, " ").trim();
    const cellTexts = Array.from(tr.querySelectorAll("td")).map(td => (td.innerText || "").replace(/\s+/g, " ").trim());
    const table = tr.closest("table");
    const headers = table
      ? Array.from(table.querySelectorAll("th")).map(th => (th.innerText || "").replace(/\s+/g, " ").trim())
      : [];
    const orderIndex = headers.findIndex(header => /工单号|工单编号|任务单号|单号/.test(header));
    const orderNoFromColumn = orderIndex >= 0 ? cellTexts[orderIndex] : "";
    const orderNoMatch = `${orderNoFromColumn} ${text}`.match(/\b[A-Za-z]*\d{6,}[A-Za-z0-9_-]*\b/);

    return {
      visibleIndex,
      text,
      orderNo: orderNoMatch ? orderNoMatch[0] : "",
      cellCount: tr.querySelectorAll("td").length,
      hasHeaderCell: Boolean(tr.querySelector("th"))
    };
  }).filter(row => {
    if (!row.text || row.text.length < 8) return false;
    if (row.hasHeaderCell || row.cellCount < 2) return false;
    if (/工时日期|审核状态|工作说明/.test(row.text)) return false;
    return true;
  }));

  const seen = new Set();
  const occurrences = new Map();
  return rows.map(row => {
    const identity = row.orderNo || row.text;
    const occurrence = occurrences.get(identity) || 0;
    occurrences.set(identity, occurrence + 1);
    return { ...row, occurrence };
  }).filter(row => {
    const key = row.orderNo || `${row.text}#${row.occurrence}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(row => ({
    visibleIndex: row.visibleIndex,
    occurrence: row.occurrence,
    orderNo: row.orderNo,
    title: row.text
  }));
}

async function selectSheetByTitle(page, sheet) {
  if (sheet.orderNo) {
    const byOrderNo = page.locator("tr:visible").filter({ hasText: sheet.orderNo }).first();
    if (await byOrderNo.isVisible({ timeout: 1000 }).catch(() => false)) {
      await byOrderNo.click();
      await page.waitForTimeout(800);
      return;
    }
  }

  const titlePart = sheet.title.match(/[\u4e00-\u9fa5A-Za-z]+\s*\d{4}\s*[-~至]\s*\d{4}/);
  const targetText = titlePart ? titlePart[0] : sheet.title.slice(0, 40);
  const matchingRows = page.locator("tr:visible").filter({ hasText: targetText });
  const stableRow = matchingRows.nth(sheet.occurrence || 0);

  if (await stableRow.isVisible({ timeout: 1000 }).catch(() => false)) {
    await stableRow.click();
    await page.waitForTimeout(800);
    return;
  }

  const visibleRow = page.locator("tr:visible").nth(sheet.visibleIndex);
  if (await visibleRow.isVisible({ timeout: 1000 }).catch(() => false)) {
    await visibleRow.click();
    await page.waitForTimeout(800);
    return;
  }

  await page.getByText(targetText, { exact: false }).nth(sheet.occurrence || 0).click();
  await page.waitForTimeout(800);
}

async function existingTimesheetDates(page) {
  await clickByText(page, "任务工时", { exact: true });
  await page.waitForTimeout(800);
  const dates = await page.locator("table:visible").evaluateAll(tables => {
    const timesheetTable = tables.find(table => {
      const text = table.innerText || "";
      return text.includes("工时日期") && text.includes("工时") && text.includes("工作说明");
    });

    if (!timesheetTable) return [];

    return Array.from(timesheetTable.querySelectorAll("tbody tr, tr"))
      .map(row => row.innerText || "")
      .filter(text => !text.includes("工时日期"))
      .flatMap(text => Array.from(text.matchAll(/\b20\d{2}-\d{2}-\d{2}\b/g), match => match[0]));
  });

  return new Set(dates);
}

async function openNewTimesheetDialog(page, log) {
  log("打开新增任务工时弹窗。");
  await page.locator("#button-new:visible, button:visible").filter({ hasText: /^新增$/ }).last().click();
  await page.getByText(/新增.*任务工时/, { exact: false }).waitFor({ state: "visible", timeout: 15000 });
}

function activeDialog(page) {
  return page.locator(".ui-dialog:visible, .el-dialog:visible, .modal:visible, [role='dialog']:visible").last();
}

async function readDialogHoursValue(page, label, selectors) {
  const scope = activeDialog(page);
  await scope.waitFor({ state: "visible", timeout: 10000 });

  const readInput = async () => {
    const inputs = [
      scope.locator(selectors).first(),
      scope.locator(`xpath=.//label[contains(normalize-space(.), ${JSON.stringify(label)})]/following::input[not(@type='hidden')][1]`).first()
    ];

    for (const input of inputs) {
      if (!(await input.count().catch(() => 0))) continue;

      const value = await input.evaluate(element => {
        const candidates = [
          element.value,
          element.defaultValue,
          element.getAttribute("value"),
          element.getAttribute("title"),
          element.getAttribute("data-value")
        ];
        const raw = candidates.find(item => item && /\d/.test(item));
        return raw ? Number(String(raw).match(/\d+(?:\.\d+)?/)?.[0]) : null;
      }).catch(() => null);

      if (Number.isFinite(value)) return value;
    }

    return null;
  };

  const startedAt = Date.now();
  while (Date.now() - startedAt < 10000) {
    const value = await readInput();
    if (Number.isFinite(value)) return value;
    await page.waitForTimeout(500);
  }

  const dialogText = await scope.innerText().catch(() => "");
  const diagnostic = dialogText.replace(/\s+/g, " ").slice(0, 300);
  if (diagnostic) {
    throw new Error(`新增任务工时弹窗中未读到“${label}”的数值。当前弹窗文本片段：${diagnostic}`);
  }

  throw new Error(`新增任务工时弹窗中未读到“${label}”的数值。`);
}

async function readDialogTotalHours(page) {
  return readDialogHoursValue(page, "总工时", "#totalHours, input[name='totalHours']");
}

async function closeActiveDialog(page) {
  const scope = activeDialog(page);
  if (!(await scope.isVisible({ timeout: 500 }).catch(() => false))) return;

  const closeTargets = [
    scope.locator(".ui-dialog-titlebar-close, .el-dialog__headerbtn, button.close").last(),
    scope.locator("button").filter({ hasText: /^取消$/ }).last(),
    scope.locator("button").filter({ hasText: /^关闭$/ }).last()
  ];

  for (const target of closeTargets) {
    if (await target.isVisible({ timeout: 500 }).catch(() => false)) {
      await target.click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
      return;
    }
  }
}

async function clickButtonInScope(scope, name, selector) {
  const byText = scope.locator("button").filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) }).last();
  const button = selector ? scope.locator(selector).last() : byText;
  const target = await button.count().catch(() => 0) ? button : byText;
  await target.waitFor({ state: "attached", timeout: 10000 });
  await target.evaluate(element => element.click());
}

async function setTimesheetDate(page, scope, date) {
  const inputs = [
    scope.locator("xpath=.//label[contains(normalize-space(.), '工时日期')]/following::input[not(@type='hidden')][1]").last(),
    scope.locator("xpath=.//*[contains(normalize-space(.), '工时日期')]/following::input[not(@type='hidden')][1]").last(),
    scope.locator("input:visible[id*='date' i], input:visible[name*='date' i]").last()
  ];
  let input = null;

  for (const candidate of inputs) {
    if (await candidate.isVisible({ timeout: 1200 }).catch(() => false)) {
      input = candidate;
      break;
    }
  }

  if (!input) {
    throw new Error("未找到可填写的工时日期输入框。");
  }

  await input.scrollIntoViewIfNeeded().catch(() => {});
  await input.click({ force: true, timeout: 1500 }).catch(() => {});
  const filledDirectly = await input.fill(date, { timeout: 1500 })
    .then(() => true)
    .catch(() => false);
  await input.evaluate((element, nextValue) => {
    element.value = nextValue;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, date);

  const [, , day] = date.split("-");
  const picker = page.locator(".datetimepicker.datetimepicker-dropdown.dropdown-menu:visible, .datetimepicker-dropdown:visible").last();
  if (!filledDirectly || await picker.isVisible({ timeout: 800 }).catch(() => false)) {
    const dayCell = picker.locator("td.day:not(.old):not(.new), span.day").filter({
      hasText: new RegExp(`^\\s*${Number(day)}\\s*$`)
    }).first();
    if (await dayCell.isVisible({ timeout: 800 }).catch(() => false)) {
      await dayCell.click({ force: true, timeout: 1000 }).catch(() => {});
    }
  }
}

async function fillInputAfterLabel(scope, label, value) {
  const input = scope.locator(
    `xpath=.//label[contains(normalize-space(.), ${JSON.stringify(label)})]/following::input[not(@type='hidden')][1]`
  ).last();
  await fillFirstVisible(input, value);
}

async function fillDescription(scope, value) {
  const textarea = scope.locator(
    "xpath=.//label[contains(normalize-space(.), '工作说明')]/following::textarea[1]"
  ).last();
  await textarea.waitFor({ state: "visible", timeout: 10000 });
  await textarea.fill(value);
}

async function setTravelCheckbox(scope, log) {
  const candidates = [
    scope.locator("xpath=.//*[contains(normalize-space(.), '是否出差')]/following::input[@type='checkbox'][1]").first(),
    scope.locator("label").filter({ hasText: "是否出差" }).locator("input[type='checkbox']").first(),
    scope.locator("input[type='checkbox']").filter({ hasText: "" }).first()
  ];

  for (const checkbox of candidates) {
    const count = await checkbox.count().catch(() => 0);
    if (!count) continue;

    await checkbox.evaluate(element => {
      if (!element.checked) {
        element.click();
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    log("已勾选是否出差。");
    return;
  }

  throw new Error("未找到“是否出差”checkbox。");
}

async function addOneDate(page, date, config, log) {
  log(`新增 ${date}，${config.category} ${config.hours} 小时。`);
  const scope = activeDialog(page);
  await clickButtonInScope(scope, "新增");
  await page.waitForTimeout(500);

  await setTimesheetDate(page, scope, date);

  await fillInputAfterLabel(scope, config.category, config.hours);
  await fillDescription(scope, config.workDescription);

  if (config.isTravel) {
    await setTravelCheckbox(scope, log);
  }
}

async function saveDialog(page, log, date) {
  log(date ? `保存 ${date} 的工时。` : "保存当前弹窗。");
  const scope = activeDialog(page);
  await clickButtonInScope(scope, "保存", "#save-button:visible, button.savebutton:visible");
  await page.waitForTimeout(1200);
}

async function submitSheet(page, log) {
  log("提交当前工时单。");
  await page.getByRole("button", { name: "提交" }).last().click();
  await page.waitForTimeout(1000);
  const confirm = page.getByRole("button", { name: /确定|确认/ }).last();
  if (await confirm.count()) await confirm.click();
}

function removePendingDate(pendingDates, date) {
  const index = pendingDates.indexOf(date);
  if (index !== -1) pendingDates.splice(index, 1);
}

function recordFilledDate(filledDates, date) {
  if (!filledDates.includes(date)) filledDates.push(date);
}

async function runZmpAutomation(rawConfig, log = () => {}) {
  const config = await normalizeConfig(rawConfig);
  const plan = buildPlanFromNormalized(rawConfig, config);
  const result = {
    plan,
    filled: [],
    skipped: [],
    failed: []
  };

  const { chromium } = await requirePlaywright();
  const context = await chromium.launchPersistentContext(config.userDataDir, {
    headless: false,
    viewport: { width: 1440, height: 920 }
  });

  const page = context.pages()[0] || await context.newPage();

  try {
    const taskPage = await openTodoTaskList(page, config, log);
    await ensureWaitingQuery(taskPage, log);

    const sheets = await readSheetRows(taskPage);
    log(`识别到 ${sheets.length} 张待处理工时单。`);

    const pendingDates = [...plan.dates];
    const filledDates = [];

    for (const sheet of sheets) {
      if (!pendingDates.length) break;

      const sheetName = sheet.orderNo ? `工单号 ${sheet.orderNo}` : sheet.title.slice(0, 80);
      log(`处理工时单：${sheetName}。当前待填 ${pendingDates.length} 天：${pendingDates.join("、")}。`);
      await selectSheetByTitle(taskPage, sheet);
      const existing = await existingTimesheetDates(taskPage);
      await openNewTimesheetDialog(taskPage, log);

      const totalHours = await readDialogTotalHours(taskPage);
      const sheetDateCount = Math.floor(totalHours / config.hours);
      log(`弹窗总工时 ${totalHours}，每天 ${config.hours} 小时；当前工时单需要填写 ${sheetDateCount} 个日期。`);

      for (const date of [...pendingDates]) {
        if (!existing.has(date)) continue;
        result.skipped.push({ date, reason: "已存在", sheet: sheetName });
        recordFilledDate(filledDates, date);
        removePendingDate(pendingDates, date);
        log(`跳过 ${date}：当前工时单已有工时记录。剩余待填 ${pendingDates.length} 天。`);
      }

      if (sheetDateCount <= 0) {
        log("当前工时单按总工时计算无需新增日期，切换下一张工时单。");
        await closeActiveDialog(taskPage);
        continue;
      }

      let filledThisSheet = 0;

      while (pendingDates.length && filledThisSheet < sheetDateCount) {
        const date = pendingDates[0];
        try {
          await addOneDate(taskPage, date, config, log);
          await saveDialog(taskPage, log, date);
          existing.add(date);
          recordFilledDate(filledDates, date);
          removePendingDate(pendingDates, date);
          filledThisSheet += 1;
          result.filled.push({ date, hours: config.hours, sheet: sheetName, totalHours });
          log(`${date} 已保存。当前工时单已填 ${filledThisSheet}/${sheetDateCount} 个日期；未填日期：${pendingDates.join("、") || "无"}。`);
        } catch (error) {
          result.failed.push({ date, sheet: sheetName, error: error.message });
          log(`填写 ${date} 失败，保留在未填列表，停止当前工时单以避免后续日期错位：${error.message}`);
          break;
        }
      }

      if (filledThisSheet > 0) {
        if (filledThisSheet >= sheetDateCount) {
          log("当前工时单已按总工时填满日期，执行提交。");
          await submitSheet(taskPage, log);
        } else {
          log(`当前工时单只填了 ${filledThisSheet}/${sheetDateCount} 个日期，暂不提交。`);
          await closeActiveDialog(taskPage);
        }
      } else {
        await closeActiveDialog(taskPage);
      }
    }

    if (pendingDates.length) {
      for (const date of pendingDates) {
        result.skipped.push({ date, reason: "没有足够的工时单容量" });
      }
      log(`所有工时单处理完成后仍有日期未填写：${pendingDates.join("、")}。`);
    }
  } finally {
    log("自动化流程结束，浏览器保留数秒供你确认页面状态。");
    await page.waitForTimeout(3000).catch(() => {});
    await context.close().catch(() => {});
  }

  return result;
}

module.exports = {
  buildPlan,
  runZmpAutomation
};
