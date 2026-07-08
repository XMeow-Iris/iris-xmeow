export type TransportMode = 'auto' | 'web-platform' | 'standalone' | 'off';

export interface XMeowConfig {
  enabled: boolean;
  session: {
    id: string;
    platform: string;
    agentName?: string;
  };
  auth: {
    bearerToken?: string;
    requireToken: boolean;
    allowMissingTokenOnLoopback: boolean;
  };
  transport: {
    mode: TransportMode;
    webPlatform: {
      enabled: boolean;
      allowPrivateUpgradeBridge: boolean;
    };
    standalone: {
      enabled: boolean;
      host: string;
      port: number;
    };
  };
  presence: {
    mood: string;
    earDirection: string;
    defaultMessage: string;
    staleAfterSeconds: number;
  };
  events: {
    acceptedTaskSessionIds: string[];
    includeSilentTaskResults: boolean;
    mappings: Record<string, { keywords: string[] }>;
  };
}

export const DEFAULT_CONFIG: XMeowConfig = {
  enabled: true,
  session: {
    id: 'xmeow-bar',
    platform: 'xmeow-bar',
  },
  auth: {
    bearerToken: undefined,
    requireToken: false,
    allowMissingTokenOnLoopback: true,
  },
  transport: {
    mode: 'auto',
    webPlatform: {
      enabled: true,
      allowPrivateUpgradeBridge: true,
    },
    standalone: {
      enabled: false,
      host: '127.0.0.1',
      port: 8193,
    },
  },
  presence: {
    mood: 'calm',
    earDirection: 'relaxed',
    defaultMessage: '咪在菜单栏边缘打盹。',
    staleAfterSeconds: 7200,
  },
  events: {
    acceptedTaskSessionIds: [],
    includeSilentTaskResults: true,
    mappings: {
      qdii_report: { keywords: ['qdii', 'QDII', '溢价', '纳指', 'ETF', '日报'] },
      random_wake: { keywords: ['random_wake', '随机唤醒', 'virtual-lover', 'proactive', '主动消息', '找你'] },
      honey_mail: { keywords: ['honey_mail', '蜜语', '邮件', 'mail'] },
      diary_completed: { keywords: ['diary', '日记', '凌晨日记'] },
    },
  },
};

export const defaultConfigTemplate = `# XMeow Bar Iris adapter defaults.\nxmeow:\n  enabled: true\n\n  session:\n    id: xmeow-bar\n    platform: xmeow-bar\n    agentName: null\n\n  auth:\n    bearerToken: ""\n    requireToken: false\n    allowMissingTokenOnLoopback: true\n\n  transport:\n    mode: auto\n    webPlatform:\n      enabled: true\n      allowPrivateUpgradeBridge: true\n    standalone:\n      enabled: false\n      host: 127.0.0.1\n      port: 8193\n\n  presence:\n    mood: calm\n    earDirection: relaxed\n    defaultMessage: "咪在菜单栏边缘打盹。"\n    staleAfterSeconds: 7200\n\n  events:\n    acceptedTaskSessionIds: []\n    includeSilentTaskResults: true\n    mappings:\n      qdii_report:\n        keywords: ["qdii", "QDII", "溢价", "纳指", "ETF", "日报"]\n      random_wake:\n        keywords: ["random_wake", "随机唤醒", "virtual-lover", "proactive", "主动消息", "找你"]\n      honey_mail:\n        keywords: ["honey_mail", "蜜语", "邮件", "mail"]\n      diary_completed:\n        keywords: ["diary", "日记", "凌晨日记"]\n`;

export function parseXMeowConfig(raw: unknown): XMeowConfig {
  const root = asRecord(raw);
  const source = asRecord(root.xmeow ?? raw);
  const session = asRecord(source.session);
  const auth = asRecord(source.auth);
  const transport = asRecord(source.transport);
  const webPlatform = asRecord(transport.webPlatform);
  const standalone = asRecord(transport.standalone);
  const presence = asRecord(source.presence);
  const events = asRecord(source.events);

  const mode = parseTransportMode(optionalString(transport.mode), DEFAULT_CONFIG.transport.mode);

  return {
    enabled: optionalBoolean(source.enabled) ?? DEFAULT_CONFIG.enabled,
    session: {
      id: nonEmptyString(session.id, DEFAULT_CONFIG.session.id),
      platform: nonEmptyString(session.platform, DEFAULT_CONFIG.session.platform),
      agentName: optionalString(session.agentName) || undefined,
    },
    auth: {
      bearerToken: optionalString(auth.bearerToken) || undefined,
      requireToken: optionalBoolean(auth.requireToken) ?? DEFAULT_CONFIG.auth.requireToken,
      allowMissingTokenOnLoopback: optionalBoolean(auth.allowMissingTokenOnLoopback) ?? DEFAULT_CONFIG.auth.allowMissingTokenOnLoopback,
    },
    transport: {
      mode,
      webPlatform: {
        enabled: optionalBoolean(webPlatform.enabled) ?? DEFAULT_CONFIG.transport.webPlatform.enabled,
        allowPrivateUpgradeBridge: optionalBoolean(webPlatform.allowPrivateUpgradeBridge) ?? DEFAULT_CONFIG.transport.webPlatform.allowPrivateUpgradeBridge,
      },
      standalone: {
        enabled: optionalBoolean(standalone.enabled) ?? DEFAULT_CONFIG.transport.standalone.enabled,
        host: nonEmptyString(standalone.host, DEFAULT_CONFIG.transport.standalone.host),
        port: clampInteger(standalone.port, DEFAULT_CONFIG.transport.standalone.port, 1, 65535),
      },
    },
    presence: {
      mood: nonEmptyString(presence.mood, DEFAULT_CONFIG.presence.mood),
      earDirection: nonEmptyString(presence.earDirection, DEFAULT_CONFIG.presence.earDirection),
      defaultMessage: nonEmptyString(presence.defaultMessage, DEFAULT_CONFIG.presence.defaultMessage),
      staleAfterSeconds: clampNumber(presence.staleAfterSeconds, DEFAULT_CONFIG.presence.staleAfterSeconds, 0, 30 * 24 * 60 * 60),
    },
    events: {
      acceptedTaskSessionIds: stringArray(events.acceptedTaskSessionIds),
      includeSilentTaskResults: optionalBoolean(events.includeSilentTaskResults) ?? DEFAULT_CONFIG.events.includeSilentTaskResults,
      mappings: parseMappings(events.mappings),
    },
  };
}

function parseTransportMode(value: string | undefined, fallback: TransportMode): TransportMode {
  if (value === 'auto' || value === 'web-platform' || value === 'standalone' || value === 'off') return value;
  return fallback;
}

function parseMappings(raw: unknown): Record<string, { keywords: string[] }> {
  const source = asRecord(raw);
  const result: Record<string, { keywords: string[] }> = { ...DEFAULT_CONFIG.events.mappings };
  for (const [eventType, value] of Object.entries(source)) {
    const keywords = stringArray(asRecord(value).keywords);
    if (keywords.length > 0) result[eventType] = { keywords };
  }
  return result;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

function nonEmptyString(value: unknown, fallback: string): string {
  const parsed = optionalString(value);
  return parsed && parsed.length > 0 ? parsed : fallback;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.max(min, Math.min(max, parsed));
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, parsed));
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean);
}
