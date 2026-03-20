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
const CONNECTION_TIMEOUT = 4000;

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

// =========================
// UTILIDADES
// =========================
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
        if (
            ws.readyState === WebSocket.OPEN ||
            ws.readyState === WebSocket.CONNECTING
        ) {
            ws.close();
        }
    } catch (error) {
        console.log("No se pudo cerrar el socket actual:", error.message);
    }

    ws = null;
}

function esWebSocketValido(url) {
    return typeof url === "string" && /^wss?:\/\/.+/i.test(url.trim());
}

function agregarCoordinador(url) {
    if (!esWebSocketValido(url)) return;

    const limpio = url.trim();

    if (!coordinadores.includes(limpio)) {
        coordinadores.push(limpio);
        console.log("Coordinador agregado:", limpio);
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

function attachSocketListeners(socket, targetUrl, options = {}) {
    const {
        triggerFailoverOnClose = true
    } = options;

    const connectionId = ++socketSequence;
    ws = socket;

    socket.on("open", () => {
        if (connectionId !== socketSequence) return;

        console.log("Conectado al coordinador:", targetUrl);
        coordinadorActual = targetUrl;
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

function connect(targetUrl = coordinadorActual, options = {}) {
    const {
        triggerFailoverOnClose = true
    } = options;

    limpiarIntervaloPulso();
    cerrarSocketActual();

    console.log(`Conectando a: ${targetUrl}`);

    const socket = new WebSocket(targetUrl);
    attachSocketListeners(socket, targetUrl, { triggerFailoverOnClose });
}

function probarConexion(url, timeout = CONNECTION_TIMEOUT) {
    return new Promise((resolve) => {
        let terminado = false;
        const testSocket = new WebSocket(url);

        const finalizar = (resultado) => {
            if (terminado) return;
            terminado = true;

            clearTimeout(timer);

            try {
                testSocket.removeAllListeners();
                if (
                    testSocket.readyState === WebSocket.OPEN ||
                    testSocket.readyState === WebSocket.CONNECTING
                ) {
                    testSocket.close();
                }
            } catch (_) {}

            resolve(resultado);
        };

        const timer = setTimeout(() => {
            console.log("Timeout conectando a:", url);
            finalizar(false);
        }, timeout);

        testSocket.on("open", () => {
            console.log("Coordinador disponible:", url);
            finalizar(true);
        });

        testSocket.on("error", () => {
            console.log("Coordinador no disponible:", url);
            finalizar(false);
        });

        testSocket.on("close", () => {
            if (!terminado) {
                finalizar(false);
            }
        });
    });
}

async function hacerFailover() {
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

    console.log("Iniciando failover...");
    console.log("Candidatos:", candidatos);

    for (const candidato of candidatos) {
        const disponible = await probarConexion(candidato);

        if (disponible) {
            console.log("Failover exitoso. Nuevo coordinador:", candidato);

            connect(candidato, {
                triggerFailoverOnClose: true
            });

            failoverEnCurso = false;
            return;
        }
    }

    console.log("Ningún backup disponible");
    estado = "offline";
    failoverEnCurso = false;
}

async function cambiarCoordinadorManual(nuevoUrl) {
    if (!esWebSocketValido(nuevoUrl)) {
        return {
            ok: false,
            message: "URL de WebSocket inválida. Debe iniciar con ws:// o wss://"
        };
    }

    const url = nuevoUrl.trim();

    agregarCoordinador(url);

    estado = "failover";
    limpiarIntervaloPulso();

    const disponible = await probarConexion(url);

    if (!disponible) {
        estado = ws && ws.readyState === WebSocket.OPEN ? "alive" : "offline";
        return {
            ok: false,
            message: "No fue posible conectarse manualmente al coordinador indicado"
        };
    }

    console.log("Cambio manual de coordinador a:", url);

    connect(url, {
        triggerFailoverOnClose: true
    });

    return {
        ok: true,
        message: "Cambio manual realizado correctamente",
        coordinator: url
    };
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
            triggerFailoverOnClose: true
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

// =========================
// API
// =========================
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

app.post("/coordinators/add", (req, res) => {
    const { url } = req.body || {};

    if (!esWebSocketValido(url)) {
        return res.status(400).json({
            ok: false,
            message: "URL inválida. Debe iniciar con ws:// o wss://"
        });
    }

    agregarCoordinador(url);

    return res.json({
        ok: true,
        message: "Coordinador agregado correctamente",
        lista: coordinadores
    });
});

app.post("/switch-coordinator", async (req, res) => {
    const { url } = req.body || {};

    if (!esWebSocketValido(url)) {
        return res.status(400).json({
            ok: false,
            message: "URL inválida. Debe iniciar con ws:// o wss://"
        });
    }

    const result = await cambiarCoordinadorManual(url);

    if (!result.ok) {
        return res.status(400).json(result);
    }

    return res.json({
        ...result,
        lista: coordinadores
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