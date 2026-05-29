const http = require("http");
const fs = require("fs");
const path = require("path");
const { runZmpAutomation, buildPlan } = require("./agent/zmpAgent");

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_DIR = path.join(__dirname, "public");
const jobs = new Map();
let shutdownScheduled = false;

function scheduleServerShutdown(reason) {
  if (shutdownScheduled) return;
  shutdownScheduled = true;
  console.log(`ZMP timesheet agent will close ${HOST}:${PORT} after job ${reason}.`);
  setTimeout(() => {
    server.close(() => {
      console.log(`ZMP timesheet agent closed ${HOST}:${PORT}.`);
    });
    setTimeout(() => {
      if (typeof server.closeAllConnections === "function") {
        server.closeAllConnections();
      }
    }, 2000).unref();
  }, 5000).unref();
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body ? JSON.parse(body) : {}));
    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8"
    }[ext] || "application/octet-stream";

    res.writeHead(200, { "Content-Type": type });
    res.end(content);
  });
}

function createJob(config) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const job = {
    id,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    logs: [],
    result: null,
    error: null
  };
  jobs.set(id, job);

  const log = message => {
    job.logs.push({
      at: new Date().toISOString(),
      message
    });
  };

  runZmpAutomation(config, log)
    .then(result => {
      job.status = "completed";
      job.result = result;
      job.finishedAt = new Date().toISOString();
      scheduleServerShutdown("completed");
    })
    .catch(error => {
      job.status = "failed";
      job.error = error.stack || error.message || String(error);
      job.finishedAt = new Date().toISOString();
      log(`失败：${error.message || error}`);
      scheduleServerShutdown("failed");
    });

  return job;
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "POST" && url.pathname === "/api/plan") {
    const config = await readBody(req);
    sendJson(res, 200, await buildPlan(config));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/jobs") {
    const config = await readBody(req);
    const job = createJob(config);
    sendJson(res, 202, { id: job.id });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
    const id = decodeURIComponent(url.pathname.replace("/api/jobs/", ""));
    const job = jobs.get(id);
    if (!job) {
      sendJson(res, 404, { error: "Job not found." });
      return;
    }
    sendJson(res, 200, job);
    return;
  }

  sendJson(res, 404, { error: "Unknown API route." });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res).catch(error => sendJson(res, 500, { error: error.message }));
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`ZMP timesheet agent is running at http://${HOST}:${PORT}`);
});
