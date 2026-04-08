const express = require("express");
const cors = require("cors");
const WebSocket = require("ws");
const path = require("path");
const { capabilities, executeCapability } = require("./capabilities/capacitor");

const app = express();

// ============================================================
// ARRANQUE
// node index.js {PUERTO} {URL_PUBLICA}
// ============================================================

const PORT = Number(process.argv[2]);
const PUBLIC_URL = String(process.argv[3] || "").trim();

if (!PORT || !PUBLIC_URL) {
  console.error("Uso: node index.js {PUERTO} {URL_PUBLICA}");
  process.exit(1);
}

// ============================================================
// IDENTIDAD
// ============================================================

const WORKER_ID = "worker-David-55222507";

// ============================================================
// CONFIG DEL WORKER
// ============================================================

const PULSE_INTERVAL = 3000;
const PULSE_TIMEOUT = 8000;
const PULSE_RETRIES = 3;
const MAX_LOAD = 5;
const RECONNECT_DELAY = 2000;
const TASK_HISTORY_LIMIT = 50;

// ============================================================
// ESTADO
// ============================================================

let ws = null;
let connectionToken = 0;

let workerStatus = "offline";
let currentCoordinator = null;

let knownCoordinators = [];

let leaderId = null;
let leaderUrl = null;
let leaderPriority = null;

let lastCoordinatorSignal = null;
let pulseFailures = 0;

let pulseIntervalRef = null;
let monitorIntervalRef = null;
let reconnectTimeoutRef = null;
let failoverInProgress = false;

const activeTasks = new Map();
const taskHistory = [];

// ============================================================
// APP
// ============================================================

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ============================================================
// HELPERS
// ============================================================

function now() {
  return Date.now();
}

function normalizeWsUrl(url) {
  if (typeof url !== "string") return "";
  const clean = url.trim();
  if (!clean) return "";
  if (clean.startsWith("ws://") || clean.startsWith("wss://")) return clean;
  if (clean.startsWith("https://")) return clean.replace("https://", "wss://");
  if (clean.startsWith("http://")) return clean.replace("http://", "ws://");
  return "";
}

function normalizeHttpUrl(url) {
  if (typeof url !== "string") return "";
  return url.trim();
}

function isValidWsUrl(url) {
  return /^wss?:\/\/.+/i.test(normalizeWsUrl(url));
}

function isValidHttpUrl(url) {
  return /^https?:\/\/.+/i.test(normalizeHttpUrl(url));
}

function send(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
    return true;
  }
  return false;
}

function sendError(message) {
  return send({
    type: "error",
    data: {
      message: String(message || "Ocurrió un error")
    }
  });
}

function getLoad() {
  return Number((activeTasks.size / MAX_LOAD).toFixed(2));
}

function addCoordinator(url) {
  const normalized = normalizeWsUrl(url);
  if (!normalized || !isValidWsUrl(normalized)) return false;

  if (!knownCoordinators.includes(normalized)) {
    knownCoordinators.push(normalized);
    return true;
  }

  return false;
}

function getBackupCoordinators() {
  return knownCoordinators.filter((url) => url && url !== leaderUrl);
}

function isConnectedToLeader() {
  return (
    typeof leaderUrl === "string" &&
    isValidWsUrl(leaderUrl) &&
    typeof currentCoordinator === "string" &&
    currentCoordinator === leaderUrl
  );
}

function shouldReconnectToKnownLeader() {
  return (
    typeof leaderUrl === "string" &&
    isValidWsUrl(leaderUrl) &&
    typeof currentCoordinator === "string" &&
    currentCoordinator !== leaderUrl
  );
}

function clearTimers() {
  if (pulseIntervalRef) {
    clearInterval(pulseIntervalRef);
    pulseIntervalRef = null;
  }

  if (monitorIntervalRef) {
    clearInterval(monitorIntervalRef);
    monitorIntervalRef = null;
  }
}

