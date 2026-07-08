import { EventEmitter } from 'node:events';
import * as crypto from 'node:crypto';
import * as http from 'node:http';

function createPluginLogger(pluginName, tag) {
  const scope = tag ? `Plugin:${pluginName}:${tag}` : `Plugin:${pluginName}`;
  return {
    debug: (...args) => console.debug(`[${scope}]`, ...args),
    info: (...args) => console.info(`[${scope}]`, ...args),
    warn: (...args) => console.warn(`[${scope}]`, ...args),
    error: (...args) => console.error(`[${scope}]`, ...args),
  };
}

function definePlugin(plugin) {
  return plugin;
}

const logger = createPluginLogger('xmeow-bar');
const SERVICE_ID = 'xmeow.adapter';
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const BRIDGE_SYMBOL = Symbol.for('xmeow-bar.web-platform-upgrade-bridge');

const DEFAULT_CONFIG = {
  enabled: true,
  session: { id: 'xmeow-bar', platform: 'xmeow-bar' },
  auth: { bearerToken: undefined, requireToken: false, allowMissingTokenOnLoopback: true },
  transport: {
    mode: 'auto',
    webPlatform: { enabled: true, allowPrivateUpgradeBridge: true },
    standalone: { enabled: false, host: '127.0.0.1', port: 8193 },
  },
  presence: {
    mood: 'calm',
    earDirection: 'relaxed',
    defaultMessage: '咪在菜单栏边缘打盹。',
    staleAfterSeconds: 7200,
  },
  events: {
    acceptedTaskSessionIds: [],
    includeSilentTaskResults: true,
    mappings: {
      qdii_report: { keywords: ['qdii', 'QDII', '溢价', '纳指', 'ETF', '日报'] },
      random_wake: { keywords: ['random_wake', '随机唤醒', 'virtual-lover', 'proactive', '主动消息', '找你'] },
      honey_mail: { keywords: ['honey_mail', '蜜语', '邮件', 'mail'] },
      diary_completed: { keywords: ['diary', '日记', '凌晨日记'] },
    },
  },
};

const defaultConfigTemplate = `# XMeow Bar Iris adapter defaults.\nxmeow:\n  enabled: true\n\n  session:\n    id: xmeow-bar\n    platform: xmeow-bar\n    agentName: null\n\n  auth:\n    bearerToken: ""\n    requireToken: false\n    allowMissingTokenOnLoopback: true\n\n  transport:\n    mode: auto\n    webPlatform:\n      enabled: true\n      allowPrivateUpgradeBridge: true\n    standalone:\n      enabled: false\n      host: 127.0.0.1\n      port: 8193\n\n  presence:\n    mood: calm\n    earDirection: relaxed\n    defaultMessage: "咪在菜单栏边缘打盹。"\n    staleAfterSeconds: 7200\n\n  events:\n    acceptedTaskSessionIds: []\n    includeSilentTaskResults: true\n    mappings:\n      qdii_report:\n        keywords: ["qdii", "QDII", "溢价", "纳指", "ETF", "日报"]\n      random_wake:\n        keywords: ["random_wake", "随机唤醒", "virtual-lover", "proactive", "主动消息", "找你"]\n      honey_mail:\n        keywords: ["honey_mail", "蜜语", "邮件", "mail"]\n      diary_completed:\n        keywords: ["diary", "日记", "凌晨日记"]\n`;

