/**
 * A one-hop reverse proxy for E2E tests.
 *
 * Behind Tailscale Serve the portal never sees the phone's address on the
 * socket — it only learns it from `X-Forwarded-For`. This stub reproduces that
 * hop so a test can prove `PORTAL_TRUST_PROXY` really re-keys rate limits onto
 * the forwarded caller instead of the single proxy socket.
 *
 * Requests carrying `x-e2e-client` are attributed to that address, which lets
 * one test act as two different callers.
 */
import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';

/** Address used for callers that do not name themselves. */
export const DEFAULT_CLIENT_IP = '203.0.113.7';

/** Header a test sets to pretend the request came from another address. */
export const CLIENT_HEADER = 'x-e2e-client';

/** A running proxy and its shutdown handle. */
export interface IForwardingProxy {
  baseUrl: string;
  close: () => Promise<void>;
}

/**
 * Picks the address this hop should attribute the request to.
 * @param req - Incoming request.
 * @returns The caller address to forward.
 */
function clientOf(req: IncomingMessage): string {
  const named = req.headers[CLIENT_HEADER];
  return typeof named === 'string' && named.length > 0 ? named : DEFAULT_CLIENT_IP;
}

/**
 * Copies the incoming headers, replacing the forwarding claims with this hop's.
 * @param req - Incoming request.
 * @param host - Upstream host header value.
 * @returns Headers to send upstream.
 */
function forwardHeaders(req: IncomingMessage, host: string): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined && key !== 'host') headers[key] = value;
  }
  const client = clientOf(req);
  headers['x-forwarded-for'] = client;
  headers['x-forwarded-proto'] = 'https';
  headers['x-forwarded-host'] = host;
  headers.host = host;
  return headers;
}

/**
 * Streams one request upstream and the response back, untouched.
 * @param target - Upstream origin, e.g. `http://127.0.0.1:32770`.
 * @param req - Incoming request.
 * @param res - Response to write.
 * @returns void.
 */
function relay(target: URL, req: IncomingMessage, res: ServerResponse): void {
  const headers = forwardHeaders(req, target.host);
  const upstream = request(
    {
      host: target.hostname, port: target.port, method: req.method,
      path: req.url, headers,
    },
    (proxied) => {
      res.writeHead(proxied.statusCode ?? 502, proxied.headers);
      proxied.pipe(res);
    },
  );
  upstream.on('error', () => {
    // An upstream that dies mid-response has already had its head written, and
    // writing a second one throws from inside this handler, which the test
    // process sees as an unhandled exception rather than a failed request.
    if (!res.headersSent) res.writeHead(502);
    res.end('proxy upstream failed');
  });
  req.on('aborted', () => { upstream.destroy(); });
  req.pipe(upstream);
}

/**
 * Reads the port a listening server bound to.
 * @param server - A listening server.
 * @returns The bound port.
 */
function boundPort(server: Server): number {
  const address = server.address() as AddressInfo;
  return address.port;
}

/**
 * Starts the proxy on an ephemeral loopback port.
 *
 * The upstream is supplied lazily because the container it fronts is usually
 * started after the proxy — the proxy's own URL has to exist first so it can be
 * written into the portal's Google `redirectUri` before boot.
 * @param upstream - Returns the current upstream origin.
 * @returns The proxy base URL and a close handle.
 */
export async function startForwardingProxy(upstream: () => string): Promise<IForwardingProxy> {
  const server = createServer((req, res) => {
    const target = new URL(upstream());
    relay(target, req, res);
  });
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const baseUrl = `http://127.0.0.1:${String(boundPort(server))}`;
  const close = async (): Promise<void> => {
    await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
  };
  return { baseUrl, close };
}
