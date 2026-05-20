const fs = require("fs/promises");
const path = require("path");

const DEFAULT_API_BASE_URL = "https://api.jiejiariapi.com";

function pad(value) {
  return String(value).padStart(2, "0");
}

function toDateString(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDateString(value) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`日期格式不正确：${value}`);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function wantsCurrentMonthWorkdays(text) {
  const normalized = String(text || "").replace(/\s+/g, "");
  return /(?:本月|这个月|当前月|当月).*(?:工时|填报|填写)|(?:工时|填报|填写).*(?:本月|这个月|当前月|当月)/.test(normalized);
}

function holidayCacheDir(config = {}) {
  return config.holidayCacheDir
    || process.env.ZMP_HOLIDAY_CACHE_DIR
    || path.join(__dirname, "..", ".cache", "holiday-cache");
}

function holidayCacheFile(year, config = {}) {
  return path.join(holidayCacheDir(config), `${year}.json`);
}

function normalizeHolidayData(payload) {
  const source = payload?.data && typeof payload.data === "object" && !Array.isArray(payload.data)
    ? payload.data
    : payload;

  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("节假日 API 返回格式不是对象。");
  }

  const entries = Object.entries(source);
  if (!entries.length) throw new Error("节假日 API 返回为空。");

  return Object.fromEntries(entries.map(([date, detail]) => {
    if (!detail || typeof detail.isOffDay !== "boolean") {
      throw new Error(`节假日 API 返回缺少 isOffDay：${date}`);
    }
    return [date, {
      date: detail.date || date,
      name: detail.name || "",
      isOffDay: detail.isOffDay
    }];
  }));
}

async function readCachedHolidayData(year, config = {}) {
  try {
    const raw = await fs.readFile(holidayCacheFile(year, config), "utf8");
    const cached = JSON.parse(raw);
    return {
      data: normalizeHolidayData(cached.data || cached),
      source: "cache",
      fetchedAt: cached.fetchedAt || null
    };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeCachedHolidayData(year, data, config = {}) {
  const file = holidayCacheFile(year, config);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({
    source: "jiejiariapi",
    fetchedAt: new Date().toISOString(),
    data
  }, null, 2));
}

async function fetchHolidayData(year, config = {}) {
  const baseUrl = config.holidayApiBaseUrl || process.env.JIEJIARI_API_BASE_URL || DEFAULT_API_BASE_URL;
  const apiKey = config.holidayApiKey || process.env.JIEJIARI_API_KEY || "";
  const url = new URL(`/v1/holidays/${year}`, baseUrl);
  const headers = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(url, { headers });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.message || payload?.error || `HTTP ${response.status}`;
    throw new Error(`节假日 API 请求失败：${message}`);
  }

  return normalizeHolidayData(payload);
}

async function verifyHolidayApi(year = new Date().getFullYear(), config = {}) {
  const data = await fetchHolidayData(year, config);
  const dates = Object.keys(data).sort();
  const offDays = dates.filter(date => data[date].isOffDay);
  const adjustedWorkdays = dates.filter(date => data[date].isOffDay === false);

  return {
    year,
    totalSpecialDates: dates.length,
    offDays: offDays.length,
    adjustedWorkdays: adjustedWorkdays.length,
    firstDate: dates[0] || null,
    lastDate: dates.at(-1) || null
  };
}

async function loadHolidayData(year, config = {}) {
  const cached = await readCachedHolidayData(year, config);
  if (cached && config.refreshHolidayCache !== true) return cached;

  if (config.disableHolidayApi || process.env.ZMP_DISABLE_HOLIDAY_API === "1") {
    return cached || {
      data: {},
      source: "weekend-fallback",
      fetchedAt: null,
      warning: "未请求节假日 API，仅按周六周日判断。"
    };
  }

  try {
    const data = await fetchHolidayData(year, config);
    await writeCachedHolidayData(year, data, config);
    return {
      data,
      source: "jiejiariapi",
      fetchedAt: new Date().toISOString()
    };
  } catch (error) {
    if (cached) {
      return {
        ...cached,
        warning: `节假日 API 请求失败，已使用本地缓存：${error.message}`
      };
    }
    return {
      data: {},
      source: "weekend-fallback",
      fetchedAt: null,
      warning: `节假日 API 请求失败，且没有本地缓存；仅按周六周日判断：${error.message}`
    };
  }
}

function isWorkdayWithHolidayData(dateString, holidayData) {
  const override = holidayData[dateString];
  if (override) return override.isOffDay === false;
  return !isWeekend(parseDateString(dateString));
}

async function currentMonthWorkdays(options = {}) {
  const today = options.today ? parseDateString(options.today) : new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const start = new Date(year, month, 1);
  const holidayResult = options.holidayData
    ? { data: normalizeHolidayData(options.holidayData), source: "provided", fetchedAt: null }
    : await loadHolidayData(year, options);
  const dates = [];

  for (let cursor = start; cursor <= today; cursor = addDays(cursor, 1)) {
    const value = toDateString(cursor);
    if (isWorkdayWithHolidayData(value, holidayResult.data)) dates.push(value);
  }

  return {
    dates,
    month: `${year}-${pad(month + 1)}`,
    through: toDateString(today),
    holidayDataSource: holidayResult.source,
    holidayDataFetchedAt: holidayResult.fetchedAt,
    warning: holidayResult.warning || null
  };
}

async function resolveDatesFromRequest(config) {
  const text = config.requestText || config.text || config.prompt || "";
  if (!text || !wantsCurrentMonthWorkdays(text)) return null;

  return {
    source: "current-month-workdays",
    ...await currentMonthWorkdays(config)
  };
}

module.exports = {
  currentMonthWorkdays,
  isWorkdayWithHolidayData,
  loadHolidayData,
  resolveDatesFromRequest,
  toDateString,
  verifyHolidayApi,
  wantsCurrentMonthWorkdays
};
