import type { XMeowConfig } from '../config.js';
import type { XMeowEnvelope, XMeowEventType } from '../domain/protocol.js';
import { makeId, nowMs, safeMetadata } from '../domain/protocol.js';

export interface AgentNotificationInput {
  sessionId: string;
  taskId: string;
  status: string;
  summary: string;
  taskType?: string;
  silent?: boolean;
}

export interface TaskResultInput {
  sessionId: string;
  taskId: string;
  status: string;
  description: string;
  taskType?: string;
  silent?: boolean;
  result?: string;
}

export function shouldAcceptTaskSession(sessionId: string, config: XMeowConfig): boolean {
  const accepted = config.events.acceptedTaskSessionIds;
  return accepted.length === 0 || accepted.includes(sessionId);
}

export function mapAgentNotification(input: AgentNotificationInput, config: XMeowConfig): XMeowEnvelope | undefined {
  if (!shouldAcceptTaskSession(input.sessionId, config)) return undefined;
  if (input.silent && !config.events.includeSilentTaskResults) return undefined;

  const eventType = inferEventType([
    input.taskType,
    input.status,
    input.summary,
    input.taskId,
  ], config) ?? 'agent_notification';

  return {
    type: 'event',
    event_type: eventType,
    id: makeId('xmeow-agent'),
    message: input.summary,
    summary: input.summary,
    timestamp: nowMs(),
    metadata: safeMetadata({
      source: 'backend.agent_notification',
      session_id: input.sessionId,
      task_id: input.taskId,
      task_status: input.status,
      task_type: input.taskType,
      silent: input.silent,
    }),
  };
}

export function mapTaskResult(input: TaskResultInput, config: XMeowConfig): XMeowEnvelope | undefined {
  if (!shouldAcceptTaskSession(input.sessionId, config)) return undefined;
  if (input.silent && !config.events.includeSilentTaskResults) return undefined;

  const eventType = inferEventType([
    input.taskType,
    input.status,
    input.description,
    input.result,
    input.taskId,
  ], config) ?? 'task_result';
  const text = input.result?.trim() || input.description;

  return {
    type: 'event',
    event_type: eventType,
    id: makeId('xmeow-task'),
    message: eventType === 'random_wake' ? text : undefined,
    summary: text,
    timestamp: nowMs(),
    metadata: safeMetadata({
      source: 'backend.task_result',
      session_id: input.sessionId,
      task_id: input.taskId,
      task_status: input.status,
      task_type: input.taskType,
      silent: input.silent,
    }),
  };
}

export function makeChatResponse(text: string, sessionId: string): XMeowEnvelope {
  return {
    type: 'chat_response',
    text,
    timestamp: nowMs(),
    metadata: safeMetadata({
      source: 'backend.response',
      session_id: sessionId,
    }),
  };
}

export function makeGenericNotice(message: string, metadata: Record<string, unknown> = {}): XMeowEnvelope {
  return {
    type: 'event',
    event_type: 'generic_notice',
    id: makeId('xmeow-notice'),
    message,
    timestamp: nowMs(),
    metadata: safeMetadata({ source: 'xmeow.adapter', ...metadata }),
  };
}

function inferEventType(parts: Array<string | undefined>, config: XMeowConfig): XMeowEventType | undefined {
  const haystack = parts.filter(Boolean).join('\n').toLocaleLowerCase();
  for (const [eventType, mapping] of Object.entries(config.events.mappings)) {
    for (const keyword of mapping.keywords) {
      if (keyword && haystack.includes(keyword.toLocaleLowerCase())) {
        return eventType as XMeowEventType;
      }
    }
  }
  return undefined;
}
