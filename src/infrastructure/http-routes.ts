import type { Disposable, IrisAPI } from 'irises-extension-sdk';
import type { XMeowAdapterService } from '../application/xmeow-adapter.js';
import type { XMeowConfig } from '../config.js';
import { isAuthorized } from './ws/auth.js';

export function registerStatusRoute(
  api: IrisAPI,
  adapter: XMeowAdapterService,
  getConfig: () => XMeowConfig,
): Disposable | undefined {
  if (!api.registerWebRoute) return undefined;
  return api.registerWebRoute('GET', '/api/xmeow/status', async (req: any, res: any) => {
    if (!isAuthorized(req, getConfig())) {
      sendJSON(res, 401, { error: 'Unauthorized' });
      return;
    }
    sendJSON(res, 200, adapter.getStatus());
  });
}

export function sendJSON(res: any, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}
