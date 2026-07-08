import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { XMeowConfig } from '../../config.js';
import type { XMeowAdapterService } from '../../application/xmeow-adapter.js';
import { MinimalWebSocketConnection, MinimalWebSocketServer } from './minimal-websocket.js';
import { isAuthorized } from './auth.js';

export interface XMeowWebSocketEndpointOptions {
  path: string;
  getConfig: () => XMeowConfig;
  logger?: { info(...args: unknown[]): void; warn(...args: unknown[]): void; error(...args: unknown[]): void };
}

export class XMeowWebSocketEndpoint {
  private server = new MinimalWebSocketServer();
  private clients = new Set<MinimalWebSocketConnection>();
  private adapter: XMeowAdapterService;
  private options: XMeowWebSocketEndpointOptions;
  private disposables: Array<{ dispose(): void }> = [];

  constructor(adapter: XMeowAdapterService, options: XMeowWebSocketEndpointOptions) {
    this.adapter = adapter;
    this.options = options;
    this.disposables.push(adapter.onEnvelope((event) => this.broadcast(event)));
    this.disposables.push(adapter.onStatus((status) => this.broadcast(status)));
  }

  get clientCount(): number {
    return this.clients.size;
  }

  matches(req: IncomingMessage): boolean {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    return url.pathname === this.options.path;
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    if (!this.matches(req)) return false;
    const config = this.options.getConfig();
    if (!isAuthorized(req, config)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return true;
    }

    this.server.handleUpgrade(req, socket, head, (connection) => this.accept(connection));
    return true;
  }

  close(): void {
    for (const client of [...this.clients]) client.close(1001, 'xmeow endpoint closed');
    this.clients.clear();
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
    this.adapter.markClientCount(0);
  }

  private accept(connection: MinimalWebSocketConnection): void {
    this.clients.add(connection);
    this.adapter.markClientCount(this.clients.size);

    connection.onMessage(async (text) => {
      const response = await this.adapter.handleClientMessage(text);
      if (response) connection.sendJSON(response);
    });

    connection.onClose(() => {
      this.clients.delete(connection);
      this.adapter.markClientCount(this.clients.size);
    });
  }

  private broadcast(value: unknown): void {
    for (const client of this.clients) client.sendJSON(value);
  }
}
