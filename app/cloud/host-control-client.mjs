import http from 'node:http';
import path from 'node:path';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const unavailable = () => new Error('File host control outcome unconfirmed');

// Trusted controller only. This credential is never sent to a worker or browser.
// Each operation has one request: a lost acknowledgement is recovery work, not a
// reason to silently repeat a begin/checkpoint/release operation.
export class HostControlClient {
  #socketPath;
  #token;
  #timeoutMs;
  constructor({ socketPath, token, timeoutMs = 30000 } = {}) {
    if (typeof socketPath !== 'string' || !path.isAbsolute(socketPath) || socketPath.includes('\0') ||
        Buffer.byteLength(socketPath) > 100 || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) ||
        !Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 300000)
      throw new Error('Invalid file host control configuration');
    this.#socketPath = socketPath; this.#token = token; this.#timeoutMs = timeoutMs;
  }
  forRun(claim) {
    const id = claim?.id;
    if (!uuid(id)) throw new Error('Invalid file host run identity');
    const operation = async (requestedId, action) => {
      if (requestedId !== id) throw new Error('File host run identity mismatch');
      return this.#request(id, action);
    };
    return Object.freeze({
      beginRun: requestedId => operation(requestedId, 'begin'),
      checkpointRun: requestedId => operation(requestedId, 'checkpoint'),
      releaseRun: requestedId => operation(requestedId, 'release'),
      activeRunId: async () => (await this.#request(id, 'status')).active ? id : null,
    });
  }
  #request(id, action) {
    return new Promise((resolve, reject) => {
      let request, response, finished = false;
      const finish = (error, value) => {
        if (finished) return;
        finished = true; clearTimeout(deadline);
        if (error) { response?.destroy(); request?.destroy(); reject(unavailable()); }
        else resolve(value);
      };
      // Wall-clock deadline includes connect, headers and a continuously trickling
      // response. A socket inactivity timer alone would not impose this bound.
      const deadline = setTimeout(() => finish(true), this.#timeoutMs);
      try {
        request = http.request({ socketPath: this.#socketPath, host: 'localhost', method: 'POST',
          path: `/runs/${id}/${action}`, agent: false, maxHeaderSize: 8192,
          headers: { Authorization: `Bearer ${this.#token}`, 'Content-Type': 'application/json',
            'Content-Length': 2, Connection: 'close' },
        }, incoming => {
          response = incoming;
          if (incoming.statusCode !== 200 || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(incoming.headers['content-type'] || ''))
            return finish(true);
          let size = 0; const chunks = [];
          incoming.on('data', chunk => {
            size += chunk.length;
            if (size > 4096) return finish(true);
            chunks.push(chunk);
          });
          incoming.once('error', () => finish(true));
          incoming.once('aborted', () => finish(true));
          incoming.once('close', () => { if (!incoming.complete) finish(true); });
          incoming.once('end', () => {
            if (finished) return;
            try {
              const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
              const key = action === 'status' ? 'active' : 'ok';
              if (!value || Array.isArray(value) || Object.keys(value).length !== 1 ||
                  typeof value[key] !== 'boolean' || (key === 'ok' && value.ok !== true)) return finish(true);
              finish(false, value);
            } catch { finish(true); }
          });
        });
        request.once('error', () => finish(true));
        request.once('upgrade', (incoming, socket) => { socket.destroy(); finish(true); });
        request.once('connect', (incoming, socket) => { socket.destroy(); finish(true); });
        request.end('{}');
      } catch { finish(true); }
    });
  }
}
