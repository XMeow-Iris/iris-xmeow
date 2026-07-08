import type { IncomingMessage } from 'node:http';
import type { XMeowConfig } from '../../config.js';

export function isAuthorized(req: IncomingMessage, config: XMeowConfig): boolean {
  const expected = config.auth.bearerToken?.trim();
  if (!expected) return !config.auth.requireToken || isLoopback(req, config);

  const auth = req.headers.authorization ?? '';
  const tokenFromHeader = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
  if (tokenFromHeader && safeEqual(tokenFromHeader, expected)) return true;

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const tokenFromQuery = url.searchParams.get('token')?.trim() ?? '';
  if (tokenFromQuery && safeEqual(tokenFromQuery, expected)) return true;

  return !config.auth.requireToken && config.auth.allowMissingTokenOnLoopback && isLoopback(req, config);
}

function isLoopback(req: IncomingMessage, config: XMeowConfig): boolean {
  if (!config.auth.allowMissingTokenOnLoopback) return false;
  const address = req.socket.remoteAddress ?? '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