function clearReconnectTimeout() {
  if (reconnectTimeoutRef) {
    clearTimeout(reconnectTimeoutRef);
    reconnectTimeoutRef = null;
  }
}

function closeSocket() {
  if (!ws) return;

  const socket = ws;
  ws = null;

  try {
    socket.__ignoreClose = true;
    socket.removeAllListeners();

    if (socket.readyState === WebSocket.OPEN) {
      socket.close();
      return;
    }

    if (
      socket.readyState === WebSocket.CONNECTING ||
      socket.readyState === WebSocket.CLOSING
    ) {
      socket.terminate();
      return;
    }

    if (socket.readyState !== WebSocket.CLOSED) {
      socket.terminate();
    }
  } catch (_) {}
}

function pushTaskHistory(entry) {
  taskHistory.unshift(entry);

  while (taskHistory.length > TASK_HISTORY_LIMIT) {
    taskHistory.pop();
  }
}

function updateLeaderFromMessage(message) {
  if (!message || typeof message !== "object") return;
  const data = message.data || {};

  if (data.leader && typeof data.leader === "object") {
    if (typeof data.leader.id === "string" && data.leader.id.trim()) {
      leaderId = data.leader.id.trim();
    }

    if (typeof data.leader.url === "string" && isValidWsUrl(data.leader.url)) {
      leaderUrl = normalizeWsUrl(data.leader.url);
      addCoordinator(leaderUrl);
    }

    if (typeof data.leader.priority === "number") {
      leaderPriority = data.leader.priority;
    }
  }

  if (typeof data.leaderId === "string" && data.leaderId.trim()) {
    leaderId = data.leaderId.trim();
  }

  if (typeof data.leaderUrl === "string" && isValidWsUrl(data.leaderUrl)) {
    leaderUrl = normalizeWsUrl(data.leaderUrl);
    addCoordinator(leaderUrl);
  }

  if (typeof data.priority === "number") {
    leaderPriority = data.priority;
  }
}

function registerKnownCoordinatorsFromMessage(message) {
  if (!message || typeof message !== "object") return;
  const data = message.data || {};

  if (Array.isArray(data.knownPeers)) {
    data.knownPeers.forEach((peer) => {
      if (peer && typeof peer.url === "string") {
        addCoordinator(peer.url);
      }
    });
  }

  if (typeof data.leaderUrl === "string") {
    addCoordinator(data.leaderUrl);
  }

  if (data.leader && typeof data.leader.url === "string") {
    addCoordinator(data.leader.url);
  }

  if (Array.isArray(data.backups)) {
    data.backups.forEach((backupUrl) => {
      if (typeof backupUrl === "string") {
        addCoordinator(backupUrl);
      }
    });
  }

  if (Array.isArray(data.coordinators)) {
    data.coordinators.forEach((url) => {
      if (typeof url === "string") {
        addCoordinator(url);
      }
    });
  }
}

function reconnectToKnownLeader() {
  if (!shouldReconnectToKnownLeader()) return;

  console.log(`Reconectando automáticamente al líder: ${leaderUrl}`);

  workerStatus = "waiting_leader";
  clearTimers();
  clearReconnectTimeout();

  try {
    closeSocket();
  } catch (_) {}

  connect(leaderUrl);
}

function buildRegister() {
  return {
    type: "register",
    data: {
      id: WORKER_ID,
      url: PUBLIC_URL,
      capabilities
    }
  };
}

function buildPulse() {
  return {
    type: "pulse",
    data: {
      id: WORKER_ID,
      load: getLoad()
    }
  };
}

function buildTaskResultOk(taskId, result) {
  return {
    type: "task-result",
    data: {
      taskId,
      status: "ok",
      result
    }
  };
}

function buildTaskResultError(taskId, errorMessage) {
  return {
    type: "task-result",
    data: {
      taskId,
      status: "error",
      error: String(errorMessage || "Ocurrió un error")
    }
  };
}

