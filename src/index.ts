import {
  createPluginLogger,
  definePlugin,
  type Disposable,
  type IrisAPI,
  type PluginContext,
} from 'irises-extension-sdk';
import { defaultConfigTemplate, parseXMeowConfig, type XMeowConfig } from './config.js';
import { XMeowAdapterService } from './application/xmeow-adapter.js';
import { wireBackendEvents } from './infrastructure/backend-events.js';
import { registerStatusRoute } from './infrastructure/http-routes.js';
import { installWebPlatformBridge } from './infrastructure/ws/web-platform-bridge.js';
import { startStandaloneServer } from './infrastructure/ws/standalone-server.js';

const logger = createPluginLogger('xmeow-bar');
const SERVICE_ID = 'xmeow.adapter';

interface RuntimeState {
  adapter?: XMeowAdapterService;
  config: XMeowConfig;
  disposables: Disposable[];
  standaloneStarted: boolean;
  webBridgeRequested: boolean;
}

const runtimeByConfigDir = new Map<string, RuntimeState>();

export default definePlugin({
  name: 'xmeow-bar',
  version: '0.2.0',
  description: 'Iris-side adapter for the macOS XMeow Bar companion',

  activate(ctx: PluginContext) {
    const createdConfig = ctx.ensureConfigFile('xmeow.yaml', defaultConfigTemplate);
    if (createdConfig) logger.info('已安装 xmeow.yaml 默认配置模板');

    const initialConfig = readConfig(ctx);
    const runtimeKey = ctx.getConfigDir();
    const runtime: RuntimeState = {
      config: initialConfig,
      disposables: [],
      standaloneStarted: false,
      webBridgeRequested: false,
    };
    runtimeByConfigDir.set(runtimeKey, runtime);

    if (!initialConfig.enabled) {
      logger.info('xmeow.enabled=false，跳过激活');
      return;
    }

    const adapter = new XMeowAdapterService(initialConfig);
    runtime.adapter = adapter;

    ctx.onReady(async (api: IrisAPI) => {
      const latest = readConfig(ctx);
      runtime.config = latest;
      adapter.updateConfig(latest);
      adapter.setApi(api);

      const statusRoute = registerStatusRoute(api, adapter, () => readConfig(ctx));
      if (statusRoute) {
        runtime.disposables.push(statusRoute);
        logger.info('XMeow status route registered: GET /api/xmeow/status');
      } else {
        logger.warn('IrisAPI.registerWebRoute 不可用，无法挂载 /api/xmeow/status 到 WebPlatform');
      }

      const backendEvents = wireBackendEvents(api, adapter, () => readConfig(ctx));
      runtime.disposables.push(backendEvents);

      const serviceDisposable = api.services.register(SERVICE_ID, adapter, {
        description: 'Stable XMeow Bar projection adapter service',
        version: '1.0.0',
      });
      runtime.disposables.push(serviceDisposable);

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

  deactivate(ctx?: PluginContext) {
    if (!ctx) return;
    const runtimeKey = ctx.getConfigDir();
    const runtime = runtimeByConfigDir.get(runtimeKey);
    if (!runtime) return;

    for (const disposable of runtime.disposables.splice(0).reverse()) {
      try { disposable.dispose(); } catch { /* ignore */ }
    }
    runtime.adapter?.deactivate();
    runtimeByConfigDir.delete(runtimeKey);
    logger.info('XMeow Bar Iris adapter 已停用');
  },
});

function readConfig(ctx: PluginContext): XMeowConfig {
  return parseXMeowConfig(ctx.readConfigSection('xmeow'));
}

function maybeInstallWebBridge(
  platforms: ReadonlyMap<string, unknown>,
  runtime: RuntimeState,
  adapter: XMeowAdapterService,
  getConfig: () => XMeowConfig,
): void {
  const config = getConfig();
  if (runtime.webBridgeRequested) return;
  if (config.transport.mode === 'off' || config.transport.mode === 'standalone') {
    adapter.setLifecycle({ webPlatformBridge: 'not-requested' });
    return;
  }
  if (!config.transport.webPlatform.enabled) {
    adapter.setLifecycle({ webPlatformBridge: 'disabled' });
    return;
  }

  const webPlatform = platforms.get('web');
  if (!webPlatform) {
    adapter.setLifecycle({ webPlatformBridge: 'unavailable' });
    return;
  }

  runtime.webBridgeRequested = true;
  const disposable = installWebPlatformBridge({ platform: webPlatform, adapter, getConfig, logger });
  runtime.disposables.push(disposable);
}

async function maybeStartStandalone(ctx: PluginContext, runtime: RuntimeState, adapter: XMeowAdapterService): Promise<void> {
  const config = readConfig(ctx);
  if (runtime.standaloneStarted) return;
  const shouldStart = config.transport.mode === 'standalone'
    || (config.transport.mode === 'auto' && config.transport.standalone.enabled);
  if (!shouldStart || config.transport.mode === 'off') {
    adapter.setLifecycle({ standaloneServer: config.transport.standalone.enabled ? 'not-requested' : 'disabled' });
    return;
  }

  try {
    const disposable = await startStandaloneServer(adapter, { getConfig: () => readConfig(ctx), logger });
    runtime.disposables.push(disposable);
    runtime.standaloneStarted = true;
  } catch (error) {
    adapter.setLifecycle({ standaloneServer: 'error' });
    logger.error('XMeow standalone endpoint 启动失败:', error);
  }
}
