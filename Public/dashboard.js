const UI = {
  workerIdMain: document.getElementById("workerIdMain"),
  workerIdDetail: document.getElementById("workerIdDetail"),
  workerStatus: document.getElementById("workerStatus"),
  coordinatorCurrent: document.getElementById("coordinatorCurrent"),
  timeStamp: document.getElementById("timeStamp"),
  coordinatorList: document.getElementById("coordinatorList"),
  statusDot: document.getElementById("statusDot"),
  statusText: document.getElementById("statusText"),
  totalCoords: document.getElementById("totalCoords"),
  currentCoordName: document.getElementById("currentCoordName"),
  lastUpdate: document.getElementById("lastUpdate"),
  heroBadge: document.getElementById("heroBadge"),
  heroSubtitle: document.getElementById("heroSubtitle"),

  manualCoordinatorInput: document.getElementById("manualCoordinatorInput"),
  connectCoordinatorBtn: document.getElementById("connectCoordinatorBtn"),
  addCoordinatorBtn: document.getElementById("addCoordinatorBtn"),
  switchCoordinatorBtn: document.getElementById("switchCoordinatorBtn"),
  switchAvailableBtn: document.getElementById("switchAvailableBtn"),
  manualActionMessage: document.getElementById("manualActionMessage"),

  leaderId: document.getElementById("leaderId"),
  leaderUrl: document.getElementById("leaderUrl"),
  leaderPriority: document.getElementById("leaderPriority"),
  workerLoad: document.getElementById("workerLoad"),
  activeTasks: document.getElementById("activeTasks"),
  capabilities: document.getElementById("capabilities"),
  lastHeartbeat: document.getElementById("lastHeartbeat"),

  activeTaskList: document.getElementById("activeTaskList"),
  taskHistoryList: document.getElementById("taskHistoryList")
};

let lastCoordinator = null;
let refreshInterval = null;
let actionInProgress = false;

function formatDate(ts) {
  if (!ts) return "No disponible";

  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "No disponible";

  return date.toLocaleString("es-CO", {
    dateStyle: "medium",
    timeStyle: "medium"
  });
}

