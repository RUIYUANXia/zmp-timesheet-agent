const calendar = document.querySelector("#calendar");
const monthLabel = document.querySelector("#monthLabel");
const output = document.querySelector("#output");
const statusEl = document.querySelector("#status");
const selected = new Set();

let cursor = new Date();
cursor.setDate(1);

function iso(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function mondayIndex(date) {
  return (date.getDay() + 6) % 7;
}

function isWeekend(date) {
  return date.getDay() === 0 || date.getDay() === 6;
}

function renderCalendar() {
  calendar.innerHTML = "";
  monthLabel.textContent = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;

  const first = new Date(cursor);
  const offset = mondayIndex(first);
  for (let i = 0; i < offset; i += 1) {
    const blank = document.createElement("div");
    blank.className = "day is-empty";
    calendar.appendChild(blank);
  }

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const days = new Date(year, month + 1, 0).getDate();

  for (let day = 1; day <= days; day += 1) {
    const date = new Date(year, month, day);
    const value = iso(date);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "day";
    button.textContent = day;
    if (isWeekend(date)) button.classList.add("is-weekend");
    if (selected.has(value)) button.classList.add("is-selected");
    button.addEventListener("click", () => {
      if (selected.has(value)) selected.delete(value);
      else selected.add(value);
      renderCalendar();
    });
    calendar.appendChild(button);
  }
}

function collectConfig() {
  return {
    requestText: document.querySelector("#requestText").value.trim(),
    selectedDates: [...selected].sort(),
    hours: Number(document.querySelector("#hours").value || 8),
    category: document.querySelector("#category").value,
    workDescription: document.querySelector("#workDescription").value.trim(),
    isTravel: document.querySelector("#isTravel").checked,
    loginWaitMs: Number(document.querySelector("#loginWaitSeconds").value || 12) * 1000,
    stepWaitMs: Number(document.querySelector("#stepWaitSeconds").value || 1.2) * 1000
  };
}

function show(value) {
  output.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

async function preview() {
  statusEl.textContent = "计划已生成";
  const plan = await requestJson("/api/plan", {
    method: "POST",
    body: JSON.stringify(collectConfig())
  });
  show(plan);
}

async function pollJob(id) {
  const job = await requestJson(`/api/jobs/${encodeURIComponent(id)}`);
  const logText = job.logs.map(item => `[${item.at.slice(11, 19)}] ${item.message}`).join("\n");
  const resultText = job.result ? `\n\n结果：\n${JSON.stringify(job.result, null, 2)}` : "";
  const errorText = job.error ? `\n\n错误：\n${job.error}` : "";
  show(`${logText || "任务已启动，等待日志..."}${resultText}${errorText}`);
  statusEl.textContent = job.status;

  if (job.status === "running") {
    window.setTimeout(() => pollJob(id), 1200);
  }
}

async function start() {
  const config = collectConfig();
  if (!config.selectedDates.length && !config.requestText) {
    show("请先选择至少一个日期，或输入“帮我填写本月工时”。");
    return;
  }

  statusEl.textContent = "启动中";
  const job = await requestJson("/api/jobs", {
    method: "POST",
    body: JSON.stringify(config)
  });
  pollJob(job.id);
}

document.querySelector("#prevMonth").addEventListener("click", () => {
  cursor.setMonth(cursor.getMonth() - 1);
  renderCalendar();
});

document.querySelector("#nextMonth").addEventListener("click", () => {
  cursor.setMonth(cursor.getMonth() + 1);
  renderCalendar();
});

document.querySelector("#selectMonth").addEventListener("click", () => {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const days = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= days; day += 1) {
    const date = new Date(year, month, day);
    selected.add(iso(date));
  }
  renderCalendar();
});

document.querySelector("#clearDates").addEventListener("click", () => {
  selected.clear();
  renderCalendar();
});

document.querySelector("#preview").addEventListener("click", () => {
  preview().catch(error => show(error.message));
});

document.querySelector("#start").addEventListener("click", () => {
  start().catch(error => show(error.message));
});

renderCalendar();