function isValidEnvelope(message) {
  return (
    message &&
    typeof message === "object" &&
    typeof message.type === "string" &&
    message.type.trim() !== "" &&
    Object.prototype.hasOwnProperty.call(message, "data") &&
    typeof message.data === "object" &&
    message.data !== null &&
    !Array.isArray(message.data)
  );
}

function scheduleReconnect(targetUrl = null) {
  clearReconnectTimeout();

  reconnectTimeoutRef = setTimeout(() => {
    reconnectTimeoutRef = null;

    if (targetUrl && isValidWsUrl(targetUrl)) {
      connect(targetUrl);
      return;
    }

    if (shouldReconnectToKnownLeader()) {
      connect(leaderUrl);
      return;
    }

    tryReconnect();
  }, RECONNECT_DELAY);
}

function orderReconnectCandidates() {
  const unique = [...new Set(knownCoordinators.filter(isValidWsUrl))];

  if (leaderUrl && isValidWsUrl(leaderUrl)) {
    const others = unique.filter((url) => url !== leaderUrl);
    return [leaderUrl, ...others];
  }

  return unique;
}

function getNextBackupCoordinator() {
  const candidates = orderReconnectCandidates().filter(
    (url) => url !== currentCoordinator
  );

  if (!candidates.length) {
    return null;
  }

  if (leaderUrl && currentCoordinator === leaderUrl) {
    const backups = candidates.filter((url) => url !== leaderUrl);
    return backups.length ? backups[0] : null;
  }

  if (shouldReconnectToKnownLeader()) {
    return leaderUrl;
  }

  return candidates[0];
}

// ============================================================
// PROTOCOLO DEL WORKER
// ============================================================

function sendRegister() {
  const sent = send(buildRegister());

  if (sent) {
    console.log("register enviado");
  } else {
    console.log("No se pudo enviar register");
  }
}

function sendPulse() {
  const sent = send(buildPulse());

  if (sent) {
    pulseFailures = 0;
    console.log(`pulse enviado con load=${getLoad()}`);
  } else {
    pulseFailures++;
    console.log(`Fallo enviando pulse (${pulseFailures}/${PULSE_RETRIES})`);

    if (pulseFailures >= PULSE_RETRIES) {
      console.log("Max retries alcanzados -> failover");

      workerStatus = "waiting_leader";
      clearTimers();

      try {
        closeSocket();
      } catch (_) {}

      scheduleReconnect();
    } else {
      console.log("No se pudo enviar pulse");
    }
  }
}

// ============================================================
// TASKS
// ============================================================

async function handleTaskAssign(message) {
  const data = message.data || {};
  const taskId = data.taskId;
  const taskType = data.type;
  const payload = data.payload;

  if (
    typeof taskId !== "string" ||
    !taskId.trim() ||
    typeof taskType !== "string" ||
    !taskType.trim() ||
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    sendError("Mensaje task-assign inválido");
    return;
  }

  if (!capabilities.includes(taskType)) {
    send(buildTaskResultError(taskId, `Capacidad no soportada: ${taskType}`));

    pushTaskHistory({
      taskId,
      type: taskType,
      status: "error",
      error: `Capacidad no soportada: ${taskType}`,
      result: null,
      startedAt: now(),
      completedAt: now()
    });

    return;
  }

  const taskEntry = {
    taskId,
    type: taskType,
    status: "assigned",
    payload,
    startedAt: now()
  };

  activeTasks.set(taskId, taskEntry);

  try {
    const result = await executeCapability(taskType, payload);

    send(buildTaskResultOk(taskId, result));

    pushTaskHistory({
      taskId,
      type: taskType,
      status: "ok",
      result,
      error: null,
      startedAt: taskEntry.startedAt,
      completedAt: now()
    });

    console.log(`task-result ok enviado para ${taskId}`);
  } catch (error) {
    send(buildTaskResultError(taskId, error.message));

    pushTaskHistory({
      taskId,
      type: taskType,
      status: "error",
      result: null,
      error: error.message,
      startedAt: taskEntry.startedAt,
      completedAt: now()
    });

    console.log(`task-result error enviado para ${taskId}: ${error.message}`);
  } finally {
    activeTasks.delete(taskId);
  }
}

