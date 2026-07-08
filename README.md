# XMeow Bar Iris Adapter Extension

This extension is the Iris-side adapter for the macOS XMeow Bar companion.
It exposes a small, stable projection contract:

```text
GET /api/xmeow/status
WS  /ws/xmeow
```

XMeow Bar must not become a second Agent. Iris owns memory, cron, delivery, and conversation history. This extension only translates Iris backend events and XMeow user input into a minimal companion protocol.

## Why this extension exists

Iris exposes public plugin HTTP route registration today, so `/api/xmeow/status` is cleanly registered through `IrisAPI.registerWebRoute`. The current public SDK does not expose WebSocket upgrade route registration. To keep this maintainable for a non-Iris-maintainer, the extension isolates WebSocket support behind infrastructure adapters:

1. `WebPlatformUpgradeBridge` for the existing Iris WebPlatform. This uses a guarded runtime bridge and can be deleted once Iris exposes a public WS route API.
2. `StandaloneXMeowServer` for a fully plugin-owned port, useful when you do not want to depend on WebPlatform internals.

All product semantics live in the adapter service, not in the bridge.

## Lifecycle

```text
activate
  ├─ ensure xmeow.yaml template
  ├─ create XMeowAdapterService
  ├─ onReady
  │    ├─ register GET /api/xmeow/status
  │    ├─ subscribe to Iris backend events
  │    ├─ register xmeow.adapter service
  │    └─ optionally start standalone HTTP/WS server
  ├─ onPlatformsReady
  │    └─ optionally install WebPlatform /ws/xmeow bridge
  └─ onConfigReload
       └─ update adapter configuration

deactivate
  ├─ dispose routes, event listeners, bridge, standalone server
  └─ publish inactive lifecycle state and remove listeners
```

Lifecycle metadata is surfaced in the status envelope so the Swift app and human operator can tell whether the bridge is attached, standalone is listening, and how many WebSocket clients are connected.

## Configuration

The extension installs `xmeow.yaml` on first run. Enable it in `plugins.yaml`:

```yaml
plugins:
  - name: xmeow-bar
    enabled: true
```

When running from the Iris source tree, ensure workspace extensions are enabled or install the extension into `~/.iris/extensions/xmeow-bar`.

For private Tailscale-only use, the default tokenless mode can be acceptable. If the host is reachable beyond your private network, set:

```yaml
xmeow:
  auth:
    bearerToken: "replace-with-a-long-random-token"
    requireToken: true
```

Both HTTP and WebSocket use the same auth policy.

## Swift client defaults

The macOS app can point to:

```json
{
  "iris": {
    "websocketURL": "wss://100.126.x.x:8192/ws/xmeow",
    "statusURL": "https://100.126.x.x:8192/api/xmeow/status",
    "bearerToken": "replace-with-a-long-random-token",
    "sessionId": "xmeow-bar"
  }
}
```

Use `ws://` / `http://` only inside trusted local development.

## Harness

```bash
node --check dist/index.mjs
node scripts/harness.mjs
```

The checked-in `dist/index.mjs` is self-contained for the small SDK surface this plugin needs. When the full Iris build pipeline is available, `npm run build` can regenerate it through the normal extension bundling path.
