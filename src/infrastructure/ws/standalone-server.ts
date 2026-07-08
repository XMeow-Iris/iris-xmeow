import * as http from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { Disposable } from 'irises-extension-sdk';
import type { XMeowConfig } from '../../config.js';
import type { XMeowAdapterService } from '../../application/xmeow-adapter.js';
import { sendJSON } from '../http-routes.js';
import { isAuthorized } from './auth.js';
import { XMeowWebSocketEndpoint } from './xmeow-ws-endpoint.js';

export interface StandaloneServerOptions {
  getConfig: () => XMeowConfig;
  logger?: { info(...args: unknown[]): void; warn(...args: unknown[]): void; error(...args: unknown[]): void };
}

/**
 * The Iris runtime is Bun, whose `node:http` compatibility layer does NOT flush
 * raw `socket.write()` bytes for a connection handed to the server `'upgrade'`
 * event. The write is accepted (returns true, callback fires with no error) yet
 * nothing reaches the client, so a manual WebSocket handshake hangs forever and
 * the client times out — exactly the `/ws/xmeow` symptom.
 *
 * Under Bun we must therefore use the native `Bun.serve()` WebSocket support
 * (`server.upgrade()` + a `websocket` handler set). Under Node.js we keep the
 * portable `node:http` implementation, which works there and is exercised by the
 * offline harness. Runtime is detected at call time so a single dist works in
 * both environments.
 */
function getBunRuntime(): BunLike | undefined {
  const bun = (globalThis as unknown as { Bun?: BunLike }).Bun;
  return bun && typeof bun.serve === 'function' ? bun : undefined;
}

interface BunLike {
  serve(options: unknown): BunServer;
}

interface BunServer {
  stop(closeActiveConnections?: boolean): void;
  upgrade(req: unknown, options?: { data?: unknown }): boolean;
  requestIP?(req: unknown): { address: string } | null;
  port: number;
  hostname: string;
}

interface BunSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export async function startStandaloneServer(
  adapter: XMeowAdapterService,
  options: StandaloneServerOptions,
): Promise<Disposable> {
  const bun = getBunRuntime();
  if (bun) return startStandaloneServerBun(adapter, options, bun);
  return startStandaloneServerNode(adapter, options);
}

async function startStandaloneServerNode(
  adapter: XMeowAdapterService,
  options: StandaloneServerOptions,
): Promise<Disposable> {
  const config = options.getConfig();
  const endpoint = new XMeowWebSocketEndpoint(adapter, {
    path: '/ws/xmeow',
    getConfig: options.getConfig,
    logger: options.logger,
  });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/api/xmeow/status') {
      if (!isAuthorized(req, options.getConfig())) {
        sendJSON(res, 401, { error: 'Unauthorized' });
        return;
      }
      sendJSON(res, 200, adapter.getStatus());
      return;
    }
    sendJSON(res, 404, { error: 'Not found' });
  });

  server.on('upgrade', (req, socket, head) => {
    if (!endpoint.handleUpgrade(req, socket, head)) socket.destroy();
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(config.transport.standalone.port, config.transport.standalone.host, () => {
      server.off('error', onError);
      options.logger?.info?.(`XMeow standalone endpoint listening on http://${config.transport.standalone.host}:${config.transport.standalone.port}`);
      resolve();
    });
  });

  adapter.setLifecycle({ standaloneServer: 'listening' });

  return {
    dispose() {
      endpoint.close();
      server.close();
      adapter.setLifecycle({ standaloneServer: 'disabled' });
    },
  };
}

async function startStandaloneServerBun(
  adapter: XMeowAdapterService,
  options: StandaloneServerOptions,
  bun: BunLike,
): Promise<Disposable> {
  const config = options.getConfig();
  const path = '/ws/xmeow';
  const clients = new Set<BunSocket>();

  const broadcast = (value: unknown): void => {
    const text = JSON.stringify(value);
    for (const ws of clients) {
      try { ws.send(text); } catch { /* client gone */ }
    }
  };

  const disposables = [
    adapter.onEnvelope((event) => broadcast(event)),
    adapter.onStatus((status) => broadcast(status)),
  ];

  // Reuse the exact same auth policy as HTTP by adapting the web `Request`
  // (plus the peer IP from Bun) into the minimal `IncomingMessage` shape that
  // `isAuthorized` reads (`headers.authorization`, `headers.host`, `url`,
  // `socket.remoteAddress`).
  const authorize = (req: Request, server: BunServer): boolean => {
    const url = new URL(req.url);
    const remoteAddress = server.requestIP?.(req)?.address ?? '';
    const nodeLike = {
      headers: {
        authorization: req.headers.get('authorization') ?? undefined,
        host: req.headers.get('host') ?? url.host,
      },
      url: `${url.pathname}${url.search}`,
      socket: { remoteAddress },
    } as unknown as IncomingMessage;
    return isAuthorized(nodeLike, options.getConfig());
  };

  const jsonResponse = (status: number, data: unknown): Response =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });

  let server: BunServer;
  try {
    server = bun.serve({
      port: config.transport.standalone.port,
      hostname: config.transport.standalone.host,
      fetch(req: Request, srv: BunServer): Response | undefined {
        const url = new URL(req.url);
        if (url.pathname === path) {
          if (!authorize(req, srv)) return jsonResponse(401, { error: 'Unauthorized' });
          // Native Bun handshake: on success Bun sends 101 and invokes the
          // `websocket` handlers below; `fetch` must then return undefined.
          if (srv.upgrade(req, { data: {} })) return undefined;
          return jsonResponse(426, { error: 'Upgrade Required' });
        }
        if (req.method === 'GET' && url.pathname === '/api/xmeow/status') {
          if (!authorize(req, srv)) return jsonResponse(401, { error: 'Unauthorized' });
          return jsonResponse(200, adapter.getStatus());
        }
        return jsonResponse(404, { error: 'Not found' });
      },
      websocket: {
        open(ws: BunSocket): void {
          clients.add(ws);
          adapter.markClientCount(clients.size);
          try { ws.send(JSON.stringify(adapter.getStatus())); } catch { /* client gone */ }
        },
        async message(ws: BunSocket, message: string | ArrayBuffer | Uint8Array): Promise<void> {
          const text = typeof message === 'string'
            ? message
            : Buffer.from(message as ArrayBuffer).toString('utf8');
          const response = await adapter.handleClientMessage(text);
          if (response) {
            try { ws.send(JSON.stringify(response)); } catch { /* client gone */ }
          }
        },
        close(ws: BunSocket): void {
          clients.delete(ws);
          adapter.markClientCount(clients.size);
        },
      },
    });
  } catch (error) {
    for (const disposable of disposables.splice(0)) disposable.dispose();
    throw error;
  }

  options.logger?.info?.(`XMeow standalone endpoint (Bun) listening on http://${config.transport.standalone.host}:${config.transport.standalone.port}`);
  adapter.setLifecycle({ standaloneServer: 'listening' });

  return {
    dispose() {
      for (const ws of [...clients]) {
        try { ws.close(1001, 'xmeow endpoint closed'); } catch { /* ignore */ }
      }
      clients.clear();
      for (const disposable of disposables.splice(0)) disposable.dispose();
      adapter.markClientCount(0);
      try { server.stop(true); } catch { /* ignore */ }
      adapter.setLifecycle({ standaloneServer: 'disabled' });
    },
  };
}
