const http = require('http');
const WebSocket = require('ws');

// Puerto interno donde escucha Node dentro del contenedor.
// En Docker/Portainer normalmente llega desde docker-compose.yml con PORT=9000.
const PORT = process.env.PORT || 9000;

// Lista blanca de cargadores permitidos.
// Ejemplo de variable de entorno:
// ALLOWED_CHARGERS=charger-001,charger-002
//
// Si la variable viene vacía, ALLOWED_CHARGERS será [] y no se aplicará restricción.
const ALLOWED_CHARGERS = (process.env.ALLOWED_CHARGERS || '')
  .split(',')
  .map(x => x.trim())
  .filter(Boolean);

// Servidor HTTP base.
// Aunque desde fuera entres por HTTPS/WSS, Node escucha HTTP/WS internamente.
// El HTTPS lo termina el reverse proxy del NAS.
const server = http.createServer();

// Servidor WebSocket montado sobre el servidor HTTP.
// Aquí es donde se conectan los cargadores OCPP.
const wss = new WebSocket.Server({ server });

// Mapa en memoria de cargadores conectados.
// Clave: chargePointId
// Valor: datos del cargador + socket activo.
const chargers = new Map();

// Ping técnico a nivel WebSocket.
// No es un Heartbeat OCPP: solo sirve para mantener viva la conexión WebSocket
// y evitar cortes por timeout del reverse proxy cuando no hay tráfico.
const WS_PING_INTERVAL_MS = 30_000;

console.log('🔐 ALLOWED_CHARGERS:', ALLOWED_CHARGERS);

// Helper para generar fechas ISO, que es el formato esperado por OCPP.
function now() {
  return new Date().toISOString();
}

// Respuesta OCPP de tipo CALLRESULT.
// Formato OCPP JSON 1.6:
// [3, uniqueId, payload]
function ocppResponse(uniqueId, payload = {}) {
  return JSON.stringify([3, uniqueId, payload]);
}

// Respuesta OCPP de error.
// Formato OCPP JSON 1.6:
// [4, uniqueId, errorCode, errorDescription, errorDetails]
function ocppError(uniqueId, code, description) {
  return JSON.stringify([4, uniqueId, code, description, {}]);
}