function formatAgo(ts) {
  if (!ts) return "No disponible";

  const numericTs = Number(ts);
  if (!Number.isFinite(numericTs)) return "No disponible";

  const seconds = Math.max(0, Math.floor((Date.now() - numericTs) / 1000));

  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function setText(el, value) {
  if (!el) return;

  const newValue = String(value ?? "");
  if (el.textContent === newValue) return;

  el.classList.remove("value-pop");
  void el.offsetWidth;
  el.textContent = newValue;
  el.classList.add("value-pop");
}

function showManualMessage(message, type = "neutral") {
  if (!UI.manualActionMessage) return;

  const allowedTypes = ["neutral", "success", "error"];
  const safeType = allowedTypes.includes(type) ? type : "neutral";

  UI.manualActionMessage.className = "manual-message";
  UI.manualActionMessage.classList.add(safeType);
  UI.manualActionMessage.textContent = String(message || "");
}

function getManualUrl() {
  return UI.manualCoordinatorInput?.value?.trim() || "";
}

function setButtonsDisabled(disabled) {
  [
    UI.connectCoordinatorBtn,
    UI.addCoordinatorBtn,
    UI.switchCoordinatorBtn,
    UI.switchAvailableBtn
  ].forEach((button) => {
    if (button) button.disabled = disabled;
  });
}

function getVisualState(rawStatus) {
  const normalized = String(rawStatus || "").trim().toLowerCase();

  if (normalized === "alive") return "online";
  if (normalized === "waiting_leader") return "warning";
  if (normalized === "offline") return "offline";
  return "neutral";
}

function updateStatusVisual(status) {
  const normalized = String(status || "").trim().toLowerCase();
  const visualState = getVisualState(normalized);

  let label = "Desconocido";
  let hero = "Estado desconocido";
  let subtitle = "Esperando información del worker";

  if (normalized === "alive") {
    label = "Activo";
    hero = "Worker operativo";
    subtitle = "El worker está conectado y enviando pulse";
  } else if (normalized === "waiting_leader") {
    label = "Esperando líder";
    hero = "Failover en curso";
    subtitle = "El worker está buscando un coordinador líder";
  } else if (normalized === "offline") {
    label = "Inactivo";
    hero = "Sin conexión";
    subtitle = "No hay conexión activa con coordinadores";
  }

  if (UI.workerStatus) {
    UI.workerStatus.className = `metric-value status-badge ${visualState}`;
  }

  if (UI.statusDot) {
    UI.statusDot.className = `status-dot ${visualState}`;
  }

  setText(UI.statusText, label);
  setText(UI.workerStatus, label);
  setText(UI.heroBadge, hero);
  setText(UI.heroSubtitle, subtitle);
}

function createTag(text, extraClass = "") {
  const span = document.createElement("span");
  span.className = `tag ${extraClass}`.trim();
  span.textContent = text;
  return span;
}

function buildCoordinatorList(list = [], current = "", currentLeaderUrl = "", status = "offline") {
  if (!UI.coordinatorList) return;

  UI.coordinatorList.innerHTML = "";

  if (!Array.isArray(list) || list.length === 0) {
    const li = document.createElement("li");
    li.className = "coord-item empty";
    li.textContent = "No hay coordinadores conocidos";
    UI.coordinatorList.appendChild(li);
    return;
  }

  const normalizedStatus = String(status || "").trim().toLowerCase();

  list.forEach((coord) => {
    const li = document.createElement("li");
    li.className = "coord-item";

    const isCurrent = coord === current;
    const isLeader = coord === currentLeaderUrl;
    const isAlive = isCurrent && normalizedStatus === "alive";
    const isWaitingLeader = isCurrent && normalizedStatus === "waiting_leader";
    const isOffline = isCurrent && normalizedStatus === "offline";

    if (isCurrent) li.classList.add("active");
    if (isLeader) li.classList.add("primary");

    const left = document.createElement("div");
    left.className = "coord-left";

    const indicator = document.createElement("div");
    indicator.className = "coord-indicator";

    if (isAlive) indicator.classList.add("active");
    else if (isWaitingLeader) indicator.classList.add("warning");
    else if (isOffline) indicator.classList.add("offline");

    const main = document.createElement("div");
    main.className = "coord-main";

    const name = document.createElement("span");
    name.className = "coord-name";
    name.textContent = coord;

    const role = document.createElement("span");
    role.className = "coord-role";

    let roleText = "Coordinador conocido";
    if (isLeader) roleText = "Líder";
    if (isCurrent && isLeader) roleText = "Líder • En uso";
    else if (isCurrent) roleText = "En uso";

    role.textContent = roleText;

    main.appendChild(name);
    main.appendChild(role);

    left.appendChild(indicator);
    left.appendChild(main);

    const tags = document.createElement("div");
    tags.className = "coord-tags";

    if (isLeader) tags.appendChild(createTag("LEADER", "live"));
    if (isCurrent) tags.appendChild(createTag("CURRENT"));
    if (isAlive) tags.appendChild(createTag("LIVE", "live"));
    if (isWaitingLeader) tags.appendChild(createTag("WAITING", "warning"));
    if (isOffline) tags.appendChild(createTag("OFFLINE", "offline"));

    li.appendChild(left);
    li.appendChild(tags);

    UI.coordinatorList.appendChild(li);
  });
}

function animateCoordinatorChange(current) {
  if (!current || current === lastCoordinator) return;

  const card = document.querySelector(".hero-panel-main");
  if (card) {
    card.classList.remove("flash-change");
    void card.offsetWidth;
    card.classList.add("flash-change");
  }

  lastCoordinator = current;
}

function formatCapabilities(capabilities) {
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    return "No disponibles";
  }

  return capabilities.join(", ");
}

function formatLoad(load) {
  const numericLoad = Number(load);
  if (!Number.isFinite(numericLoad)) return "0.00";
  return numericLoad.toFixed(2);
}

function getTaskStatusClass(status) {
  const normalized = String(status || "").toLowerCase();

  if (normalized === "ok") return "live";
  if (normalized === "error") return "offline";
  if (normalized === "assigned") return "warning";
  if (normalized === "running") return "warning";
  return "neutral";
}

