import * as http from 'node:http';
import { EventEmitter } from 'node:events';
import plugin from '../dist/index.mjs';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(condition, message) { if (!condition) throw new Error(message); }

function makeContext(config, key = `test-${Math.random().toString(36).slice(2)}`) {
  const ready = [];
  const platformsReady = [];
  const hooks = [];
  return {
    key,
    ready,
    platformsReady,
    hooks,
    ctx: {
      ensureConfigFile: () => false,
      readConfigSection: (section) => section === 'xmeow' ? config : undefined,
      getConfigDir: () => key,
      onReady: (cb) => ready.push(cb),
      onPlatformsReady: (cb) => platformsReady.push(cb),
      addHook: (hook) => hooks.push(hook),
    },
  };
}

function makeApi() {
  const backend = new EventEmitter();
  backend.chatCalls = [];
  backend.chat = async (...args) => { backend.chatCalls.push(args); };

  const routes = [];
  return {
    backend,
    routes,
    services: {
      register: (id, value, metadata) => ({ dispose() { void id; void value; void metadata; } }),
    },
    registerWebRoute: (method, path, handler) => {
      const route = { method, path, handler };
      routes.push(route);
      return { dispose() { const index = routes.indexOf(route); if (index >= 0) routes.splice(index, 1); } };
    },
  };
}

function makeReq({ token, remoteAddress = '100.64.0.10' } = {}) {
  return {
    headers: {
      host: '127.0.0.1:8192',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    socket: { remoteAddress },
    url: '/api/xmeow/status',
  };
}


async function getFreePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 8193;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}


async function listen(server, port) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function nextWebSocketJSON(ws) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for websocket message')), 1500);
    ws.addEventListener('message', (event) => {
      clearTimeout(timer);
      try { resolve(JSON.parse(event.data)); }
      catch (error) { reject(error); }
    }, { once: true });
    ws.addEventListener('error', (event) => {
      clearTimeout(timer);
      reject(new Error(`websocket error: ${event.message ?? 'unknown'}`));
    }, { once: true });
  });
}

function collectWebSocketJSON(ws, ms) {
  const out = [];
  ws.addEventListener('message', (event) => {
    try { out.push(JSON.parse(event.data)); } catch { /* ignore */ }
  });
  return new Promise((resolve) => setTimeout(() => resolve(out), ms));
}

function makeRes() {
  return {
    status: undefined,
    headers: undefined,
    body: undefined,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; },
    json() { return JSON.parse(this.body ?? '{}'); },
  };
}

async function activate(config) {
  const api = makeApi();
  const harness = makeContext(config);
  plugin.activate(harness.ctx);
  for (const cb of harness.ready) await cb(api);
  for (const cb of harness.platformsReady) cb(new Map());
  return { api, harness };
}

test('registers status route and exposes lifecycle status', async () => {
  const { api, harness } = await activate({ transport: { mode: 'off' } });
  const route = api.routes.find((item) => item.method === 'GET' && item.path === '/api/xmeow/status');
  assert(route, 'GET /api/xmeow/status was not registered');

  const res = makeRes();
  await route.handler(makeReq({ remoteAddress: '127.0.0.1' }), res, {});
  const json = res.json();
  assert(res.status === 200, `expected HTTP 200, got ${res.status}`);
  assert(json.type === 'event', 'status response should use event envelope');
  assert(json.event_type === 'status_update', 'status response should be a status_update event');
  assert(json.metadata?.plugin === 'xmeow-bar', 'metadata should identify the plugin');
  assert(json.metadata?.transport_mode === 'off', 'lifecycle metadata should expose transport mode');
  plugin.deactivate(harness.ctx);
});

test('protects status route with bearer token when configured', async () => {
  const { api, harness } = await activate({
    auth: { bearerToken: 'secret-token', requireToken: true, allowMissingTokenOnLoopback: false },
    transport: { mode: 'off' },
  });
  const route = api.routes.find((item) => item.method === 'GET' && item.path === '/api/xmeow/status');
  assert(route, 'status route missing');

  const rejected = makeRes();
  await route.handler(makeReq(), rejected, {});
  assert(rejected.status === 401, `expected HTTP 401, got ${rejected.status}`);

  const accepted = makeRes();
  await route.handler(makeReq({ token: 'secret-token' }), accepted, {});
  assert(accepted.status === 200, `expected HTTP 200 with token, got ${accepted.status}`);
  plugin.deactivate(harness.ctx);
});