function parseXMeowConfig(raw) {
  const root = asRecord(raw);
  const source = asRecord(root.xmeow ?? raw);
  const session = asRecord(source.session);
  const auth = asRecord(source.auth);
  const transport = asRecord(source.transport);
  const webPlatform = asRecord(transport.webPlatform);
  const standalone = asRecord(transport.standalone);
  const presence = asRecord(source.presence);
  const events = asRecord(source.events);
  return {
    enabled: optionalBoolean(source.enabled) ?? DEFAULT_CONFIG.enabled,
    session: {
      id: nonEmptyString(session.id, DEFAULT_CONFIG.session.id),
      platform: nonEmptyString(session.platform, DEFAULT_CONFIG.session.platform),
      agentName: optionalString(session.agentName) || undefined,
    },
    auth: {
      bearerToken: optionalString(auth.bearerToken) || undefined,
      requireToken: optionalBoolean(auth.requireToken) ?? DEFAULT_CONFIG.auth.requireToken,
      allowMissingTokenOnLoopback: optionalBoolean(auth.allowMissingTokenOnLoopback) ?? DEFAULT_CONFIG.auth.allowMissingTokenOnLoopback,
    },
    transport: {
      mode: parseTransportMode(optionalString(transport.mode), DEFAULT_CONFIG.transport.mode),
      webPlatform: {
        enabled: optionalBoolean(webPlatform.enabled) ?? DEFAULT_CONFIG.transport.webPlatform.enabled,
        allowPrivateUpgradeBridge: optionalBoolean(webPlatform.allowPrivateUpgradeBridge) ?? DEFAULT_CONFIG.transport.webPlatform.allowPrivateUpgradeBridge,
      },
      standalone: {
        enabled: optionalBoolean(standalone.enabled) ?? DEFAULT_CONFIG.transport.standalone.enabled,
        host: nonEmptyString(standalone.host, DEFAULT_CONFIG.transport.standalone.host),
        port: clampInteger(standalone.port, DEFAULT_CONFIG.transport.standalone.port, 1, 65535),
      },
    },
    presence: {
      mood: nonEmptyString(presence.mood, DEFAULT_CONFIG.presence.mood),
      earDirection: nonEmptyString(presence.earDirection, DEFAULT_CONFIG.presence.earDirection),
      defaultMessage: nonEmptyString(presence.defaultMessage, DEFAULT_CONFIG.presence.defaultMessage),
      staleAfterSeconds: clampNumber(presence.staleAfterSeconds, DEFAULT_CONFIG.presence.staleAfterSeconds, 0, 30 * 24 * 60 * 60),
    },
    events: {
      acceptedTaskSessionIds: stringArray(events.acceptedTaskSessionIds),
      includeSilentTaskResults: optionalBoolean(events.includeSilentTaskResults) ?? DEFAULT_CONFIG.events.includeSilentTaskResults,
      mappings: parseMappings(events.mappings),
    },
  };
}

function parseTransportMode(value, fallback) {
  return ['auto', 'web-platform', 'standalone', 'off'].includes(value) ? value : fallback;
}