// Evento principal: se ejecuta cada vez que un cargador abre una conexión WebSocket.
wss.on('connection', (ws, req) => {
  // El chargePointId lo sacamos del path del WebSocket.
  // Ejemplo:
  // wss://sergiogaldos.dnsalias.com/charger-001
  // chargePointId = charger-001
  const urlParts = req.url.split('/').filter(Boolean);
  const chargePointId = urlParts[urlParts.length - 1] || 'unknown';

  // Seguridad básica: si hay lista blanca configurada, solo permitimos esos IDs.
  if (ALLOWED_CHARGERS.length && !ALLOWED_CHARGERS.includes(chargePointId)) {
    console.log(`⛔ Cargador no autorizado: ${chargePointId}`);
    ws.close(1008, 'Unauthorized charge point');
    return;
  }

  // Marcador técnico para saber si el cliente responde a los ping WebSocket.
  // El cliente WebSocket responde con pong automáticamente si la conexión está viva.
  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // Guardamos el cargador como conectado.
  // Esto permite consultar luego /chargers y saber qué cargadores están vivos.
  chargers.set(chargePointId, {
    id: chargePointId,
    connectedAt: now(),
    lastSeenAt: now(),
    ws,
  });

  console.log(`✅ Cargador conectado: ${chargePointId}`);

  // Evento que se ejecuta cada vez que el cargador manda un mensaje OCPP.
  ws.on('message', (raw) => {
    // raw es el mensaje original recibido por WebSocket.
    console.log(`📩 ${chargePointId} → ${raw}`);

    let msg;

    // OCPP JSON llega como texto JSON. Primero intentamos parsearlo.
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      console.error('❌ JSON inválido');
      return;
    }

    // Estructura típica de un CALL OCPP:
    // [2, uniqueId, action, payload]
    const [messageTypeId, uniqueId, action, payload] = msg;

    // De momento este servidor solo procesa CALLs del cargador hacia el servidor.
    // Ignora otros tipos de mensaje como CALLRESULT o CALLERROR.
    if (messageTypeId !== 2) {
      console.log('⚠️ Mensaje no CALL, ignorado');
      return;
    }

    // Actualizamos la última vez que hemos visto actividad de este cargador.
    chargers.get(chargePointId).lastSeenAt = now();

    // Enrutador básico de acciones OCPP.
    // Cada case responde a una operación estándar enviada por el cargador.
    switch (action) {
      case 'BootNotification':
        // Primer mensaje típico al arrancar/conectarse un cargador.
        // Aquí aceptamos el cargador y le decimos cada cuántos segundos debe enviar Heartbeat.
        console.log(`🚀 BootNotification de ${chargePointId}`, payload);

        ws.send(
          ocppResponse(uniqueId, {
            status: 'Accepted',
            currentTime: now(),
            interval: 60,
          })
        );
        break;

      case 'Heartbeat':
        // Ping periódico del cargador para indicar que sigue vivo.
        // Respondemos con la hora actual del servidor.
        ws.send(
          ocppResponse(uniqueId, {
            currentTime: now(),
          })
        );
        break;

      case 'StatusNotification':
        // Estado del conector/cargador.
        // Ejemplos: Available, Preparing, Charging, SuspendedEV, Finishing, Faulted.
        console.log(`🔌 Estado ${chargePointId}:`, payload);
        ws.send(ocppResponse(uniqueId, {}));
        break;

      case 'Authorize':
        // Validación de una tarjeta, tag RFID, app o identificador de usuario.
        // Ahora mismo aceptamos todo: esto sirve para laboratorio, no para producción real.
        console.log(`🪪 Authorize ${chargePointId}:`, payload);
        ws.send(
          ocppResponse(uniqueId, {
            idTagInfo: {
              status: 'Accepted',
            },
          })
        );
        break;

      case 'StartTransaction':
        // Inicio de una sesión de carga.
        // Generamos un transactionId simple con Date.now() para pruebas.
        console.log(`▶️ StartTransaction ${chargePointId}:`, payload);
        ws.send(
          ocppResponse(uniqueId, {
            transactionId: Date.now(),
            idTagInfo: {
              status: 'Accepted',
            },
          })
        );
        break;

      case 'StopTransaction':
        // Fin de una sesión de carga.
        // Ahora mismo solo respondemos Accepted, sin guardar todavía datos en BD.
        console.log(`⏹️ StopTransaction ${chargePointId}:`, payload);
        ws.send(
          ocppResponse(uniqueId, {
            idTagInfo: {
              status: 'Accepted',
            },
          })
        );
        break;

      case 'MeterValues':
        // Lecturas de energía/potencia/medidas enviadas durante la carga.
        // Aquí es donde más adelante guardarías consumos en base de datos.
        console.log(`📊 MeterValues ${chargePointId}:`, payload);
        ws.send(ocppResponse(uniqueId, {}));
        break;

      default:
        // Cualquier acción OCPP que todavía no hayamos implementado.
        console.log(`⚠️ Acción no implementada: ${action}`);
        ws.send(ocppError(uniqueId, 'NotImplemented', `Action ${action} not implemented`));
        break;
    }
  });

  // Cuando el WebSocket se cierra, eliminamos el cargador del mapa de conectados.
  ws.on('close', () => {
    chargers.delete(chargePointId);
    console.log(`🔴 Cargador desconectado: ${chargePointId}`);
  });

  // Log de errores de conexión WebSocket.
  ws.on('error', (err) => {
    console.error(`❌ Error en ${chargePointId}:`, err.message);
  });
});

// Endpoints HTTP auxiliares.
// Estos no son OCPP; sirven para comprobar estado desde navegador/curl/proxy.
server.on('request', (req, res) => {
  // Healthcheck simple para saber si el proceso está vivo.
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      connectedChargers: chargers.size,
      time: now(),
    }));
    return;
  }

  // Lista de cargadores conectados actualmente.
  // Quitamos el objeto ws porque no es serializable ni interesa exponerlo.
  if (req.url === '/chargers') {
    res.writeHead(200, { 'Content-Type': 'application/json' });

    const list = Array.from(chargers.values()).map((c) => ({
      id: c.id,
      connectedAt: c.connectedAt,
      lastSeenAt: c.lastSeenAt,
    }));

    res.end(JSON.stringify(list, null, 2));
    return;
  }

  // Cualquier otra ruta HTTP devuelve 404.
  res.writeHead(404);
  res.end('Not found');
});

// Mantiene vivas las conexiones WebSocket y limpia sockets muertos.
// Si un cargador no responde al ping anterior, se termina la conexión.
setInterval(() => {
  chargers.forEach((charger, chargePointId) => {
    const ws = charger.ws;

    if (ws.readyState !== WebSocket.OPEN) {
      chargers.delete(chargePointId);
      return;
    }

    if (ws.isAlive === false) {
      console.log(`💀 Cargador sin respuesta al ping, cerrando conexión: ${chargePointId}`);
      ws.terminate();
      chargers.delete(chargePointId);
      return;
    }

    ws.isAlive = false;
    ws.ping();
  });
}, WS_PING_INTERVAL_MS);

// Arranque del servidor.
// Escucha en 0.0.0.0 para que Docker pueda exponerlo al host/reverse proxy.
server.listen(PORT, '0.0.0.0', () => {
  console.log(`⚡ Servidor OCPP escuchando en ws://0.0.0.0:${PORT}`);
});