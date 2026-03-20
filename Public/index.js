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
    refreshBtn: document.getElementById("refreshBtn")
};

let lastCoordinator = null;
let refreshInterval = null;

// =========================
// UTILIDADES
// =========================
function formatDate(ts) {
    if (!ts) return "No disponible";

    return new Date(ts).toLocaleString("es-CO", {
        dateStyle: "medium",
        timeStyle: "medium"
    });
}

function setText(el, value) {
    if (!el) return;

    const newValue = String(value);

    if (el.textContent !== newValue) {
        el.classList.remove("value-pop");
        void el.offsetWidth;
        el.textContent = newValue;
        el.classList.add("value-pop");
    }
}

// =========================
// ESTADO VISUAL GENERAL
// =========================
function updateStatusVisual(status) {
    const normalized = String(status || "").toLowerCase();

    if (UI.workerStatus) {
        UI.workerStatus.className = "metric-value status-badge";
    }

    if (UI.statusDot) {
        UI.statusDot.className = "status-dot";
    }

    let label = "Desconocido";
    let hero = "Estado desconocido";
    let subtitle = "Esperando información del worker";

    if (normalized === "alive") {
        label = "Activo";
        hero = "Worker operativo";
        subtitle = "El nodo está respondiendo correctamente";
        UI.workerStatus?.classList.add("online");
        UI.statusDot?.classList.add("online");

    } else if (normalized === "failover") {
        label = "Failover";
        hero = "Conmutación activa";
        subtitle = "El worker está intentando cambiar a un coordinador de respaldo";
        UI.workerStatus?.classList.add("warning");
        UI.statusDot?.classList.add("warning");

    } else if (normalized === "offline") {
        label = "Caído";
        hero = "Sin conexión";
        subtitle = "No hay comunicación con el coordinador";
        UI.workerStatus?.classList.add("offline");
        UI.statusDot?.classList.add("offline");

    } else {
        UI.workerStatus?.classList.add("neutral");
        UI.statusDot?.classList.add("neutral");
    }

    setText(UI.statusText, label);
    setText(UI.workerStatus, label);
    setText(UI.heroBadge, hero);
    setText(UI.heroSubtitle, subtitle);
}

// =========================
// LISTA DE COORDINADORES
// =========================
function buildCoordinatorList(lista = [], actual = "", status = "offline") {
    if (!UI.coordinatorList) return;

    UI.coordinatorList.innerHTML = "";

    if (!Array.isArray(lista) || lista.length === 0) {
        const li = document.createElement("li");
        li.className = "coord-item empty";
        li.textContent = "No hay coordinadores";
        UI.coordinatorList.appendChild(li);
        return;
    }

    lista.forEach((coord, index) => {
        const li = document.createElement("li");
        li.className = "coord-item";

        const isCurrent = coord === actual;
        const normalizedStatus = String(status || "").toLowerCase();
        const isAlive = isCurrent && normalizedStatus === "alive";
        const isFailover = isCurrent && normalizedStatus === "failover";
        const isOffline = isCurrent && normalizedStatus === "offline";

        if (isCurrent) li.classList.add("active");
        if (index === 0) li.classList.add("primary");

        li.innerHTML = `
            <div class="coord-left">
                <div class="coord-indicator ${isAlive ? "active" : ""}"></div>
                <div class="coord-main">
                    <span class="coord-name">${coord}</span>
                    <span class="coord-role">
                        ${index === 0 ? "Primario" : "Backup"}
                        ${isCurrent ? " • En uso" : ""}
                    </span>
                </div>
            </div>
            <div class="coord-tags">
                ${index === 0 ? `<span class="tag">PRIMARY</span>` : ""}
                ${isAlive ? `<span class="tag live">LIVE</span>` : ""}
                ${isFailover ? `<span class="tag">FAILOVER</span>` : ""}
                ${isOffline ? `<span class="tag">OFFLINE</span>` : ""}
            </div>
        `;

        UI.coordinatorList.appendChild(li);
    });
}

// =========================
// ANIMACIÓN DE CAMBIO
// =========================
function animateCoordinatorChange(actual) {
    if (!actual || actual === lastCoordinator) return;

    const card = document.querySelector(".hero-card");

    if (card) {
        card.classList.remove("flash-change");
        void card.offsetWidth;
        card.classList.add("flash-change");
    }

    lastCoordinator = actual;
}

// =========================
// OBTENER ESTADO
// =========================
async function fetchStatus() {
    try {
        const res = await fetch("/status", { cache: "no-store" });
        if (!res.ok) throw new Error("Error al consultar estado");

        const data = await res.json();

        setText(UI.workerIdMain, data.id || "N/A");
        setText(UI.workerIdDetail, data.id || "N/A");

        setText(UI.coordinatorCurrent, data.coordinator || "N/A");
        setText(UI.currentCoordName, data.coordinator || "N/A");

        setText(UI.timeStamp, formatDate(data.timeStamp));
        setText(UI.lastUpdate, `Última actualización: ${formatDate(data.timeStamp)}`);

        setText(UI.totalCoords, Array.isArray(data.lista) ? data.lista.length : 0);

        updateStatusVisual(data.status);
        buildCoordinatorList(data.lista, data.coordinator, data.status);
        animateCoordinatorChange(data.coordinator);

    } catch (error) {
        console.error(error);

        updateStatusVisual("offline");
        setText(UI.heroBadge, "Error de conexión");
        setText(UI.heroSubtitle, "No se pudo obtener el estado");
        setText(UI.lastUpdate, "Última actualización: error");

        buildCoordinatorList([], "", "offline");
    }
}

// =========================
// AUTO REFRESH
// =========================
function startAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(fetchStatus, 2000);
}

// =========================
// INIT
// =========================
document.addEventListener("DOMContentLoaded", () => {
    fetchStatus();
    startAutoRefresh();

    if (UI.refreshBtn) {
        UI.refreshBtn.addEventListener("click", () => {
            UI.refreshBtn.classList.remove("spin-once");
            void UI.refreshBtn.offsetWidth;
            UI.refreshBtn.classList.add("spin-once");
            fetchStatus();
        });
    }
});