function parseMappings(raw) {
  const source = asRecord(raw);
  const result = { ...DEFAULT_CONFIG.events.mappings };
  for (const [eventType, value] of Object.entries(source)) {
    const keywords = stringArray(asRecord(value).keywords);
    if (keywords.length > 0) result[eventType] = { keywords };
  }
  return result;
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function optionalString(value) { return typeof value === 'string' ? value.trim() : undefined; }
function nonEmptyString(value, fallback) { const parsed = optionalString(value); return parsed ? parsed : fallback; }
function optionalBoolean(value) { return typeof value === 'boolean' ? value : undefined; }
function clampInteger(value, fallback, min, max) { const parsed = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback; return Math.max(min, Math.min(max, parsed)); }
function clampNumber(value, fallback, min, max) { const parsed = typeof value === 'number' && Number.isFinite(value) ? value : fallback; return Math.max(min, Math.min(max, parsed)); }
function stringArray(value) { return Array.isArray(value) ? value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : []; }
function nowMs() { return Date.now(); }
function makeId(prefix = 'xmeow') { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
function safeMetadata(input) { const metadata = {}; for (const [key, value] of Object.entries(input)) { if (value !== undefined && value !== null) metadata[key] = typeof value === 'string' ? value : String(value); } return metadata; }

function initialPresence(config, startedAt = nowMs()) {
  return {
    mood: config.presence.mood,
    earDirection: config.presence.earDirection,
    unreadCount: 0,
    latestMessage: config.presence.defaultMessage,
    startedAt,
  };
}

function statusEnvelope(state, config, lifecycle, timestamp = nowMs()) {
  const lastInteractionAgo = state.lastInteractionAt ? Math.max(0, (timestamp - state.lastInteractionAt) / 1000) : undefined;
  return {
    type: 'event',
    event_type: 'status_update',
    mood: state.mood || config.presence.mood,
    ear_direction: state.earDirection || config.presence.earDirection,
    last_interaction_ago_sec: lastInteractionAgo,
    last_interaction_at: state.lastInteractionAt,
    unread_count: Math.max(0, state.unreadCount),
    message: state.latestMessage || config.presence.defaultMessage,
    timestamp,
    metadata: safeMetadata({
      plugin: 'xmeow-bar',
      protocol_version: '1',
      transport_mode: lifecycle.transportMode,
      websocket_clients: lifecycle.websocketClients,
      web_platform_bridge: lifecycle.webPlatformBridge,
      standalone_server: lifecycle.standaloneServer,
      plugin_active: lifecycle.pluginActive,
    }),
  };
}

function applyOutboundEvent(state, event) {
  const next = { ...state };
  next.lastEventAt = event.timestamp ?? nowMs();
  const visible = event.message ?? event.text ?? event.summary;
  if (visible) next.latestMessage = visible;
  if (event.type === 'chat_response') {
    next.unreadCount = 0;
    next.lastInteractionAt = event.timestamp ?? nowMs();
    next.mood = 'calm';
    next.earDirection = 'relaxed';
    return next;
  }
  if (event.type === 'event' && event.event_type && event.event_type !== 'status_update') {
    next.unreadCount += 1;
    next.earDirection = 'up';
    if (event.event_type === 'random_wake') next.mood = 'curious';
    if (event.event_type === 'qdii_report') next.mood = 'focused';
  }
  return next;
}

function markUserInput(state, text, timestamp = nowMs()) {
  return { ...state, latestMessage: text, lastInteractionAt: timestamp, unreadCount: 0, mood: 'focused', earDirection: 'relaxed' };
}

function shouldAcceptTaskSession(sessionId, config) {
  const accepted = config.events.acceptedTaskSessionIds;
  return accepted.length === 0 || accepted.includes(sessionId);
}

function mapAgentNotification(input, config) {
  if (!shouldAcceptTaskSession(input.sessionId, config)) return undefined;
  if (input.silent && !config.events.includeSilentTaskResults) return undefined;
  const eventType = inferEventType([input.taskType, input.status, input.summary, input.taskId], config) ?? 'agent_notification';
  return {
    type: 'event',
    event_type: eventType,
    id: makeId('xmeow-agent'),
    message: input.summary,
    summary: input.summary,
    timestamp: nowMs(),
    metadata: safeMetadata({
      source: 'backend.agent_notification',
      session_id: input.sessionId,
      task_id: input.taskId,
      task_status: input.status,
      task_type: input.taskType,
      silent: input.silent,
    }),
  };
}

function mapTaskResult(input, config) {
  if (!shouldAcceptTaskSession(input.sessionId, config)) return undefined;
  if (input.silent && !config.events.includeSilentTaskResults) return undefined;
  const eventType = inferEventType([input.taskType, input.status, input.description, input.result, input.taskId], config) ?? 'task_result';
  const text = input.result?.trim() || input.description;
  return {
    type: 'event',
    event_type: eventType,
    id: makeId('xmeow-task'),
    message: eventType === 'random_wake' ? text : undefined,
    summary: text,
    timestamp: nowMs(),
    metadata: safeMetadata({
      source: 'backend.task_result',
      session_id: input.sessionId,
      task_id: input.taskId,
      task_status: input.status,
      task_type: input.taskType,
      silent: input.silent,
    }),
  };
}

function makeChatResponse(text, sessionId) {
  return { type: 'chat_response', text, timestamp: nowMs(), metadata: safeMetadata({ source: 'backend.response', session_id: sessionId }) };
}

function makeGenericNotice(message, metadata = {}) {
  return { type: 'event', event_type: 'generic_notice', id: makeId('xmeow-notice'), message, timestamp: nowMs(), metadata: safeMetadata({ source: 'xmeow.adapter', ...metadata }) };
}

function inferEventType(parts, config) {
  const haystack = parts.filter(Boolean).join('\n').toLocaleLowerCase();
  for (const [eventType, mapping] of Object.entries(config.events.mappings)) {
    for (const keyword of mapping.keywords) {
      if (keyword && haystack.includes(keyword.toLocaleLowerCase())) return eventType;
    }
  }
  return undefined;
}

class XMeowAdapterService extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.presence = initialPresence(config);
    this.lifecycle = {
      pluginActive: true,
      websocketClients: 0,
      transportMode: config.transport.mode,
      webPlatformBridge: 'not-requested',
      standaloneServer: 'not-requested',
    };
  }
  setApi(api) { this.api = api; }
  updateConfig(config) { this.config = config; this.lifecycle.transportMode = config.transport.mode; if (!this.presence.latestMessage) this.presence.latestMessage = config.presence.defaultMessage; }
  setLifecycle(update) { this.lifecycle = { ...this.lifecycle, ...update }; this.emitStatus(); }
  getStatus() { return statusEnvelope(this.presence, this.config, this.lifecycle); }
  getSnapshot() { return { status: this.getStatus(), lifecycle: { ...this.lifecycle } }; }
  publish(event) { this.presence = applyOutboundEvent(this.presence, event); this.emit('envelope', event); this.emitStatus(); }
  async handleClientMessage(raw) {
    let message;
    try { message = JSON.parse(raw); } catch { return makeGenericNotice('XMeow 收到无法解析的消息。', { error: 'invalid_json' }); }
    switch (message.type) {
    case 'ping': return { type: 'pong', timestamp: nowMs() };
    case 'get_status': return this.getStatus();
    case 'user_input': return await this.handleUserInput(typeof message.text === 'string' ? message.text : '');
    default: return makeGenericNotice(`XMeow 不认识的消息类型: ${message.type ?? 'unknown'}`, { error: 'unknown_message_type' });
    }
  }
  async handleUserInput(text) {
    const trimmed = text.trim();
    if (!trimmed) return makeGenericNotice('空消息没有发送给 Iris。', { reason: 'empty_user_input' });
    if (!this.api?.backend?.chat) return makeGenericNotice('Iris backend 尚未就绪，消息没有发送。', { reason: 'backend_unavailable' });
    const timestamp = nowMs();
    this.presence = markUserInput(this.presence, trimmed, timestamp);
    this.emitStatus();
    try {
      await this.api.backend.chat(this.config.session.id, trimmed, undefined, undefined, this.config.session.platform);
      return undefined;
    } catch (error) {
      return makeGenericNotice('发送给 Iris 失败。', { reason: error instanceof Error ? error.message : String(error) });
    }
  }
  onEnvelope(listener) { this.on('envelope', listener); return { dispose: () => this.off('envelope', listener) }; }
  onStatus(listener) { this.on('status', listener); return { dispose: () => this.off('status', listener) }; }
  markClientCount(count) { if (this.lifecycle.websocketClients === count) return; this.lifecycle.websocketClients = count; this.emitStatus(); }
  deactivate() { this.lifecycle.pluginActive = false; this.removeAllListeners(); }
  emitStatus() { this.emit('status', this.getStatus()); }
}

