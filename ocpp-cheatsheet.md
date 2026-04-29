# OCPP Cheatsheet

Guía rápida para entender y probar un servidor OCPP básico como este proyecto.

---

## 1. Qué es OCPP

**OCPP** significa **Open Charge Point Protocol**.

Es el protocolo que usan los cargadores de vehículos eléctricos para comunicarse con un backend central.

En una instalación típica:

```text
Cargador eléctrico  <-- WebSocket -->  Servidor OCPP
```

El cargador se conecta al servidor y le va enviando mensajes como:

- me he encendido
- sigo vivo
- este conector está disponible
- quiero autorizar esta tarjeta
- empieza una carga
- termina una carga
- estas son mis lecturas de energía

---

## 2. Protocolos: HTTP, HTTPS, WS y WSS

OCPP 1.6 JSON funciona sobre **WebSocket**.

| Caso | URL |
|---|---|
| HTTP normal | `http://servidor/health` |
| HTTPS normal | `https://servidor/health` |
| WebSocket sin TLS | `ws://servidor/<chargePointId>` |
| WebSocket con TLS | `wss://servidor/<chargePointId>` |

Si el servidor está detrás de un reverse proxy HTTPS, normalmente se usa:

```text
wss://your-domain.example.com/<chargePointId>
```

Ejemplo:

```text
wss://your-domain.example.com/your-charger-id
```

Internamente, Node puede seguir escuchando en:

```text
ws://0.0.0.0:9000
```

El HTTPS/WSS lo gestiona el reverse proxy.

---

## 3. Charge Point ID

El **Charge Point ID** identifica al cargador.

En este servidor se obtiene desde la URL:

```text
wss://servidor/your-charger-id
```

Entonces:

```text
chargePointId = your-charger-id
```

Si tienes lista blanca:

```env
ALLOWED_CHARGERS=your-charger-id,another-charger-id
```

solo podrán conectarse esos IDs.

---

## 4. Formato de mensajes OCPP 1.6 JSON

OCPP 1.6 JSON usa arrays.

### CALL

Mensaje enviado para pedir una acción.

```json
[2, "unique-id", "Action", { "payload": true }]
```

Ejemplo:

```json
[2, "123", "Heartbeat", {}]
```

Significado:

| Posición | Valor |
|---|---|
| `0` | `2`, indica CALL |
| `1` | ID único del mensaje |
| `2` | Acción OCPP |
| `3` | Payload |

---

### CALLRESULT

Respuesta correcta a un CALL.

```json
[3, "unique-id", { "payload": true }]
```

Ejemplo:

```json
[3, "123", { "currentTime": "2026-04-29T19:30:00.000Z" }]
```

---

### CALLERROR

Respuesta de error.

```json
[4, "unique-id", "ErrorCode", "Error description", {}]
```

Ejemplo:

```json
[4, "123", "NotImplemented", "Action Reset not implemented", {}]
```

---

## 5. Flujo típico de un cargador

Un flujo básico suele ser:

```text
1. Cargador conecta por WebSocket
2. BootNotification
3. Heartbeat periódico
4. StatusNotification
5. Authorize
6. StartTransaction
7. MeterValues durante la carga
8. StopTransaction
9. StatusNotification
```

---

## 6. Acciones OCPP básicas

### BootNotification

El cargador informa de que ha arrancado.

Ejemplo enviado por el cargador:

```json
[2, "boot-1", "BootNotification", {
  "chargePointVendor": "TestVendor",
  "chargePointModel": "TestModel"
}]
```

Respuesta del servidor:

```json
[3, "boot-1", {
  "status": "Accepted",
  "currentTime": "2026-04-29T19:30:00.000Z",
  "interval": 60
}]
```

Campos importantes:

| Campo | Significado |
|---|---|
| `status` | `Accepted`, `Rejected` o `Pending` |
| `currentTime` | hora actual del servidor |
| `interval` | cada cuántos segundos debe mandar `Heartbeat` |

---

### Heartbeat

El cargador indica que sigue vivo.

```json
[2, "hb-1", "Heartbeat", {}]
```

Respuesta:

```json
[3, "hb-1", {
  "currentTime": "2026-04-29T19:30:00.000Z"
}]
```

---

### StatusNotification

El cargador informa del estado de un conector.

```json
[2, "status-1", "StatusNotification", {
  "connectorId": 1,
  "status": "Available",
  "errorCode": "NoError"
}]
```

Respuesta:

```json
[3, "status-1", {}]
```

Estados habituales:

| Estado | Significado |
|---|---|
| `Available` | disponible |
| `Preparing` | preparando carga |
| `Charging` | cargando |
| `SuspendedEV` | pausado por el vehículo |
| `SuspendedEVSE` | pausado por el cargador |
| `Finishing` | finalizando |
| `Reserved` | reservado |
| `Unavailable` | no disponible |
| `Faulted` | error |

---

### Authorize

El cargador pide validar un `idTag`, normalmente una tarjeta RFID o usuario.

```json
[2, "auth-1", "Authorize", {
  "idTag": "TAG123"
}]
```

Respuesta:

```json
[3, "auth-1", {
  "idTagInfo": {
    "status": "Accepted"
  }
}]
```

Estados habituales de `idTagInfo.status`:

| Estado | Significado |
|---|---|
| `Accepted` | autorizado |
| `Blocked` | bloqueado |
| `Expired` | caducado |
| `Invalid` | inválido |
| `ConcurrentTx` | ya tiene otra transacción activa |

> En este servidor básico, ahora mismo se acepta cualquier `idTag`. Para producción habría que validarlo contra base de datos.

---

### StartTransaction

El cargador informa de que empieza una carga.

```json
[2, "start-1", "StartTransaction", {
  "connectorId": 1,
  "idTag": "TAG123",
  "meterStart": 1000,
  "timestamp": "2026-04-29T19:30:00.000Z"
}]
```

Respuesta:

```json
[3, "start-1", {
  "transactionId": 123456789,
  "idTagInfo": {
    "status": "Accepted"
  }
}]
```

Campos importantes:

| Campo | Significado |
|---|---|
| `connectorId` | conector usado |
| `idTag` | usuario/tarjeta |
| `meterStart` | lectura inicial del contador |
| `timestamp` | fecha/hora de inicio |
| `transactionId` | ID de transacción generado por el servidor |

---

### MeterValues

El cargador envía lecturas durante la carga.

```json
[2, "meter-1", "MeterValues", {
  "connectorId": 1,
  "transactionId": 123456789,
  "meterValue": [
    {
      "timestamp": "2026-04-29T19:35:00.000Z",
      "sampledValue": [
        {
          "value": "1050",
          "measurand": "Energy.Active.Import.Register",
          "unit": "Wh"
        }
      ]
    }
  ]
}]
```

Respuesta:

```json
[3, "meter-1", {}]
```

Measurands habituales:

| Measurand | Significado |
|---|---|
| `Energy.Active.Import.Register` | energía acumulada importada |
| `Power.Active.Import` | potencia activa instantánea |
| `Current.Import` | corriente |
| `Voltage` | tensión |
| `SoC` | estado de carga de la batería |
| `Temperature` | temperatura |

---

### StopTransaction

El cargador informa de que termina una carga.

```json
[2, "stop-1", "StopTransaction", {
  "transactionId": 123456789,
  "idTag": "TAG123",
  "meterStop": 1800,
  "timestamp": "2026-04-29T20:00:00.000Z",
  "reason": "Local"
}]
```

Respuesta:

```json
[3, "stop-1", {
  "idTagInfo": {
    "status": "Accepted"
  }
}]
```

Razones habituales:

| Reason | Significado |
|---|---|
| `Local` | parada local en el cargador |
| `Remote` | parada remota desde backend |
| `EVDisconnected` | vehículo desconectado |
| `HardReset` | reinicio fuerte |
| `SoftReset` | reinicio suave |
| `Other` | otro motivo |

---

## 7. Probar con wscat

Instalar `wscat`:

```bash
npm install -g wscat
```

Conectar por WSS:

```bash
wscat -c wss://your-domain.example.com/<chargePointId>
```

Enviar BootNotification:

```json
[2,"boot-1","BootNotification",{"chargePointVendor":"TestVendor","chargePointModel":"TestModel"}]
```

Enviar Heartbeat:

```json
[2,"hb-1","Heartbeat",{}]
```

Enviar StatusNotification:

```json
[2,"status-1","StatusNotification",{"connectorId":1,"status":"Available","errorCode":"NoError"}]
```

Enviar Authorize:

```json
[2,"auth-1","Authorize",{"idTag":"TAG123"}]
```

Enviar StartTransaction:

```json
[2,"start-1","StartTransaction",{"connectorId":1,"idTag":"TAG123","meterStart":1000,"timestamp":"2026-04-29T19:30:00.000Z"}]
```

Enviar MeterValues:

```json
[2,"meter-1","MeterValues",{"connectorId":1,"transactionId":123456789,"meterValue":[{"timestamp":"2026-04-29T19:35:00.000Z","sampledValue":[{"value":"1050","measurand":"Energy.Active.Import.Register","unit":"Wh"}]}]}]
```

Enviar StopTransaction:

```json
[2,"stop-1","StopTransaction",{"transactionId":123456789,"idTag":"TAG123","meterStop":1800,"timestamp":"2026-04-29T20:00:00.000Z","reason":"Local"}]
```

---

## 8. Endpoints auxiliares del servidor

Estos endpoints no son OCPP. Son solo para debug.

### Healthcheck

```bash
curl https://your-domain.example.com/health
```

Respuesta esperada:

```json
{
  "status": "ok",
  "connectedChargers": 0,
  "time": "2026-04-29T19:30:00.000Z"
}
```

---

### Cargadores conectados

```bash
curl https://your-domain.example.com/chargers
```

Respuesta esperada:

```json
[
  {
    "id": "your-charger-id",
    "connectedAt": "2026-04-29T19:30:00.000Z",
    "lastSeenAt": "2026-04-29T19:31:00.000Z"
  }
]
```

---

## 9. Seguridad mínima recomendada

Para pruebas en LAN o laboratorio, este servidor básico está bien.

Para exponerlo a Internet conviene como mínimo:

- usar `wss://`, no `ws://`
- tener reverse proxy HTTPS delante
- no exponer directamente el puerto interno `9000`
- publicar Docker solo en localhost:

```yaml
ports:
  - "127.0.0.1:9000:9000"
```

- usar lista blanca de cargadores:

```env
ALLOWED_CHARGERS=<your-charger-ids>
```

- no aceptar cualquier `Authorize`
- no aceptar cualquier `StartTransaction`
- no guardar logs con datos sensibles sin control
- añadir base de datos para cargadores, usuarios y transacciones
- añadir rate limit o protección en proxy

---

## 10. Variables de entorno útiles

```env
PORT=9000
ALLOWED_CHARGERS=your-charger-id,another-charger-id
```

En `docker-compose.yml` público es mejor usar sustitución:

```yaml
environment:
  - PORT=${PORT:-9000}
  - ALLOWED_CHARGERS=${ALLOWED_CHARGERS:-}
```

Y poner los valores reales en Portainer.

---

## 11. Docker y reverse proxy

Configuración recomendada para esta fase:

```yaml
services:
  ocpp-server:
    build: .
    container_name: ocpp-server
    ports:
      - "127.0.0.1:9000:9000"
    environment:
      - PORT=${PORT:-9000}
      - ALLOWED_CHARGERS=${ALLOWED_CHARGERS:-}
    restart: unless-stopped
```

Reverse proxy:

```text
Origen externo:
https://dominio-publico
wss://dominio-publico/<chargePointId>

Destino interno:
http://localhost:9000
ws://localhost:9000
```

---

## 12. Códigos de cierre WebSocket útiles

| Código | Uso |
|---|---|
| `1000` | cierre normal |
| `1002` | error de protocolo |
| `1003` | datos no soportados |
| `1008` | política violada / no autorizado |
| `1011` | error interno del servidor |

En este servidor se usa:

```js
ws.close(1008, 'Unauthorized charge point');
```

cuando el `chargePointId` no está en la lista blanca.

---

## 13. Checklist rápido

Antes de conectar un cargador real:

- [ ] El endpoint `/health` responde por HTTPS
- [ ] El WebSocket responde por WSS
- [ ] El proxy soporta `Upgrade: websocket`
- [ ] `ALLOWED_CHARGERS` está cargado correctamente
- [ ] El ID del cargador coincide con la URL
- [ ] El cargador apunta a `wss://dominio/chargePointId`
- [ ] El puerto 9000 no está abierto en el router
- [ ] Docker publica `127.0.0.1:9000:9000`, no `9000:9000`
- [ ] Los logs no contienen secretos ni tokens

---

## 14. Glosario rápido

| Término | Significado |
|---|---|
| Charge Point | cargador físico |
| Charge Point ID | identificador del cargador |
| Connector | toma/conector del cargador |
| idTag | identificador de usuario/tarjeta |
| Transaction | sesión de carga |
| MeterValues | lecturas enviadas por el cargador |
| BootNotification | aviso de arranque del cargador |
| Heartbeat | señal periódica de vida |
| Central System | servidor OCPP |
| CALL | mensaje de petición OCPP |
| CALLRESULT | respuesta correcta OCPP |
| CALLERROR | respuesta de error OCPP |