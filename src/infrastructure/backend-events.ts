import type { Disposable, IrisAPI } from 'irises-extension-sdk';
import type { XMeowConfig } from '../config.js';
import type { XMeowAdapterService } from '../application/xmeow-adapter.js';
import { makeChatResponse, makeGenericNotice, mapAgentNotification, mapTaskResult } from '../application/event-mapper.js';

/**
 * Bridge Iris backend events onto the XMeow adapter.
 *
 * IMPORTANT — streaming vs. non-streaming chat replies:
 * Iris only emits the aggregate `response` event when streaming is DISABLED
 * (`this.stream === false`) or a non-stream fallback model was appended. With
 * `stream: true` (the default in this deployment) the assistant reply is
 * delivered through `assistant:content` (one structured content object per model
 * message) plus `stream:*`, and the turn is closed with `done` — but `response`
 * never fires. Subscribing to `response` alone therefore silently drops every
 * chat reply in streaming mode (the observed "presence stuck on user input"
 * symptom).
 *
 * We consume `assistant:content` (buffering the latest visible text per session)
 * and flush a single `chat_response` on `done`. In non-streaming mode `response`
 * fires as well; it publishes immediately and clears the buffer so `done` does
 * not emit a duplicate.
 */
export function wireBackendEvents(
  api: IrisAPI,
  adapter: XMeowAdapterService,
  getConfig: () => XMeowConfig,
): Disposable {
  const backend = api.backend;

  const pendingBySession = new Map<string, string>();

  const publishChatResponse = (sessionId: string, text: string): void => {
    const trimmed = (text ?? '').trim();
    if (!trimmed) return;
    adapter.publish(makeChatResponse(trimmed, sessionId));
  };

  const onResponse = (sessionId: string, text: unknown) => {
    const config = getConfig();
    if (sessionId !== config.session.id) return;
    pendingBySession.delete(sessionId);
    publishChatResponse(sessionId, typeof text === 'string' ? text : extractAssistantText(text));
  };

  const onAssistantContent = (sessionId: string, content: unknown) => {
    const config = getConfig();
    if (sessionId !== config.session.id) return;
    const text = extractAssistantText(content);
    if (text.trim()) pendingBySession.set(sessionId, text);
  };

  const onDone = (sessionId: string) => {
    const config = getConfig();
    if (sessionId !== config.session.id) return;
    const text = pendingBySession.get(sessionId);
    pendingBySession.delete(sessionId);
    if (text) publishChatResponse(sessionId, text);
  };

  const onError = (sessionId: string, message: unknown) => {
    const config = getConfig();
    if (sessionId !== config.session.id) return;
    pendingBySession.delete(sessionId);
    const text = message instanceof Error ? message.message : String(message ?? 'unknown error');
    adapter.publish(makeGenericNotice(text, { source: 'backend.error', session_id: sessionId }));
  };

  const onAgentNotification = (
    sessionId: string,
    taskId: string,
    status: string,
    summary: string,
    taskType?: string,
    silent?: boolean,
  ) => {
    const event = mapAgentNotification({ sessionId, taskId, status, summary, taskType, silent }, getConfig());
    if (event) adapter.publish(event);
  };

  const onTaskResult = (
    sessionId: string,
    taskId: string,
    status: string,
    description: string,
    taskType?: string,
    silent?: boolean,
    result?: string,
  ) => {
    const event = mapTaskResult({ sessionId, taskId, status, description, taskType, silent, result }, getConfig());
    if (event) adapter.publish(event);
  };

  backend.on('response', onResponse);
  backend.on('assistant:content' as any, onAssistantContent as any);
  backend.on('done' as any, onDone as any);
  backend.on('error', onError);
  backend.on('agent:notification' as any, onAgentNotification as any);
  backend.on('task:result' as any, onTaskResult as any);

  return {
    dispose() {
      backend.off('response', onResponse);
      backend.off('assistant:content' as any, onAssistantContent as any);
      backend.off('done' as any, onDone as any);
      backend.off('error', onError);
      backend.off('agent:notification' as any, onAgentNotification as any);
      backend.off('task:result' as any, onTaskResult as any);
    },
  };
}

/**
 * Extract the visible assistant text from the many shapes an
 * `assistant:content` / `response` payload can take:
 *  - a plain string (legacy `response` finalText)
 *  - a GenAI content object `{ role, parts: [{ text, thought? }] }`
 *  - `{ content: [{ text }] }` / `{ text }`
 * Thought/reasoning parts are ignored so only the user-facing reply surfaces.
 */
export function extractAssistantText(content: unknown): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (typeof content === 'object') {
    const obj = content as Record<string, unknown>;
    const parts = (obj.parts ?? obj.content) as unknown;
    if (Array.isArray(parts)) {
      return parts
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part && typeof part === 'object') {
            const p = part as Record<string, unknown>;
            if (p.thought) return '';
            if (typeof p.text === 'string') return p.text;
          }
          return '';
        })
        .join('');
    }
    if (typeof obj.text === 'string') return obj.text;
  }
  return '';
}
