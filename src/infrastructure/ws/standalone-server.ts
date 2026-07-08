import * as http from 'node:http';
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

export async function startStandaloneServer(
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
