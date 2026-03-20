const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const WebSocket = require("ws");
const path = require("path");

const app = express();

const PORT = Number(process.argv[2]) || 4000;
const PRIMARY_COORDINATOR = process.argv[3];
const PUBLIC_URL = process.argv[4];
const PULSE_INTERVAL = 2000;
const PRIMARY_RETRY_INTERVAL = 10000;

if (!PRIMARY_COORDINATOR || !PUBLIC_URL) {
    console.log("Uso: node server.js <PUERTO> <WS_COORDINADOR> <URL_PUBLICA>");
    process.exit(1);
}

const id = crypto.randomUUID();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let coordinadores = [PRIMARY_COORDINATOR];
let coordinadorActual = PRIMARY_COORDINATOR;

let ws = null;
let estado = "offline"; // alive | failover | offline
let lastHeartbeat = null;
let failoverEnCurso = false;
let intervaloPulso = null;
let intentoPrimarioEnCurso = false;
let socketSequence = 0;

function limpiarIntervaloPulso() {
    if (intervaloPulso) {
        clearInterval(intervaloPulso);
        intervaloPulso = null;
    }
}

function cerrarSocketActual() {
    if (!ws) return;

    try {
        ws.removeAllListeners();
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close();
        }
    } catch (error) {
        console.log("No se pudo cerrar el socket actual:", error.message);
    }

    ws = null;
}

function agregarCoordinador(url) {
    if (!url || typeof url !== "string") return;
    if (!coordinadores.includes(url)) {
        coordinadores.push(url);
        console.log("Coordinador agregado:", url);
    }
}

function registrarBackupsDesdeMensaje(data) {
    if (!data) return;

    if (Array.isArray(data.lista)) {
        data.lista.forEach(agregarCoordinador);
    }

    if (Array.isArray(data.backups)) {
        data.backups.forEach(agregarCoordinador);
    }
}

function iniciarPulso() {
    limpiarIntervaloPulso();
    intervaloPulso = setInterval(sendPulse, PULSE_INTERVAL);
}

function connect(targetUrl = coordinadorActual, options = {}) {
    const {
        triggerFailoverOnClose = true,
        updateCurrentCoordinator = true
    } = options;

    const connectionId = ++socketSequence;

    limpiarIntervaloPulso();
    cerrarSocketActual();

    if (updateCurrentCoordinator) {
        coordinadorActual = targetUrl;
    }

    console.log(`Conectando a: ${targetUrl}`);

    const socket = new WebSocket(targetUrl);
    ws = socket;

    socket.on("open", () => {
        if (connectionId !== socketSequence) return;

        console.log("Conectado al coordinador:", targetUrl);
        estado = "alive";

        register();
        iniciarPulso();
    });

    socket.on("message", (msg) => {
        if (connectionId !== socketSequence) return;

        try {
            const data = JSON.parse(msg.toString());
            console.log("Mensaje:", data);

            if (data.type === "backups") {
                registrarBackupsDesdeMensaje(data);
            }

            if (data.type === "register-ok" || data.type === "pulse-ok") {
                estado = "alive";
                lastHeartbeat = Date.now();
                registrarBackupsDesdeMensaje(data);
            }
        } catch (error) {
            console.log("Mensaje inválido");
        }
    });

    socket.on("error", (err) => {
        if (connectionId !== socketSequence) return;
        console.log("Error WS:", err.message);
    });

    socket.on("close", () => {
        if (connectionId !== socketSequence) return;

        console.log("Conexión cerrada con:", targetUrl);
        limpiarIntervaloPulso();

        if (triggerFailoverOnClose) {
            hacerFailover();
        }
    });
}

function register() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({
        type: "register",
        id,
        url: PUBLIC_URL
    }));

    estado = "alive";
    console.log(`Registrado en ${coordinadorActual}`);
}

function sendPulse() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.log("No se pudo enviar pulso: socket no disponible");
        hacerFailover();
        return;
    }

    try {
        ws.send(JSON.stringify({
            type: "pulse",
            id
        }));

        lastHeartbeat = Date.now();
        estado = "alive";
        console.log(`Pulso enviado a ${coordinadorActual}`);
    } catch (error) {
        console.log("Error enviando pulso:", error.message);
        hacerFailover();
    }
}

function hacerFailover() {
    if (failoverEnCurso) return;

    failoverEnCurso = true;
    estado = "failover";
    limpiarIntervaloPulso();

    const anterior = coordinadorActual;
    const candidatos = coordinadores.filter((c) => c !== anterior);

    if (candidatos.length === 0) {
        console.log("No hay coordinadores disponibles");
        estado = "offline";
        failoverEnCurso = false;
        return;
    }

    const siguiente = candidatos[0];
    console.log("Iniciando failover...");
    console.log("Intentando con:", siguiente);

    connect(siguiente, {
        triggerFailoverOnClose: true,
        updateCurrentCoordinator: true
    });

    failoverEnCurso = false;
}

function intentarReconectarAlPrimario() {
    const primario = coordinadores[0];

    if (!primario) return;
    if (coordinadorActual === primario) return;
    if (intentoPrimarioEnCurso) return;

    intentoPrimarioEnCurso = true;
    console.log("Intentando volver al primario:", primario);

    const testSocket = new WebSocket(primario);

    const cleanup = () => {
        testSocket.removeAllListeners();
        try {
            if (
                testSocket.readyState === WebSocket.OPEN ||
                testSocket.readyState === WebSocket.CONNECTING
            ) {
                testSocket.close();
            }
        } catch (_) {}
        intentoPrimarioEnCurso = false;
    };

    testSocket.on("open", () => {
        console.log("Primario disponible nuevamente:", primario);
        cleanup();

        connect(primario, {
            triggerFailoverOnClose: true,
            updateCurrentCoordinator: true
        });
    });

    testSocket.on("error", () => {
        console.log("Primario todavía no disponible");
        cleanup();
    });

    testSocket.on("close", () => {
        intentoPrimarioEnCurso = false;
    });
}

app.get("/status", (req, res) => {
    res.json({
        id,
        status: estado,
        coordinator: coordinadorActual,
        lista: coordinadores,
        timeStamp: Date.now(),
        lastHeartbeat
    });
});

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
    console.log(`Worker ${id} en http://localhost:${PORT}`);
    connect(PRIMARY_COORDINATOR);

    setInterval(intentarReconectarAlPrimario, PRIMARY_RETRY_INTERVAL);
});