function wireBackendEvents(api, adapter, getConfig) {
  const backend = api.backend;
  const onResponse = (sessionId, text) => { const config = getConfig(); if (sessionId !== config.session.id) return; adapter.publish(makeChatResponse(text, sessionId)); };
  const onError = (sessionId, message) => { const config = getConfig(); if (sessionId !== config.session.id) return; adapter.publish(makeGenericNotice(message, { source: 'backend.error', session_id: sessionId })); };
  const onAgentNotification = (sessionId, taskId, status, summary, taskType, silent) => {
    const event = mapAgentNotification({ sessionId, taskId, status, summary, taskType, silent }, getConfig());
    if (event) adapter.publish(event);
  };
  const onTaskResult = (sessionId, taskId, status, description, taskType, silent, result) => {
    const event = mapTaskResult({ sessionId, taskId, status, description, taskType, silent, result }, getConfig());
    if (event) adapter.publish(event);
  };
  backend.on('response', onResponse);
  backend.on('error', onError);
  backend.on('agent:notification', onAgentNotification);
  backend.on('task:result', onTaskResult);
  return { dispose() { backend.off('response', onResponse); backend.off('error', onError); backend.off('agent:notification', onAgentNotification); backend.off('task:result', onTaskResult); } };
}

function registerStatusRoute(api, adapter, getConfig) {
  if (!api.registerWebRoute) return undefined;
  return api.registerWebRoute('GET', '/api/xmeow/status', async (req, res) => {
    if (!isAuthorized(req, getConfig())) {
      sendJSON(res, 401, { error: 'Unauthorized' });
      return;
    }
    sendJSON(res, 200, adapter.getStatus());
  });
}

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function isAuthorized(req, config) {
  const expected = config.auth.bearerToken?.trim();
  if (!expected) return !config.auth.requireToken || isLoopback(req, config);
  const auth = req.headers.authorization ?? '';
  const tokenFromHeader = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
  if (tokenFromHeader && safeEqual(tokenFromHeader, expected)) return true;
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const tokenFromQuery = url.searchParams.get('token')?.trim() ?? '';
  if (tokenFromQuery && safeEqual(tokenFromQuery, expected)) return true;
  return !config.auth.requireToken && config.auth.allowMissingTokenOnLoopback && isLoopback(req, config);
}
function isLoopback(req, config) { if (!config.auth.allowMissingTokenOnLoopback) return false; const address = req.socket.remoteAddress ?? ''; return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'; }
function safeEqual(a, b) { if (a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }

class MinimalWebSocketConnection {
  constructor(socket, head) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    this.messageListeners = new Set();
    this.closeListeners = new Set();
    this.socket.on('data', (chunk) => this.receive(chunk));
    this.socket.on('close', () => this.markClosed());
    this.socket.on('error', () => this.markClosed());
    if (head && head.length > 0) this.receive(head);
  }
  onMessage(listener) { this.messageListeners.add(listener); return { dispose: () => this.messageListeners.delete(listener) }; }
  onClose(listener) { this.closeListeners.add(listener); return { dispose: () => this.closeListeners.delete(listener) }; }
  sendJSON(value) { this.sendText(JSON.stringify(value)); }
  sendText(text) { if (!this.closed) this.socket.write(encodeFrame(Buffer.from(text, 'utf8'), 0x1)); }
  close(code = 1000, reason = '') {
    if (this.closed) return;
    const reasonBuffer = Buffer.from(reason, 'utf8');
    const payload = Buffer.alloc(2 + reasonBuffer.length);
    payload.writeUInt16BE(code, 0);
    reasonBuffer.copy(payload, 2);
    this.socket.write(encodeFrame(payload, 0x8));
    this.socket.end();
    this.markClosed();
  }
  receive(chunk) {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const parsed = tryDecodeFrame(this.buffer);
      if (!parsed) return;
      this.buffer = this.buffer.subarray(parsed.consumed);
      switch (parsed.opcode) {
      case 0x1: this.emitMessage(parsed.payload.toString('utf8')); break;
      case 0x8: this.close(); return;
      case 0x9: this.socket.write(encodeFrame(parsed.payload, 0xA)); break;
      case 0xA: break;
      default: this.close(1003, 'unsupported frame'); return;
      }
    }
  }
  emitMessage(text) { for (const listener of this.messageListeners) void listener(text); }
  markClosed() { if (this.closed) return; this.closed = true; for (const listener of this.closeListeners) listener(); this.messageListeners.clear(); this.closeListeners.clear(); }
}

