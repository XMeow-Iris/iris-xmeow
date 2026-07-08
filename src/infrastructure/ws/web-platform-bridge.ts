import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Disposable } from 'irises-extension-sdk';
import type { XMeowConfig } from '../../config.js';
import type { XMeowAdapterService } from '../../application/xmeow-adapter.js';
import { XMeowWebSocketEndpoint } from './xmeow-ws-endpoint.js';

const BRIDGE_SYMBOL = Symbol.for('xmeow-bar.web-platform-upgrade-bridge');

type UpgradeListener = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

interface BridgeState {
  originalStart?: (...args: unknown[]) => Promise<unknown>;
  originalStop?: (...args: unknown[]) => Promise<unknown>;
  installed: boolean;
  server?: Server;
  previousListeners: UpgradeListener[];
  dispatcher?: UpgradeListener;
  endpoints: Set<XMeowWebSocketEndpoint>;
}

export interface InstallWebPlatformBridgeOptions {
  platform: unknown;
  adapter: XMeowAdapterService;
  getConfig: () => XMeowConfig;
  logger?: { info(...args: unknown[]): void; warn(...args: unknown[]): void; error(...args: unknown[]): void };
}

export function installWebPlatformBridge(options: InstallWebPlatformBridgeOptions): Disposable {
  const platform = options.platform as Record<PropertyKey, any> | undefined;
  if (!platform || typeof platform !== 'object') {
    options.adapter.setLifecycle({ webPlatformBridge: 'unavailable' });
    return noopDisposable();
  }

  const config = options.getConfig();
  if (!config.transport.webPlatform.enabled || !config.transport.webPlatform.allowPrivateUpgradeBridge) {
    options.adapter.setLifecycle({ webPlatformBridge: 'disabled' });
    return noopDisposable();
  }

  const endpoint = new XMeowWebSocketEndpoint(options.adapter, {
    path: '/ws/xmeow',
    getConfig: options.getConfig,
    logger: options.logger,
  });

  let state = platform[BRIDGE_SYMBOL] as BridgeState | undefined;
  if (!state) {
    state = {
      installed: false,
      previousListeners: [],
      endpoints: new Set<XMeowWebSocketEndpoint>(),
    };
    platform[BRIDGE_SYMBOL] = state;
    patchPlatformLifecycle(platform, state, options);
  }

  state.endpoints.add(endpoint);
  attachIfServerReady(platform, state, options);

  return {
    dispose() {
      endpoint.close();
      state!.endpoints.delete(endpoint);
      if (state!.endpoints.size === 0) {
        restoreServerListeners(state!);
        options.adapter.setLifecycle({ webPlatformBridge: 'disabled' });
      }
    },
  };
}

function patchPlatformLifecycle(
  platform: Record<PropertyKey, any>,
  state: BridgeState,
  options: InstallWebPlatformBridgeOptions,
): void {
  if (typeof platform.start === 'function') {
    state.originalStart = platform.start.bind(platform);
    platform.start = async (...args: unknown[]) => {
      const result = await state.originalStart!(...args);
      attachIfServerReady(platform, state, options);
      return result;
    };
  }

  if (typeof platform.stop === 'function') {
    state.originalStop = platform.stop.bind(platform);
    platform.stop = async (...args: unknown[]) => {
      restoreServerListeners(state);
      for (const endpoint of state.endpoints) endpoint.close();
      return await state.originalStop!(...args);
    };
  }
}

function attachIfServerReady(
  platform: Record<PropertyKey, any>,
  state: BridgeState,
  options: InstallWebPlatformBridgeOptions,
): void {
  const server = platform.server as Server | undefined;
  if (!server || typeof server.listeners !== 'function' || typeof server.removeAllListeners !== 'function') {
    if (!state.installed) options.adapter.setLifecycle({ webPlatformBridge: 'unavailable' });
    return;
  }
  if (state.installed && state.server === server) return;

  restoreServerListeners(state);
  state.server = server;
  state.previousListeners = server.listeners('upgrade') as UpgradeListener[];

  const dispatcher: UpgradeListener = (req, socket, head) => {
    for (const endpoint of state.endpoints) {
      if (endpoint.handleUpgrade(req, socket, head)) return;
    }
    for (const listener of state.previousListeners) {
      listener.call(server, req, socket, head);
    }
  };

  server.removeAllListeners('upgrade');
  server.on('upgrade', dispatcher);
  state.dispatcher = dispatcher;
  state.installed = true;
  options.adapter.setLifecycle({ webPlatformBridge: 'attached' });
  options.logger?.info?.('XMeow WebPlatform /ws/xmeow bridge attached');
}

function restoreServerListeners(state: BridgeState): void {
  const server = state.server;
  if (!server || !state.installed) return;
  server.removeAllListeners('upgrade');
  for (const listener of state.previousListeners) server.on('upgrade', listener);
  state.previousListeners = [];
  state.dispatcher = undefined;
  state.installed = false;
  state.server = undefined;
}

function noopDisposable(): Disposable {
  return { dispose() { /* noop */ } };
}
