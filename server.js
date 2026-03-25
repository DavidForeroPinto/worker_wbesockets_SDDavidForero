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

// Historial simple de tareas para monitoreo
let ultimaTarea = null;
let historialTareas = [];

// =========================
// UTILIDADES
// =========================
function limpiarIntervaloPulso() {
    if (intervaloPulso) {
        clearInterval(intervaloPulso);
        intervaloPulso = null;
    }
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

    intervaloPulso = setInterval(() => {
        if (lastHeartbeat && Date.now() - lastHeartbeat > CONNECTION_TIMEOUT) {
            console.log("Heartbeat expirado. Iniciando failover...");
            hacerFailover();
            return;
        }

        sendPulse();
    }, PULSE_INTERVAL);
}

function cerrarSocketActual() {
    if (!ws) return;

    const socketAnterior = ws;
    ws = null;

    try {
        if (socketAnterior.readyState === WebSocket.CONNECTING) {
            socketAnterior.terminate();
            return;
        }

        if (socketAnterior.readyState === WebSocket.OPEN) {
            socketAnterior.close();
        }
    } catch (error) {
        console.log("No se pudo cerrar el socket actual:", error.message);
    }
}

function enviarMensaje(payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.log("No se pudo enviar mensaje: socket no disponible");
        return false;
    }

    try {
        ws.send(JSON.stringify(payload));
        return true;
    } catch (error) {
        console.log("Error enviando mensaje:", error.message);
        return false;
    }
}

function register() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    enviarMensaje({
        type: "register",
        id,
        url: PUBLIC_URL
    });

    console.log(`Registrado en ${coordinadorActual}`);
}

// =========================
// MANEJO DE TASKS
// =========================
function registrarResultadoTarea(registro) {
    ultimaTarea = registro;
    historialTareas.push(registro);

    if (historialTareas.length > 20) {
        historialTareas = historialTareas.slice(-20);
    }
}

function resolverOperacion(data = {}) {
    const operacion = String(data.operacion || data.operation || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

    const a = Number(data.a);
    const b = Number(data.b);
    const n = Number(data.n);

    switch (operacion) {
        case "sum":
        case "suma":
            if (Number.isNaN(a) || Number.isNaN(b)) {
                throw new Error("La operación suma requiere valores numéricos 'a' y 'b'");
            }
            return a + b;

        case "subtract":
        case "resta":
            if (Number.isNaN(a) || Number.isNaN(b)) {
                throw new Error("La operación resta requiere valores numéricos 'a' y 'b'");
            }
            return a - b;

        case "multiply":
        case "multiplicacion":
        case "multiplicar":
            if (Number.isNaN(a) || Number.isNaN(b)) {
                throw new Error("La operación multiplicación requiere valores numéricos 'a' y 'b'");
            }
            return a * b;

        case "divide":
        case "division":
            if (Number.isNaN(a) || Number.isNaN(b)) {
                throw new Error("La operación división requiere valores numéricos 'a' y 'b'");
            }
            if (b === 0) {
                throw new Error("No se puede dividir por cero");
            }
            return a / b;

        case "square":
        case "cuadrado":
            if (Number.isNaN(n)) {
                throw new Error("La operación cuadrado requiere un valor numérico 'n'");
            }
            return n * n;

        default:
            throw new Error(`Operación no soportada: ${operacion || "vacía"}`);
    }
}

async function procesarTask(taskMessage) {
    const taskId = taskMessage.taskId || taskMessage.idTask || crypto.randomUUID();
    const payload = taskMessage.payload || taskMessage.data || {};

    console.log("Tarea recibida:", { taskId, payload });

    const inicio = Date.now();

    try {
        const result = resolverOperacion(payload);

        const registro = {
            taskId,
            status: "success",
            coordinator: coordinadorActual,
            receivedAt: inicio,
            finishedAt: Date.now(),
            payload,
            result
        };

        registrarResultadoTarea(registro);

        const enviado = enviarMensaje({
            type: "task-result",
            workerId: id,
            taskId,
            result,
            timeStamp: Date.now()
        });

        if (!enviado) {
            console.log("No se pudo enviar task-result");
        }

        console.log("Tarea procesada con éxito:", { taskId, result });
    } catch (error) {
        const registro = {
            taskId,
            status: "error",
            coordinator: coordinadorActual,
            receivedAt: inicio,
            finishedAt: Date.now(),
            payload,
            error: error.message
        };

        registrarResultadoTarea(registro);

        const enviado = enviarMensaje({
            type: "task-error",
            workerId: id,
            taskId,
            error: error.message,
            timeStamp: Date.now()
        });

        if (!enviado) {
            console.log("No se pudo enviar task-error");
        }

        console.log("Error procesando tarea:", { taskId, error: error.message });
    }
}

// =========================
// WEBSOCKET
// =========================
function connect(targetUrl = coordinadorActual, options = {}) {
    const {
        triggerFailoverOnClose = true
    } = options;

    limpiarIntervaloPulso();
    cerrarSocketActual();

    console.log(`Conectando a: ${targetUrl}`);

    const socket = new WebSocket(targetUrl);
    const connectionId = ++socketSequence;
    ws = socket;

    socket.on("open", () => {
        if (connectionId !== socketSequence) {
            try {
                socket.close();
            } catch (_) {}
            return;
        }

        console.log("Conectado al coordinador:", targetUrl);
        coordinadorActual = targetUrl;
        estado = "alive";
        lastHeartbeat = Date.now();
        failoverEnCurso = false;

        register();
        iniciarPulso();
    });

    socket.on("message", async (msg) => {
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

            if (data.type === "task") {
                await procesarTask(data);
            }
        } catch (error) {
            console.log("Mensaje inválido");
        }
    });

    socket.on("error", (err) => {
        if (connectionId !== socketSequence) {
            console.log("Error de socket viejo ignorado:", err.message);
            return;
        }

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
                    testSocket.terminate();
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

async function cambiarAlSiguienteBackupDisponible() {
    const backups = coordinadores.slice(1);
    const candidatos = backups.filter((c) => c !== coordinadorActual);

    if (candidatos.length === 0) {
        return {
            ok: false,
            message: "No hay backups disponibles distintos al coordinador actual"
        };
    }

    estado = "failover";
    limpiarIntervaloPulso();

    console.log("Buscando backup disponible...");
    console.log("Backups candidatos:", candidatos);

    for (const candidato of candidatos) {
        const disponible = await probarConexion(candidato);

        if (disponible) {
            console.log("Cambio exitoso al backup:", candidato);

            connect(candidato, {
                triggerFailoverOnClose: true
            });

            return {
                ok: true,
                message: `Cambio realizado al backup disponible: ${candidato}`,
                coordinator: candidato
            };
        }
    }

    estado = ws && ws.readyState === WebSocket.OPEN ? "alive" : "offline";

    return {
        ok: false,
        message: "Ningún backup de la lista está disponible"
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

    probarConexion(primario)
        .then((disponible) => {
            if (!disponible) {
                console.log("Primario todavía no disponible");
                return;
            }

            console.log("Primario disponible nuevamente:", primario);

            connect(primario, {
                triggerFailoverOnClose: true
            });
        })
        .catch((error) => {
            console.log("Error verificando primario:", error.message);
        })
        .finally(() => {
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
        lastHeartbeat,
        ultimaTarea,
        historialTareas
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

app.post("/switch-next-available", async (req, res) => {
    const result = await cambiarAlSiguienteBackupDisponible();

    if (!result.ok) {
        return res.status(400).json({
            ...result,
            lista: coordinadores
        });
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