class MinimalWebSocketServer {
  handleUpgrade(req, socket, head, onConnection) {
    const key = req.headers['sec-websocket-key'];
    if (typeof key !== 'string' || key.length === 0) { writeHttpError(socket, 400, 'Bad Request'); return; }
    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, '\r\n'].join('\r\n'));
    onConnection(new MinimalWebSocketConnection(socket, head));
  }
}

function tryDecodeFrame(buffer) {
  if (buffer.length < 2) return undefined;
  const first = buffer[0];
  const second = buffer[1];
  const fin = (first & 0x80) !== 0;
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let offset = 2;
  if (!fin) return { opcode: 0x8, payload: Buffer.from('fragmented frames unsupported'), consumed: buffer.length };
  if (length === 126) { if (buffer.length < offset + 2) return undefined; length = buffer.readUInt16BE(offset); offset += 2; }
  else if (length === 127) { if (buffer.length < offset + 8) return undefined; const bigLength = buffer.readBigUInt64BE(offset); if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) return { opcode: 0x8, payload: Buffer.from('frame too large'), consumed: buffer.length }; length = Number(bigLength); offset += 8; }
  let mask;
  if (masked) { if (buffer.length < offset + 4) return undefined; mask = buffer.subarray(offset, offset + 4); offset += 4; }
  if (buffer.length < offset + length) return undefined;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] = payload[i] ^ mask[i % 4];
  return { opcode, payload, consumed: offset + length };
}
function encodeFrame(payload, opcode) {
  const length = payload.length;
  let header;
  if (length < 126) { header = Buffer.alloc(2); header[1] = length; }
  else if (length <= 0xffff) { header = Buffer.alloc(4); header[1] = 126; header.writeUInt16BE(length, 2); }
  else { header = Buffer.alloc(10); header[1] = 127; header.writeBigUInt64BE(BigInt(length), 2); }
  header[0] = 0x80 | (opcode & 0x0f);
  return Buffer.concat([header, payload]);
}
function writeHttpError(socket, status, reason) { socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`); socket.destroy(); }

class XMeowWebSocketEndpoint {
  constructor(adapter, options) {
    this.server = new MinimalWebSocketServer();
    this.clients = new Set();
    this.adapter = adapter;
    this.options = options;
    this.disposables = [adapter.onEnvelope((event) => this.broadcast(event)), adapter.onStatus((status) => this.broadcast(status))];
  }
  get clientCount() { return this.clients.size; }
  matches(req) { const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`); return url.pathname === this.options.path; }
  handleUpgrade(req, socket, head) {
    if (!this.matches(req)) return false;
    const config = this.options.getConfig();
    if (!isAuthorized(req, config)) { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); return true; }
    this.server.handleUpgrade(req, socket, head, (connection) => this.accept(connection));
    return true;
  }
  close() { for (const client of [...this.clients]) client.close(1001, 'xmeow endpoint closed'); this.clients.clear(); for (const disposable of this.disposables.splice(0)) disposable.dispose(); this.adapter.markClientCount(0); }
  accept(connection) {
    this.clients.add(connection);
    this.adapter.markClientCount(this.clients.size);
    connection.sendJSON(this.adapter.getStatus());
    connection.onMessage(async (text) => { const response = await this.adapter.handleClientMessage(text); if (response) connection.sendJSON(response); });
    connection.onClose(() => { this.clients.delete(connection); this.adapter.markClientCount(this.clients.size); });
  }
  broadcast(value) { for (const client of this.clients) client.sendJSON(value); }
}

