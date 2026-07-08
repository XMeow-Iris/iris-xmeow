# XMeow Protocol v1

This is the stable projection contract between the Iris-side XMeow adapter and the macOS XMeow Bar surface.

## HTTP

```text
GET /api/xmeow/status
```

Response shape:

```json
{
  "type": "event",
  "event_type": "status_update",
  "mood": "calm",
  "ear_direction": "relaxed",
  "last_interaction_ago_sec": 120,
  "unread_count": 0,
  "message": "咪在菜单栏边缘打盹。",
  "timestamp": 1783440000000,
  "metadata": {
    "plugin": "xmeow-bar",
    "protocol_version": "1",
    "transport_mode": "auto",
    "websocket_clients": "1",
    "web_platform_bridge": "attached",
    "standalone_server": "disabled",
    "plugin_active": "true"
  }
}
```

The metadata is observability only. The Swift app must not make product decisions from transport lifecycle metadata.

## WebSocket

```text
WS /ws/xmeow
```

Client to server:

```json
{ "type": "ping", "timestamp": 1783440000000 }
{ "type": "get_status" }
{ "type": "user_input", "text": "今天练腿吗", "timestamp": 1783440000000 }
```

Server to client:

```json
{ "type": "pong", "timestamp": 1783440000000 }
{ "type": "event", "event_type": "status_update", "mood": "calm", "ear_direction": "relaxed" }
{ "type": "chat_response", "text": "今天你该练腿哦。", "timestamp": 1783440001000 }
{ "type": "event", "event_type": "qdii_report", "summary": "纳指 ETF 溢价 6.3%", "timestamp": 1783440002000 }
```

## Auth

When `xmeow.auth.bearerToken` is set, both HTTP and WebSocket endpoints accept the same credential:

```text
Authorization: Bearer <token>
```

For WebSocket clients that cannot set headers, `?token=<token>` is also accepted. Tokenless mode should only be used on a private loopback or Tailscale-only deployment.

## Compatibility rules

- Additive fields are allowed.
- Unknown event types should be mapped by the Swift client to `generic_notice`.
- Unknown top-level message types should fail fast and be logged.
- Timestamps are Unix milliseconds.
- The adapter is a projection layer. It must not own memory, cron scheduling, or a second Agent brain.