function renderActiveTasks(list = []) {
  if (!UI.activeTaskList) return;

  UI.activeTaskList.innerHTML = "";

  if (!Array.isArray(list) || list.length === 0) {
    const li = document.createElement("li");
    li.className = "coord-item empty";
    li.textContent = "No hay tareas activas";
    UI.activeTaskList.appendChild(li);
    return;
  }

  list.forEach((task) => {
    const li = document.createElement("li");
    li.className = "coord-item";

    const left = document.createElement("div");
    left.className = "coord-left";

    const indicator = document.createElement("div");
    indicator.className = "coord-indicator active";

    const main = document.createElement("div");
    main.className = "coord-main";

    const name = document.createElement("span");
    name.className = "coord-name";
    name.textContent = `${task.taskId} · ${task.type}`;

    const meta = document.createElement("span");
    meta.className = "coord-role";
    meta.textContent = `Desde: ${formatDate(task.startedAt)}`;

    main.appendChild(name);
    main.appendChild(meta);

    left.appendChild(indicator);
    left.appendChild(main);

    const tags = document.createElement("div");
    tags.className = "coord-tags";
    tags.appendChild(createTag("ACTIVE", "live"));

    li.appendChild(left);
    li.appendChild(tags);
    UI.activeTaskList.appendChild(li);
  });
}

function renderTaskHistory(history = []) {
  if (!UI.taskHistoryList) return;

  UI.taskHistoryList.innerHTML = "";

  if (!Array.isArray(history) || history.length === 0) {
    const li = document.createElement("li");
    li.className = "coord-item empty";
    li.textContent = "No hay historial de tareas";
    UI.taskHistoryList.appendChild(li);
    return;
  }

  history.forEach((task) => {
    const li = document.createElement("li");
    li.className = "coord-item";

    const left = document.createElement("div");
    left.className = "coord-left";

    const indicator = document.createElement("div");
    indicator.className = `coord-indicator ${task.status === "ok" ? "active" : "offline"}`;

    const main = document.createElement("div");
    main.className = "coord-main";

    const name = document.createElement("span");
    name.className = "coord-name";
    name.textContent = `${task.taskId} · ${task.type}`;

    const meta = document.createElement("span");
    meta.className = "coord-role";

    const duration =
      typeof task.completedAt === "number" && typeof task.startedAt === "number"
        ? `${Math.max(0, task.completedAt - task.startedAt)}ms`
        : "Duración no disponible";

    meta.textContent =
      task.status === "ok"
        ? `OK · ${duration}`
        : `ERROR · ${duration} · ${task.error || "Sin detalle"}`;

    main.appendChild(name);
    main.appendChild(meta);

    left.appendChild(indicator);
    left.appendChild(main);

    const tags = document.createElement("div");
    tags.className = "coord-tags";
    tags.appendChild(
      createTag(String(task.status || "unknown").toUpperCase(), getTaskStatusClass(task.status))
    );

    li.appendChild(left);
    li.appendChild(tags);
    UI.taskHistoryList.appendChild(li);
  });
}

function applyOfflineFallbackState() {
  updateStatusVisual("offline");

  setText(UI.workerIdMain, "N/A");
  setText(UI.workerIdDetail, "N/A");
  setText(UI.coordinatorCurrent, "N/A");
  setText(UI.currentCoordName, "N/A");
  setText(UI.timeStamp, "No disponible");
  setText(UI.lastUpdate, "No disponible");
  setText(UI.totalCoords, 0);

  setText(UI.leaderId, "No disponible");
  setText(UI.leaderUrl, "No disponible");
  setText(UI.leaderPriority, "No disponible");
  setText(UI.workerLoad, "0.00");
  setText(UI.activeTasks, "0");
  setText(UI.capabilities, "No disponibles");
  setText(UI.lastHeartbeat, "No disponible");

  setText(UI.heroBadge, "Error de conexión");
  setText(UI.heroSubtitle, "No se pudo obtener el estado del worker");

  buildCoordinatorList([], "", "", "offline");
  renderActiveTasks([]);
  renderTaskHistory([]);
}

async function fetchStatus() {
  try {
    const response = await fetch("/status", { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`Error al consultar estado: ${response.status}`);
    }

    const data = await response.json();

    setText(UI.workerIdMain, data.id || "N/A");
    setText(UI.workerIdDetail, data.id || "N/A");

    setText(UI.coordinatorCurrent, data.coordinator || "N/A");
    setText(UI.currentCoordName, data.coordinator || "N/A");

    setText(UI.timeStamp, formatDate(data.timestamp));
    setText(UI.lastUpdate, formatDate(data.timestamp));

    setText(
      UI.totalCoords,
      Array.isArray(data.coordinators) ? data.coordinators.length : 0
    );

    setText(UI.leaderId, data.leaderId || "No disponible");
    setText(UI.leaderUrl, data.leaderUrl || "No disponible");
    setText(UI.leaderPriority, data.leaderPriority ?? "No disponible");
    setText(UI.workerLoad, formatLoad(data.load));
    setText(
      UI.activeTasks,
      typeof data.activeTasks === "number" ? data.activeTasks : 0
    );
    setText(UI.capabilities, formatCapabilities(data.capabilities));
    setText(UI.lastHeartbeat, formatAgo(data.lastCoordinatorSignal));

    updateStatusVisual(data.status);
    buildCoordinatorList(
      data.coordinators,
      data.coordinator,
      data.leaderUrl,
      data.status
    );
    renderActiveTasks(data.activeTaskList || []);
    renderTaskHistory(data.taskHistory || []);
    animateCoordinatorChange(data.coordinator);
  } catch (error) {
    console.error("fetchStatus error:", error);
    applyOfflineFallbackState();
  }
}

