const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 9000;

const ALLOWED_CHARGERS = (process.env.ALLOWED_CHARGERS || '')
  .split(',')
  .map(x => x.trim())
  .filter(Boolean);

const server = http.createServer();
const wss = new WebSocket.Server({ server });

const chargers = new Map();

console.log('🔐 Allowed chargers:', ALLOWED_CHARGERS);

function now() {
  return new Date().toISOString();
}

function ocppResponse(uniqueId, payload = {}) {
  return JSON.stringify([3, uniqueId, payload]);
}

function ocppError(uniqueId, code, description) {
  return JSON.stringify([4, uniqueId, code, description, {}]);
}

wss.on('connection', (ws, req) => {
  const urlParts = req.url.split('/').filter(Boolean);
  const chargePointId = urlParts[urlParts.length - 1] || 'unknown';

  // 🔒 Seguridad: validar cargador
  if (ALLOWED_CHARGERS.length && !ALLOWED_CHARGERS.includes(chargePointId)) {
    console.log(`⛔ Cargador no autorizado: ${chargePointId}`);
    ws.close(1008, 'Unauthorized charge point');
    return;
  }

  // Guardar cargadores conectados
  chargers.set(chargePointId, {
    id: chargePointId,
    connectedAt: now(),
    lastSeenAt: now(),
    ws,
  });

  console.log(`✅ Cargador conectado: ${chargePointId}`);

  ws.on('message', (raw) => {
    console.log(`📩 ${chargePointId} → ${raw}`);

    let msg;

    try {
      msg = JSON.parse(raw);
    } catch (e) {
      console.error('❌ JSON inválido');
      return;
    }

    const [messageTypeId, uniqueId, action, payload] = msg;

    if (messageTypeId !== 2) {
      console.log('⚠️ Mensaje no CALL, ignorado');
      return;
    }

    chargers.get(chargePointId).lastSeenAt = now();

    switch (action) {
      case 'BootNotification':
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
        ws.send(
          ocppResponse(uniqueId, {
            currentTime: now(),
          })
        );
        break;

      case 'StatusNotification':
        console.log(`🔌 Estado ${chargePointId}:`, payload);
        ws.send(ocppResponse(uniqueId, {}));
        break;

      case 'Authorize':
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
        console.log(`📊 MeterValues ${chargePointId}:`, payload);
        ws.send(ocppResponse(uniqueId, {}));
        break;

      default:
        console.log(`⚠️ Acción no implementada: ${action}`);
        ws.send(ocppError(uniqueId, 'NotImplemented', `Action ${action} not implemented`));
        break;
    }
  });

  ws.on('close', () => {
    chargers.delete(chargePointId);
    console.log(`🔴 Cargador desconectado: ${chargePointId}`);
  });

  ws.on('error', (err) => {
    console.error(`❌ Error en ${chargePointId}:`, err.message);
  });
});

server.on('request', (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      connectedChargers: chargers.size,
      time: now(),
    }));
    return;
  }

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

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`⚡ Servidor OCPP escuchando en ws://0.0.0.0:${PORT}`);
});