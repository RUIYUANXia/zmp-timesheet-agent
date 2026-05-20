# ZMP 工时自动填报 Agent

本工具包含一个本地前端和一个 Playwright 浏览器自动化 agent。可以通过前端选择日期，也可以由 Codex 在对话中收集配置后直接启动填报。

## 运行

```bash
npm install
npm start
```

打开 `http://localhost:4173`。

## 两种使用方式

### 前端方式

打开页面，选择日期、工时类型、每天工时、工作说明和是否出差，然后点击 `生成计划` 或 `开始填报`。

### 对话方式

让 Codex 收集以下信息后，在对话中展示 JSON 配置；用户确认正确后直接启动任务，不在工作区生成配置文件：

- 填报日期或时间范围
- 每天工时
- 工时类型
- 工作说明
- 是否出差

也可以直接使用自然语言日期请求。比如在前端输入 `帮我填写本月工时`，或通过命令行传入 `--text`。工具会按提交请求当天统计本月截至当天的中国工作日，并通过节假日 API 获取法定休息日和调休工作日。首次查询某一年会缓存结果，后续优先使用缓存；如果 API 和缓存都不可用，会退回到仅按周六周日判断，并在计划备注里提示。

配置示例：

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

本地服务启动后，可以运行：

```bash
npm run start-job -- --json '{"selectedDates":["2026-05-06"],"hours":8,"category":"升级/测试/业务操作","workDescription":"业务操作","isTravel":false,"submitAfterEachSheet":true,"dryRun":false}'
```

自然语言请求示例：

```bash
npm run start-job -- --text '帮我填写本月工时'
```

节假日 API 默认使用 `https://api.jiejiariapi.com/v1/holidays/{year}`。如需配置 API Key，可设置环境变量：

```bash
export JIEJIARI_API_KEY='你的 API KEY'
```

可选环境变量：

- `JIEJIARI_API_BASE_URL`：自定义节假日 API 地址。
- `ZMP_HOLIDAY_CACHE_DIR`：自定义节假日缓存目录，默认是项目内 `.cache/holiday-cache`。
- `ZMP_DISABLE_HOLIDAY_API=1`：禁用 API，只使用缓存或周末兜底。

验证节假日 API 可用性：

```bash
npm run verify-holiday-api -- --year 2026 --today 2026-05-20
```

## 当前流程

1. 打开 `https://zmp.iwhalecloud.com/newZmp#/`。
2. 如出现 `一键登录`，点击后等待飞连登录完成。
3. 在工作台搜索框输入 `项目任务管理`，直接进入工时单填报页面。
4. 确认查询状态为 `待我处理的`，点击查询。
5. 读取任务单标题中的日期范围，例如 `0501-0515`。
6. 将前端选择的日期按日期范围分配到对应工时单，周末只在界面灰化提示，不会被自动过滤。
7. 进入 `任务工时`，点击 `新增`。
8. 在弹窗中再次点击 `新增`，选择工时日期。
9. 在配置的工时类型中填写小时数，填写工作说明。
10. 保存；当前工时单最后一条工时保存后自动提交。

## 注意

- 首次正式运行会弹出浏览器。如果出现一键登录，工具会先点击并等待飞连登录；等待时间可在前端调整。
- 页面控件是企业系统的自定义组件，第一版选择器尽量按文本定位；如果实际运行中卡在某一步，把页面截图和日志发回来，可以继续收紧定位逻辑。
- 页面保留 `生成计划` 和 `开始填报`；开始填报会正式操作 ZMP，并默认自动提交。