test('serves /ws/xmeow through WebPlatform bridge lifecycle', async () => {
  const port = await getFreePort();
  const server = http.createServer((_req, res) => { res.writeHead(404); res.end(); });
  server.on('upgrade', (_req, socket) => {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
  });
  await listen(server, port);

  const api = makeApi();
  const harness = makeContext({
    transport: { mode: 'auto', webPlatform: { enabled: true, allowPrivateUpgradeBridge: true } },
  });
  plugin.activate(harness.ctx);
  for (const cb of harness.ready) await cb(api);
  for (const cb of harness.platformsReady) cb(new Map([['web', { server, start: async () => {}, stop: async () => {} }]]));

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/xmeow`);
  const status = await nextWebSocketJSON(ws);
  assert(status.event_type === 'status_update', `expected initial status_update, got ${JSON.stringify(status)}`);
  assert(status.metadata?.web_platform_bridge === 'attached', 'WebPlatform bridge lifecycle should be observable');
  ws.close();
  plugin.deactivate(harness.ctx);
  await closeServer(server);
});

test('serves /ws/xmeow through standalone lifecycle', async () => {
  const port = await getFreePort();
  const { harness } = await activate({
    transport: { mode: 'standalone', standalone: { enabled: true, host: '127.0.0.1', port } },
  });

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/xmeow`);
  const status = await nextWebSocketJSON(ws);
  assert(status.event_type === 'status_update', `expected initial status_update, got ${JSON.stringify(status)}`);
  assert(status.metadata?.standalone_server === 'listening', 'standalone lifecycle should be observable');

  ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
  const pong = await nextWebSocketJSON(ws);
  assert(pong.type === 'pong', `expected pong, got ${JSON.stringify(pong)}`);
  ws.close();
  plugin.deactivate(harness.ctx);
});

test('publishes only configured XMeow chat responses into status', async () => {
  const { api, harness } = await activate({ transport: { mode: 'off' }, session: { id: 'xmeow-bar' } });
  const route = api.routes.find((item) => item.method === 'GET' && item.path === '/api/xmeow/status');
  assert(route, 'status route missing');

  api.backend.emit('response', 'other-session', 'wrong channel');
  api.backend.emit('response', 'xmeow-bar', '咪已经收到啦。');

  const res = makeRes();
  await route.handler(makeReq({ remoteAddress: '127.0.0.1' }), res, {});
  const json = res.json();
  assert(json.message === '咪已经收到啦。', `unexpected latest message: ${json.message}`);
  plugin.deactivate(harness.ctx);
});

test('surfaces streaming replies via assistant:content flushed on done', async () => {
  const port = await getFreePort();
  const { api, harness } = await activate({
    session: { id: 'xmeow-bar' },
    transport: { mode: 'standalone', standalone: { enabled: true, host: '127.0.0.1', port } },
  });

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/xmeow`);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('websocket error')), { once: true });
  });

  const collected = collectWebSocketJSON(ws, 400);
  // Streaming turn: Iris does NOT emit `response`; it emits one `assistant:content`
  // per model message (reasoning/thought parts must be ignored) and closes with `done`.
  api.backend.emit('assistant:content', 'other-session', { role: 'model', parts: [{ text: 'wrong channel' }] });
  api.backend.emit('assistant:content', 'xmeow-bar', { role: 'model', parts: [{ text: '中间稿' }] });
  api.backend.emit('assistant:content', 'xmeow-bar', { role: 'model', parts: [{ text: '想一下', thought: true }, { text: '尾巴缠上来了。' }] });
  api.backend.emit('done', 'xmeow-bar', 1234, 'turn-1');
  const frames = await collected;

  const chatResponses = frames.filter((f) => f.type === 'chat_response');
  assert(chatResponses.length === 1, `expected exactly one chat_response, got ${chatResponses.length}: ${JSON.stringify(chatResponses)}`);
  assert(chatResponses[0].text === '尾巴缠上来了。', `unexpected streamed reply: ${chatResponses[0].text}`);

  ws.close();
  plugin.deactivate(harness.ctx);
});

test('flushes nothing on done when the turn produced no visible text', async () => {
  const port = await getFreePort();
  const { api, harness } = await activate({
    session: { id: 'xmeow-bar' },
    transport: { mode: 'standalone', standalone: { enabled: true, host: '127.0.0.1', port } },
  });
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/xmeow`);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('websocket error')), { once: true });
  });
  const collected = collectWebSocketJSON(ws, 300);
  // Tool-only model message (no text) then done -> no chat_response.
  api.backend.emit('assistant:content', 'xmeow-bar', { role: 'model', parts: [{ functionCall: { name: 'noop' } }] });
  api.backend.emit('done', 'xmeow-bar', 10, 'turn-2');
  const frames = await collected;
  const chatResponses = frames.filter((f) => f.type === 'chat_response');
  assert(chatResponses.length === 0, `expected no chat_response, got ${chatResponses.length}`);
  ws.close();
  plugin.deactivate(harness.ctx);
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    process.exitCode = 1;
    break;
  }
}
if (process.exitCode !== 1) console.log(`${passed}/${tests.length} xmeow-bar extension harness checks passed`);
