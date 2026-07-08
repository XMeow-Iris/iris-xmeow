import * as crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

type MessageListener = (text: string) => void | Promise<void>;
type CloseListener = () => void;

export class MinimalWebSocketConnection {
  private socket: Duplex;
  private buffer = Buffer.alloc(0);
  private closed = false;
  private messageListeners = new Set<MessageListener>();
  private closeListeners = new Set<CloseListener>();

  constructor(socket: Duplex, head?: Buffer) {
    this.socket = socket;
    this.socket.on('data', (chunk: Buffer) => this.receive(chunk));
    this.socket.on('close', () => this.markClosed());
    this.socket.on('error', () => this.markClosed());
    if (head && head.length > 0) this.receive(head);
  }

  onMessage(listener: MessageListener): { dispose(): void } {
    this.messageListeners.add(listener);
    return { dispose: () => this.messageListeners.delete(listener) };
  }

  onClose(listener: CloseListener): { dispose(): void } {
    this.closeListeners.add(listener);
    return { dispose: () => this.closeListeners.delete(listener) };
  }

  sendJSON(value: unknown): void {
    this.sendText(JSON.stringify(value));
  }

  sendText(text: string): void {
    if (this.closed) return;
    this.socket.write(encodeFrame(Buffer.from(text, 'utf8'), 0x1));
  }

  close(code = 1000, reason = ''): void {
    if (this.closed) return;
    const reasonBuffer = Buffer.from(reason, 'utf8');
    const payload = Buffer.alloc(2 + reasonBuffer.length);
    payload.writeUInt16BE(code, 0);
    reasonBuffer.copy(payload, 2);
    this.socket.write(encodeFrame(payload, 0x8));
    this.socket.end();
    this.markClosed();
  }

  private receive(chunk: Buffer): void {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 2) {
      const parsed = tryDecodeFrame(this.buffer);
      if (!parsed) return;
      this.buffer = this.buffer.subarray(parsed.consumed);

      switch (parsed.opcode) {
      case 0x1:
        this.emitMessage(parsed.payload.toString('utf8'));
        break;
      case 0x8:
        this.close();
        return;
      case 0x9:
        this.socket.write(encodeFrame(parsed.payload, 0xA));
        break;
      case 0xA:
        break;
      default:
        // This tiny endpoint only accepts text/control frames.
        this.close(1003, 'unsupported frame');
        return;
      }
    }
  }

  private emitMessage(text: string): void {
    for (const listener of this.messageListeners) {
      void listener(text);
    }
  }

  private markClosed(): void {
    if (this.closed) return;
    this.closed = true;
    for (const listener of this.closeListeners) listener();
    this.messageListeners.clear();
    this.closeListeners.clear();
  }
}

export class MinimalWebSocketServer {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, onConnection: (connection: MinimalWebSocketConnection) => void): void {
    const key = req.headers['sec-websocket-key'];
    if (typeof key !== 'string' || key.length === 0) {
      writeHttpError(socket, 400, 'Bad Request');
      return;
    }

    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '\r\n',
    ].join('\r\n'));

    onConnection(new MinimalWebSocketConnection(socket, head));
  }
}

interface ParsedFrame {
  opcode: number;
  payload: Buffer;
  consumed: number;
}

function tryDecodeFrame(buffer: Buffer): ParsedFrame | undefined {
  if (buffer.length < 2) return undefined;

  const first = buffer[0];
  const second = buffer[1];
  const fin = (first & 0x80) !== 0;
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let offset = 2;

  if (!fin) {
    // Fragmentation is intentionally unsupported for this tiny internal protocol.
    return { opcode: 0x8, payload: Buffer.from('fragmented frames unsupported'), consumed: buffer.length };
  }

  if (length === 126) {
    if (buffer.length < offset + 2) return undefined;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return undefined;
    const bigLength = buffer.readBigUInt64BE(offset);
    if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
      return { opcode: 0x8, payload: Buffer.from('frame too large'), consumed: buffer.length };
    }
    length = Number(bigLength);
    offset += 8;
  }

  let mask: Buffer | undefined;
  if (masked) {
    if (buffer.length < offset + 4) return undefined;
    mask = buffer.subarray(offset, offset + 4);
    offset += 4;
  }

  if (buffer.length < offset + length) return undefined;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) {
    for (let i = 0; i < payload.length; i += 1) {
      payload[i] = payload[i] ^ mask[i % 4];
    }
  }

  return { opcode, payload, consumed: offset + length };
}

function encodeFrame(payload: Buffer, opcode: number): Buffer {
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length <= 0xffff) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | (opcode & 0x0f);
  return Buffer.concat([header, payload]);
}

function writeHttpError(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}