async function postJson(url, body = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || "Error en la solicitud");
  }

  return data;
}

async function connectCoordinatorManually() {
  const url = getManualUrl();

  if (!url) {
    showManualMessage("Debes ingresar una URL válida", "error");
    return;
  }

  if (actionInProgress) return;

  try {
    actionInProgress = true;
    setButtonsDisabled(true);
    showManualMessage("Conectando al coordinador...", "neutral");

    const data = await postJson("/connect", { url });

    showManualMessage(data.message || "Conexión iniciada correctamente", "success");
    await fetchStatus();
  } catch (error) {
    console.error("connectCoordinatorManually error:", error);
    showManualMessage(error.message || "Error conectando al coordinador", "error");
  } finally {
    actionInProgress = false;
    setButtonsDisabled(false);
  }
}

async function addCoordinatorManually() {
  const url = getManualUrl();

  if (!url) {
    showManualMessage("Debes ingresar una URL válida", "error");
    return;
  }

  if (actionInProgress) return;

  try {
    actionInProgress = true;
    setButtonsDisabled(true);
    showManualMessage("Agregando coordinador...", "neutral");

    const data = await postJson("/coordinators/add", { url });

    showManualMessage(data.message || "Coordinador agregado correctamente", "success");
    await fetchStatus();
  } catch (error) {
    console.error("addCoordinatorManually error:", error);
    showManualMessage(error.message || "Error agregando coordinador", "error");
  } finally {
    actionInProgress = false;
    setButtonsDisabled(false);
  }
}

async function switchCoordinatorManually() {
  const url = getManualUrl();

  if (!url) {
    showManualMessage("Debes ingresar una URL válida", "error");
    return;
  }

  if (actionInProgress) return;

  try {
    actionInProgress = true;
    setButtonsDisabled(true);
    showManualMessage("Intentando cambiar coordinador...", "neutral");

    const data = await postJson("/switch-coordinator", { url });

    showManualMessage(data.message || "Cambio manual realizado correctamente", "success");
    await fetchStatus();
  } catch (error) {
    console.error("switchCoordinatorManually error:", error);
    showManualMessage(error.message || "Error en el cambio manual", "error");
  } finally {
    actionInProgress = false;
    setButtonsDisabled(false);
  }
}

async function switchToNextAvailable() {
  if (actionInProgress) return;

  try {
    actionInProgress = true;
    setButtonsDisabled(true);
    showManualMessage("Buscando coordinador disponible...", "neutral");

    const data = await postJson("/switch-next-available");

    showManualMessage(data.message || "Cambio exitoso al coordinador disponible", "success");
    await fetchStatus();
  } catch (error) {
    console.error("switchToNextAvailable error:", error);
    showManualMessage(error.message || "Error buscando coordinador disponible", "error");
  } finally {
    actionInProgress = false;
    setButtonsDisabled(false);
  }
}

function startAutoRefresh() {
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = setInterval(fetchStatus, 2000);
}

function stopAutoRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopAutoRefresh();
  } else {
    fetchStatus();
    startAutoRefresh();
  }
});

document.addEventListener("DOMContentLoaded", () => {
  fetchStatus();
  startAutoRefresh();

  UI.connectCoordinatorBtn?.addEventListener("click", connectCoordinatorManually);
  UI.addCoordinatorBtn?.addEventListener("click", addCoordinatorManually);
  UI.switchCoordinatorBtn?.addEventListener("click", switchCoordinatorManually);
  UI.switchAvailableBtn?.addEventListener("click", switchToNextAvailable);

  UI.manualCoordinatorInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      connectCoordinatorManually();
    }
  });
});