async function startStandaloneServer(adapter, options) {
  const config = options.getConfig();
  const endpoint = new XMeowWebSocketEndpoint(adapter, { path: '/ws/xmeow', getConfig: options.getConfig, logger: options.logger });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/api/xmeow/status') {
      if (!isAuthorized(req, options.getConfig())) { sendJSON(res, 401, { error: 'Unauthorized' }); return; }
      sendJSON(res, 200, adapter.getStatus());
      return;
    }
    sendJSON(res, 404, { error: 'Not found' });
  });
  server.on('upgrade', (req, socket, head) => { if (!endpoint.handleUpgrade(req, socket, head)) socket.destroy(); });
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(config.transport.standalone.port, config.transport.standalone.host, () => { server.off('error', onError); options.logger?.info?.(`XMeow standalone endpoint listening on http://${config.transport.standalone.host}:${config.transport.standalone.port}`); resolve(); });
  });
  adapter.setLifecycle({ standaloneServer: 'listening' });
  return { dispose() { endpoint.close(); server.close(); adapter.setLifecycle({ standaloneServer: 'disabled' }); } };
}

function installWebPlatformBridge(options) {
  const platform = options.platform;
  if (!platform || typeof platform !== 'object') { options.adapter.setLifecycle({ webPlatformBridge: 'unavailable' }); return noopDisposable(); }
  const config = options.getConfig();
  if (!config.transport.webPlatform.enabled || !config.transport.webPlatform.allowPrivateUpgradeBridge) { options.adapter.setLifecycle({ webPlatformBridge: 'disabled' }); return noopDisposable(); }
  const endpoint = new XMeowWebSocketEndpoint(options.adapter, { path: '/ws/xmeow', getConfig: options.getConfig, logger: options.logger });
  let state = platform[BRIDGE_SYMBOL];
  if (!state) {
    state = { installed: false, previousListeners: [], endpoints: new Set() };
    platform[BRIDGE_SYMBOL] = state;
    patchPlatformLifecycle(platform, state, options);
  }
  state.endpoints.add(endpoint);
  attachIfServerReady(platform, state, options);
  return { dispose() { endpoint.close(); state.endpoints.delete(endpoint); if (state.endpoints.size === 0) { restoreServerListeners(state); options.adapter.setLifecycle({ webPlatformBridge: 'disabled' }); } } };
}

