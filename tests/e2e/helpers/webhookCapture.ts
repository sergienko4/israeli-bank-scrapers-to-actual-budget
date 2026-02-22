/**
 * Local HTTP server that captures incoming webhook requests.
 * Used to verify WebhookNotifier delivery in E2E tests.
 */

import { createServer, Server, IncomingMessage, ServerResponse } from 'http';

export interface CapturedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface WebhookCapture {
  server: Server;
  requests: CapturedRequest[];
  port: number;
  waitForRequest: (timeoutMs?: number) => Promise<CapturedRequest>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export function createWebhookCapture(): WebhookCapture {
  const requests: CapturedRequest[] = [];
  const waiters: Array<(req: CapturedRequest) => void> = [];

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      const captured: CapturedRequest = {
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        headers: req.headers as Record<string, string | string[] | undefined>,
        body,
      };
      requests.push(captured);
      const waiter = waiters.shift();
      if (waiter) waiter(captured);
      res.writeHead(200);
      res.end('OK');
    });
  });

  let port = 0;

  return {
    server,
    requests,
    get port() { return port; },
    waitForRequest: (timeoutMs = 5000) => {
      if (requests.length > 0) {
        return Promise.resolve(requests[requests.length - 1]);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Timeout waiting for webhook')),
          timeoutMs
        );
        waiters.push((req) => { clearTimeout(timer); resolve(req); });
      });
    },
    start: () => new Promise<void>((resolve) => {
      server.listen(0, () => {
        port = (server.address() as { port: number }).port;
        resolve();
      });
    }),
    stop: () => new Promise<void>((resolve) => {
      server.close(() => resolve());
    }),
  };
}
