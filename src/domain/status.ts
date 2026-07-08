import type { XMeowConfig } from '../config.js';
import type { XMeowEnvelope, XMeowStatusEnvelope } from './protocol.js';
import { nowMs, safeMetadata } from './protocol.js';

export interface XMeowPresenceState {
  mood: string;
  earDirection: string;
  lastInteractionAt?: number;
  unreadCount: number;
  latestMessage?: string;
  startedAt: number;
  lastEventAt?: number;
}

export interface XMeowLifecycleSnapshot {
  pluginActive: boolean;
  websocketClients: number;
  transportMode: string;
  webPlatformBridge: 'not-requested' | 'attached' | 'unavailable' | 'disabled' | 'error';
  standaloneServer: 'not-requested' | 'listening' | 'disabled' | 'error';
}

export function initialPresence(config: XMeowConfig, startedAt = nowMs()): XMeowPresenceState {
  return {
    mood: config.presence.mood,
    earDirection: config.presence.earDirection,
    unreadCount: 0,
    latestMessage: config.presence.defaultMessage,
    startedAt,
  };
}

export function statusEnvelope(
  state: XMeowPresenceState,
  config: XMeowConfig,
  lifecycle: XMeowLifecycleSnapshot,
  timestamp = nowMs(),
): XMeowStatusEnvelope {
  const lastInteractionAgo = state.lastInteractionAt ? Math.max(0, (timestamp - state.lastInteractionAt) / 1000) : undefined;
  return {
    type: 'event',
    event_type: 'status_update',
    mood: state.mood || config.presence.mood,
    ear_direction: state.earDirection || config.presence.earDirection,
    last_interaction_ago_sec: lastInteractionAgo,
    last_interaction_at: state.lastInteractionAt,
    unread_count: Math.max(0, state.unreadCount),
    message: state.latestMessage || config.presence.defaultMessage,
    timestamp,
    metadata: safeMetadata({
      plugin: 'xmeow-bar',
      protocol_version: '1',
      transport_mode: lifecycle.transportMode,
      websocket_clients: lifecycle.websocketClients,
      web_platform_bridge: lifecycle.webPlatformBridge,
      standalone_server: lifecycle.standaloneServer,
      plugin_active: lifecycle.pluginActive,
    }),
  };
}

export function applyOutboundEvent(state: XMeowPresenceState, event: XMeowEnvelope): XMeowPresenceState {
  const next = { ...state };
  next.lastEventAt = event.timestamp ?? nowMs();
  const visible = event.message ?? event.text ?? event.summary;
  if (visible) next.latestMessage = visible;

  if (event.type === 'chat_response') {
    next.unreadCount = 0;
    next.lastInteractionAt = event.timestamp ?? nowMs();
    next.mood = 'calm';
    next.earDirection = 'relaxed';
    return next;
  }

  if (event.type === 'event' && event.event_type && event.event_type !== 'status_update') {
    next.unreadCount += 1;
    next.earDirection = 'up';
    if (event.event_type === 'random_wake') next.mood = 'curious';
    if (event.event_type === 'qdii_report') next.mood = 'focused';
  }

  return next;
}

export function markUserInput(state: XMeowPresenceState, text: string, timestamp = nowMs()): XMeowPresenceState {
  return {
    ...state,
    latestMessage: text,
    lastInteractionAt: timestamp,
    unreadCount: 0,
    mood: 'focused',
    earDirection: 'relaxed',
  };
}