// ============================================================
// FAILOVER
// ============================================================

function tryReconnect() {
  if (failoverInProgress) return;

  failoverInProgress = true;
  workerStatus = "waiting_leader";

  console.log("Intentando reconectar...");

  const nextCoordinator = getNextBackupCoordinator();

  if (!nextCoordinator) {
    console.log("No hay coordinadores disponibles");
    workerStatus = "waiting_leader";
    failoverInProgress = false;
    return;
  }

  console.log(`Siguiente coordinador candidato: ${nextCoordinator}`);

  failoverInProgress = false;
  connect(nextCoordinator);
}

// ============================================================
// CONEXIÓN
// ============================================================

function connect(url) {
  const wsUrl = normalizeWsUrl(url);

  if (!isValidWsUrl(wsUrl)) {
    console.log("URL de coordinador inválida");
    return;
  }

  addCoordinator(wsUrl);

  clearReconnectTimeout();
  clearTimers();
  closeSocket();

  const token = ++connectionToken;

  console.log("Conectando a:", wsUrl);

  const socket = new WebSocket(wsUrl);
  socket.__ignoreClose = false;
  ws = socket;

  socket.on("open", () => {
    if (token !== connectionToken) {
      try {
        socket.__ignoreClose = true;
        socket.close();
      } catch (_) {}
      return;
    }

    console.log("Conectado");

    workerStatus = "alive";
    currentCoordinator = wsUrl;
    lastCoordinatorSignal = now();
    pulseFailures = 0;
    failoverInProgress = false;

    sendRegister();

    pulseIntervalRef = setInterval(() => {
      sendPulse();
    }, PULSE_INTERVAL);

    monitorIntervalRef = setInterval(() => {
      if (ws !== socket || token !== connectionToken) return;

      const silence = lastCoordinatorSignal ? now() - lastCoordinatorSignal : 0;

      if (silence > PULSE_TIMEOUT) {
        console.log(`Silencio del coordinador por ${silence}ms`);

        if (!isConnectedToLeader() && shouldReconnectToKnownLeader()) {
          console.log("Se detectó líder conocido mientras estábamos en backup");
          reconnectToKnownLeader();
        }
      }
    }, 2000);
  });

  socket.on("message", async (raw) => {
    if (token !== connectionToken) return;

    try {
      const message = JSON.parse(raw.toString());

      if (!isValidEnvelope(message)) {
        console.log("Mensaje inválido recibido");
        sendError("Mensaje inválido recibido por el worker");
        return;
      }

      lastCoordinatorSignal = now();

      registerKnownCoordinatorsFromMessage(message);
      updateLeaderFromMessage(message);

      switch (message.type) {
        case "welcome":
          if (shouldReconnectToKnownLeader()) {
            reconnectToKnownLeader();
          }
          return;

        case "leader-announce":
          if (shouldReconnectToKnownLeader()) {
            reconnectToKnownLeader();
          }
          return;

        case "redirect":
          console.log(`Redirect a líder: ${message.data.leaderUrl || "desconocido"}`);

          workerStatus = "waiting_leader";
          clearTimers();

          try {
            socket.__ignoreClose = true;
            socket.close();
          } catch (_) {}

          if (message.data.leaderUrl && isValidWsUrl(message.data.leaderUrl)) {
            connect(message.data.leaderUrl);
          } else if (leaderUrl && isValidWsUrl(leaderUrl)) {
            connect(leaderUrl);
          } else {
            scheduleReconnect();
          }
          return;

        case "task-assign":
          await handleTaskAssign(message);
          return;

        case "error":
          console.log(
            `error recibido: ${
              message.data?.message || "Error recibido desde el coordinador"
            }`
          );
          return;

        default:
          console.log(`Mensaje no manejado recibido: ${message.type}`);
          return;
      }
    } catch {
      console.log("Mensaje inválido");
      sendError("Mensaje inválido recibido por el worker");
    }
  });

  socket.on("close", () => {
    if (socket.__ignoreClose) {
      return;
    }

    if (token !== connectionToken) return;

    console.log("Desconectado");

    clearTimers();

    if (currentCoordinator === wsUrl) {
      currentCoordinator = null;
    }

    workerStatus = "waiting_leader";

    scheduleReconnect();
  });

  socket.on("error", (error) => {
    if (token !== connectionToken) return;
    console.log("Error:", error.message);
  });
}

