import type { Disposable, IrisAPI } from 'irises-extension-sdk';
import type { XMeowConfig } from '../config.js';
import type { XMeowAdapterService } from '../application/xmeow-adapter.js';
import { makeChatResponse, makeGenericNotice, mapAgentNotification, mapTaskResult } from '../application/event-mapper.js';

export function wireBackendEvents(
  api: IrisAPI,
  adapter: XMeowAdapterService,
  getConfig: () => XMeowConfig,
): Disposable {
  const backend = api.backend;

  const onResponse = (sessionId: string, text: string) => {
    const config = getConfig();
    if (sessionId !== config.session.id) return;
    adapter.publish(makeChatResponse(text, sessionId));
  };

  const onError = (sessionId: string, message: string) => {
    const config = getConfig();
    if (sessionId !== config.session.id) return;
    adapter.publish(makeGenericNotice(message, { source: 'backend.error', session_id: sessionId }));
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
  backend.on('error', onError);
  backend.on('agent:notification' as any, onAgentNotification as any);
  backend.on('task:result' as any, onTaskResult as any);

  return {
    dispose() {
      backend.off('response', onResponse);
      backend.off('error', onError);
      backend.off('agent:notification' as any, onAgentNotification as any);
      backend.off('task:result' as any, onTaskResult as any);
    },
  };
}