function patchPlatformLifecycle(platform, state, options) {
  if (typeof platform.start === 'function') {
    state.originalStart = platform.start.bind(platform);
    platform.start = async (...args) => { const result = await state.originalStart(...args); attachIfServerReady(platform, state, options); return result; };
  }
  if (typeof platform.stop === 'function') {
    state.originalStop = platform.stop.bind(platform);
    platform.stop = async (...args) => { restoreServerListeners(state); for (const endpoint of state.endpoints) endpoint.close(); return await state.originalStop(...args); };
  }
}
function attachIfServerReady(platform, state, options) {
  const server = platform.server;
  if (!server || typeof server.listeners !== 'function' || typeof server.removeAllListeners !== 'function') { if (!state.installed) options.adapter.setLifecycle({ webPlatformBridge: 'unavailable' }); return; }
  if (state.installed && state.server === server) return;
  restoreServerListeners(state);
  state.server = server;
  state.previousListeners = server.listeners('upgrade');
  const dispatcher = (req, socket, head) => {
    for (const endpoint of state.endpoints) if (endpoint.handleUpgrade(req, socket, head)) return;
    for (const listener of state.previousListeners) listener.call(server, req, socket, head);
  };
  server.removeAllListeners('upgrade');
  server.on('upgrade', dispatcher);
  state.dispatcher = dispatcher;
  state.installed = true;
  options.adapter.setLifecycle({ webPlatformBridge: 'attached' });
  options.logger?.info?.('XMeow WebPlatform /ws/xmeow bridge attached');
}
function restoreServerListeners(state) {
  const server = state.server;
  if (!server || !state.installed) return;
  server.removeAllListeners('upgrade');
  for (const listener of state.previousListeners) server.on('upgrade', listener);
  state.previousListeners = [];
  state.dispatcher = undefined;
  state.installed = false;
  state.server = undefined;
}
function noopDisposable() { return { dispose() {} }; }

const runtimeByConfigDir = new Map();

function readConfig(ctx) { return parseXMeowConfig(ctx.readConfigSection('xmeow')); }

function maybeInstallWebBridge(platforms, runtime, adapter, getConfig) {
  const config = getConfig();
  if (runtime.webBridgeRequested) return;
  if (config.transport.mode === 'off' || config.transport.mode === 'standalone') { adapter.setLifecycle({ webPlatformBridge: 'not-requested' }); return; }
  if (!config.transport.webPlatform.enabled) { adapter.setLifecycle({ webPlatformBridge: 'disabled' }); return; }
  const webPlatform = platforms.get('web');
  if (!webPlatform) { adapter.setLifecycle({ webPlatformBridge: 'unavailable' }); return; }
  runtime.webBridgeRequested = true;
  const disposable = installWebPlatformBridge({ platform: webPlatform, adapter, getConfig, logger });
  runtime.disposables.push(disposable);
}

