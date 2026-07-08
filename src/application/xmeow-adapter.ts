import { EventEmitter } from 'node:events';
import type { IrisAPI } from 'irises-extension-sdk';
import type { XMeowConfig } from '../config.js';
import type { ClientEnvelope, XMeowEnvelope, XMeowStatusEnvelope } from '../domain/protocol.js';
import { nowMs } from '../domain/protocol.js';
import type { XMeowLifecycleSnapshot, XMeowPresenceState } from '../domain/status.js';
import { applyOutboundEvent, initialPresence, markUserInput, statusEnvelope } from '../domain/status.js';
import { makeGenericNotice } from './event-mapper.js';

export interface XMeowAdapterServiceSnapshot {
  status: XMeowStatusEnvelope;
  lifecycle: XMeowLifecycleSnapshot;
}

export interface XMeowAdapterServicePublicApi {
  getStatus(): XMeowStatusEnvelope;
  publish(event: XMeowEnvelope): void;
  getSnapshot(): XMeowAdapterServiceSnapshot;
}

interface XMeowAdapterServiceEvents {
  envelope: [XMeowEnvelope];
  status: [XMeowStatusEnvelope];
}

type TypedEventName = keyof XMeowAdapterServiceEvents;

export class XMeowAdapterService extends EventEmitter implements XMeowAdapterServicePublicApi {
  private config: XMeowConfig;
  private presence: XMeowPresenceState;
  private api?: IrisAPI;
  private lifecycle: XMeowLifecycleSnapshot;

  constructor(config: XMeowConfig) {
    super();
    this.config = config;
    this.presence = initialPresence(config);
    this.lifecycle = {
      pluginActive: true,
      websocketClients: 0,
      transportMode: config.transport.mode,
      webPlatformBridge: 'not-requested',
      standaloneServer: 'not-requested',
    };
  }

  setApi(api: IrisAPI): void {
    this.api = api;
  }

  updateConfig(config: XMeowConfig): void {
    this.config = config;
    this.lifecycle.transportMode = config.transport.mode;
    if (!this.presence.latestMessage) this.presence.latestMessage = config.presence.defaultMessage;
  }

  setLifecycle(update: Partial<XMeowLifecycleSnapshot>): void {
    this.lifecycle = { ...this.lifecycle, ...update };
    this.emitStatus();
  }

  getStatus(): XMeowStatusEnvelope {
    return statusEnvelope(this.presence, this.config, this.lifecycle);
  }

  getSnapshot(): XMeowAdapterServiceSnapshot {
    return { status: this.getStatus(), lifecycle: { ...this.lifecycle } };
  }

  publish(event: XMeowEnvelope): void {
    this.presence = applyOutboundEvent(this.presence, event);
    this.emit('envelope', event);
    this.emitStatus();
  }

  async handleClientMessage(raw: string): Promise<XMeowEnvelope | undefined> {
    let message: ClientEnvelope;
    try {
      message = JSON.parse(raw) as ClientEnvelope;
    } catch {
      return makeGenericNotice('XMeow 收到无法解析的消息。', { error: 'invalid_json' });
    }

    switch (message.type) {
    case 'ping':
      return { type: 'pong', timestamp: nowMs() };

    case 'get_status':
      return this.getStatus();

    case 'user_input':
      return await this.handleUserInput(typeof message.text === 'string' ? message.text : '');

    default:
      return makeGenericNotice(`XMeow 不认识的消息类型: ${(message as { type?: unknown }).type ?? 'unknown'}`, { error: 'unknown_message_type' });
    }
  }

  async handleUserInput(text: string): Promise<XMeowEnvelope | undefined> {
    const trimmed = text.trim();
    if (!trimmed) {
      return makeGenericNotice('空消息没有发送给 Iris。', { reason: 'empty_user_input' });
    }
    if (!this.api?.backend?.chat) {
      return makeGenericNotice('Iris backend 尚未就绪，消息没有发送。', { reason: 'backend_unavailable' });
    }

    const timestamp = nowMs();
    this.presence = markUserInput(this.presence, trimmed, timestamp);
    this.emitStatus();

    try {
      await this.api.backend.chat(this.config.session.id, trimmed, undefined, undefined, this.config.session.platform);
      return undefined;
    } catch (error) {
      return makeGenericNotice('发送给 Iris 失败。', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  onEnvelope(listener: (event: XMeowEnvelope) => void): { dispose(): void } {
    this.on('envelope', listener);
    return { dispose: () => this.off('envelope', listener) };
  }

  onStatus(listener: (status: XMeowStatusEnvelope) => void): { dispose(): void } {
    this.on('status', listener);
    return { dispose: () => this.off('status', listener) };
  }

  markClientCount(count: number): void {
    if (this.lifecycle.websocketClients === count) return;
    this.lifecycle.websocketClients = count;
    this.emitStatus();
  }

  deactivate(): void {
    this.lifecycle.pluginActive = false;
    this.removeAllListeners();
  }

  private emitStatus(): void {
    this.emit('status', this.getStatus());
  }

  override on<T extends TypedEventName>(eventName: T, listener: (...args: XMeowAdapterServiceEvents[T]) => void): this {
    return super.on(eventName, listener as (...args: unknown[]) => void);
  }

  override off<T extends TypedEventName>(eventName: T, listener: (...args: XMeowAdapterServiceEvents[T]) => void): this {
    return super.off(eventName, listener as (...args: unknown[]) => void);
  }

  override emit<T extends TypedEventName>(eventName: T, ...args: XMeowAdapterServiceEvents[T]): boolean {
    return super.emit(eventName, ...args);
  }
}