// ============================================================
// API / UI
// ============================================================

app.get("/status", (_req, res) => {
  res.json({
    id: WORKER_ID,
    status: workerStatus,
    coordinator: currentCoordinator,
    leaderId,
    leaderUrl,
    leaderPriority,
    coordinators: knownCoordinators,
    backups: getBackupCoordinators(),
    capabilities,
    load: getLoad(),
    activeTasks: activeTasks.size,
    activeTaskList: Array.from(activeTasks.values()).map((task) => ({
      taskId: task.taskId,
      type: task.type,
      status: task.status,
      startedAt: task.startedAt
    })),
    taskHistory,
    lastCoordinatorSignal,
    timestamp: now()
  });
});

app.post("/connect", (req, res) => {
  const { url } = req.body || {};

  if (!isValidWsUrl(url)) {
    return res.status(400).json({
      ok: false,
      message: "URL inválida. Debe iniciar con ws:// o wss://"
    });
  }

  addCoordinator(url);

  if (!leaderUrl) {
    leaderUrl = normalizeWsUrl(url);
  }

  workerStatus = "waiting_leader";
  connect(url);

  return res.json({
    ok: true,
    message: "Conexión iniciada correctamente",
    coordinator: url,
    coordinators: knownCoordinators,
    backups: getBackupCoordinators()
  });
});

app.post("/coordinators/add", (req, res) => {
  const { url } = req.body || {};

  if (!isValidWsUrl(url)) {
    return res.status(400).json({
      ok: false,
      message: "URL inválida. Debe iniciar con ws:// o wss://"
    });
  }

  addCoordinator(url);

  return res.json({
    ok: true,
    message: "Coordinador agregado correctamente",
    coordinators: knownCoordinators,
    backups: getBackupCoordinators()
  });
});

app.post("/switch-coordinator", (req, res) => {
  const { url } = req.body || {};

  if (!isValidWsUrl(url)) {
    return res.status(400).json({
      ok: false,
      message: "URL inválida. Debe iniciar con ws:// o wss://"
    });
  }

  addCoordinator(url);
  workerStatus = "waiting_leader";
  connect(url);

  return res.json({
    ok: true,
    message: "Cambio manual realizado correctamente",
    coordinator: url,
    coordinators: knownCoordinators,
    backups: getBackupCoordinators()
  });
});

app.post("/switch-next-available", (_req, res) => {
  const nextCoordinator = getNextBackupCoordinator();

  if (!nextCoordinator) {
    return res.status(400).json({
      ok: false,
      message: "No hay coordinadores disponibles distintos al actual"
    });
  }

  workerStatus = "waiting_leader";
  connect(nextCoordinator);

  return res.json({
    ok: true,
    message: `Cambio realizado al coordinador disponible: ${nextCoordinator}`,
    coordinator: nextCoordinator,
    coordinators: knownCoordinators,
    backups: getBackupCoordinators()
  });
});

// ============================================================
// START
// ============================================================

app.listen(PORT, () => {
  console.log(`Worker ${WORKER_ID} iniciado`);
  console.log(`URL pública del worker: ${PUBLIC_URL}`);
  console.log(`Capacidades: ${capabilities.join(", ")}`);

  if (!isValidHttpUrl(PUBLIC_URL)) {
    console.log("Advertencia: la URL pública del worker no parece ser http:// o https://");
  }

  console.log("Esperando conexión manual desde la interfaz web...");
});