async function maybeStartStandalone(ctx, runtime, adapter) {
  const config = readConfig(ctx);
  if (runtime.standaloneStarted) return;
  const shouldStart = config.transport.mode === 'standalone' || (config.transport.mode === 'auto' && config.transport.standalone.enabled);
  if (!shouldStart || config.transport.mode === 'off') { adapter.setLifecycle({ standaloneServer: config.transport.standalone.enabled ? 'not-requested' : 'disabled' }); return; }
  try {
    const disposable = await startStandaloneServer(adapter, { getConfig: () => readConfig(ctx), logger });
    runtime.disposables.push(disposable);
    runtime.standaloneStarted = true;
  } catch (error) {
    adapter.setLifecycle({ standaloneServer: 'error' });
    logger.error('XMeow standalone endpoint 启动失败:', error);
  }
}

export default definePlugin({
  name: 'xmeow-bar',
  version: '0.2.0',
  description: 'Iris-side adapter for the macOS XMeow Bar companion',
  activate(ctx) {
    const createdConfig = ctx.ensureConfigFile('xmeow.yaml', defaultConfigTemplate);
    if (createdConfig) logger.info('已安装 xmeow.yaml 默认配置模板');
    const initialConfig = readConfig(ctx);
    const runtimeKey = ctx.getConfigDir();
    const runtime = { config: initialConfig, disposables: [], standaloneStarted: false, webBridgeRequested: false };
    runtimeByConfigDir.set(runtimeKey, runtime);
    if (!initialConfig.enabled) { logger.info('xmeow.enabled=false，跳过激活'); return; }
    const adapter = new XMeowAdapterService(initialConfig);
    runtime.adapter = adapter;
    ctx.onReady(async (api) => {
      const latest = readConfig(ctx);
      runtime.config = latest;
      adapter.updateConfig(latest);
      adapter.setApi(api);
      const statusRoute = registerStatusRoute(api, adapter, () => readConfig(ctx));
      if (statusRoute) { runtime.disposables.push(statusRoute); logger.info('XMeow status route registered: GET /api/xmeow/status'); }
      else logger.warn('IrisAPI.registerWebRoute 不可用，无法挂载 /api/xmeow/status 到 WebPlatform');
      runtime.disposables.push(wireBackendEvents(api, adapter, () => readConfig(ctx)));
      runtime.disposables.push(api.services.register(SERVICE_ID, adapter, { description: 'Stable XMeow Bar projection adapter service', version: '1.0.0' }));
      await maybeStartStandalone(ctx, runtime, adapter);
      logger.info('XMeow Bar Iris adapter 已启用');
    });
    ctx.onPlatformsReady((platforms) => {
      const latest = readConfig(ctx);
      runtime.config = latest;
      adapter.updateConfig(latest);
      maybeInstallWebBridge(platforms, runtime, adapter, () => readConfig(ctx));
    });
    ctx.addHook({
      name: 'xmeow:config-reload',
      onConfigReload() {
        const latest = readConfig(ctx);
        runtime.config = latest;
        adapter.updateConfig(latest);
        logger.info('xmeow.yaml 已重新读取；部分 transport 变更需要重启 Iris 后完全生效');
      },
    });
  },
  deactivate(ctx) {
    if (!ctx) return;
    const runtimeKey = ctx.getConfigDir();
    const runtime = runtimeByConfigDir.get(runtimeKey);
    if (!runtime) return;
    for (const disposable of runtime.disposables.splice(0).reverse()) { try { disposable.dispose(); } catch {} }
    runtime.adapter?.deactivate();
    runtimeByConfigDir.delete(runtimeKey);
    logger.info('XMeow Bar Iris adapter 已停用');
  },
});
