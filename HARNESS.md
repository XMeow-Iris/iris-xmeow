# XMeow Bar Iris Adapter Harness

This extension is maintained as a boundary adapter, not as an Iris core patch.

## Non-negotiable architecture rules

1. Domain and application files must not import Iris WebPlatform internals.
2. Product semantics live in `src/application` and `src/domain`, never in the WebSocket bridge.
3. `/api/xmeow/status` must be registered through the public `IrisAPI.registerWebRoute` when available.
4. `/ws/xmeow` may use `WebPlatformUpgradeBridge` only as an isolated private infrastructure seam.
5. The private bridge must fail closed and must be removable once Iris exposes a public WebSocket route API.
6. Standalone transport must remain available for non-maintainer operation.
7. XMeow user input must route to Iris backend chat using the configured XMeow session. The adapter must not create another Agent, scheduler, or memory store.
8. HTTP and WebSocket endpoints must share the same auth policy.
9. Event mappings must be additive and configurable. Unknown task signals degrade to generic notices.
10. Lifecycle state must be observable through the status envelope metadata.

## Local checks

```bash
node --check dist/index.mjs
node scripts/harness.mjs
```

The source package can be bundled by Iris' normal extension build pipeline when Bun and project dependencies are installed. This repository snapshot also carries a self-contained `dist/index.mjs` so the extension can be installed without rebuilding.
