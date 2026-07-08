export type XMeowEventType =
  | 'random_wake'
  | 'qdii_report'
  | 'honey_mail'
  | 'diary_completed'
  | 'status_update'
  | 'chat_response'
  | 'agent_notification'
  | 'task_result'
  | 'generic_notice';

export interface XMeowEnvelope {
  type: string;
  event_type?: XMeowEventType | string;
  id?: string;
  message?: string;
  text?: string;
  summary?: string;
  timestamp?: number;
  mood?: string;
  ear_direction?: string;
  last_interaction_ago_sec?: number;
  last_interaction_at?: number;
  unread_count?: number;
  metadata?: Record<string, string>;
}

export interface XMeowStatusEnvelope extends XMeowEnvelope {
  type: 'event';
  event_type: 'status_update';
  mood: string;
  ear_direction: string;
  timestamp: number;
  unread_count: number;
}

export type ClientEnvelope =
  | { type: 'ping'; timestamp?: number }
  | { type: 'get_status'; timestamp?: number }
  | { type: 'user_input'; text?: string; timestamp?: number };

export function nowMs(): number {
  return Date.now();
}

export function makeId(prefix = 'xmeow'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function safeMetadata(input: Record<string, unknown>): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    metadata[key] = typeof value === 'string' ? value : String(value);
  }
  return metadata;
}
