/**
 * Egress proxy: the only way out of the sandbox network.
 *
 * Agent sandboxes run on an internal Docker network with no route to the
 * internet, but the agent CLIs still have to reach their provider's API. This
 * proxy sits on both the internal network and a normal one. It accepts only
 * HTTPS `CONNECT` tunnels to port 443 of hostnames on an exact-match
 * allowlist, and refuses everything else: plain HTTP requests, other ports,
 * IP literals and hostnames that resolve to private addresses.
 *
 * Because tunnels are opaque TLS, the proxy never sees request contents or
 * API keys. It logs one JSON line per tunnel decision.
 *
 * The file only uses Node built-ins and runs directly with Node's type
 * stripping, so it must not import other project files. See D-023 in
 * docs/decisions.md.
 */
import { lookup } from 'node:dns/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { BlockList, connect, isIP } from 'node:net';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';

/** The only destination port tunnels may use. */
export const HTTPS_PORT = 443;

/** Port the proxy listens on unless `EGRESS_PROXY_PORT` says otherwise. */
const DEFAULT_LISTEN_PORT = 3128;

/** A tunnel with no traffic in either direction for this long is closed. */
const TUNNEL_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/** How long to wait for the upstream TCP connection. */
const UPSTREAM_CONNECT_TIMEOUT_MS = 10_000;

/** A lowercase DNS hostname with at least one dot, e.g. `api.anthropic.com`. */
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Raw HTTP responses written to a client socket that asked for a tunnel. */
const TUNNEL_RESPONSES = {
  ESTABLISHED: 'HTTP/1.1 200 Connection Established\r\n\r\n',
  FORBIDDEN: 'HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n',
  BAD_GATEWAY: 'HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n',
} as const;

/** Why a tunnel was refused, as written to the log. */
export const DENIAL_REASONS = {
  MALFORMED_TARGET: 'malformed_target',
  PORT_NOT_ALLOWED: 'port_not_allowed',
  HOST_NOT_ALLOWED: 'host_not_allowed',
  PRIVATE_ADDRESS: 'private_address',
} as const;

/** A reason a tunnel was refused. */
export type DenialReason = (typeof DENIAL_REASONS)[keyof typeof DENIAL_REASONS];

/** Address ranges a tunnel may never connect to, even for an allowed hostname. */
const PRIVATE_ADDRESS_RANGES: readonly (readonly [string, number, 'ipv4' | 'ipv6'])[] = [
  ['0.0.0.0', 8, 'ipv4'],
  ['10.0.0.0', 8, 'ipv4'],
  ['100.64.0.0', 10, 'ipv4'],
  ['127.0.0.0', 8, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
  ['::', 128, 'ipv6'],
  ['::1', 128, 'ipv6'],
  ['fc00::', 7, 'ipv6'],
  ['fe80::', 10, 'ipv6'],
];

/** Writes one structured log entry. */
export type ProxyLogger = (entry: Record<string, unknown>) => void;

/** A parsed `CONNECT host:port` target. */
export interface ConnectTarget {
  host: string;
  port: number;
}

/** Settings for {@link createEgressProxy}. */
export interface EgressProxyOptions {
  /** Exact hostnames tunnels may reach. */
  allowedHosts: ReadonlySet<string>;
  /** Destination port tunnels must use. Only tests change this. */
  allowedPort?: number;
  /** Allow destinations on private or loopback addresses. Only tests set this. */
  isPrivateAddressAllowed?: boolean;
  log: ProxyLogger;
}

/** Thrown when the proxy's configuration is invalid. */
export class EgressProxyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EgressProxyConfigError';
  }
}

/**
 * Parses the comma-separated `EGRESS_ALLOWED_HOSTS` setting.
 *
 * Wildcards are deliberately not supported: every host the sandboxes may
 * reach is listed by name.
 *
 * @param value - e.g. `api.anthropic.com,api.openai.com`.
 * @returns The allowed hostnames, lowercased.
 * @throws {EgressProxyConfigError} If the list is empty or has an invalid entry.
 */
export function parseAllowedHosts(value: string | undefined): Set<string> {
  const hostnames = (value ?? '')
    .split(',')
    .map((hostname) => hostname.trim().toLowerCase())
    .filter((hostname) => hostname !== '');
  if (hostnames.length === 0) {
    throw new EgressProxyConfigError('EGRESS_ALLOWED_HOSTS must list at least one hostname');
  }
  const invalidHostnames = hostnames.filter(
    (hostname) => !HOSTNAME_PATTERN.test(hostname) || isIP(hostname) !== 0,
  );
  if (invalidHostnames.length > 0) {
    throw new EgressProxyConfigError(
      `EGRESS_ALLOWED_HOSTS has invalid hostnames: ${invalidHostnames.join(', ')}`,
    );
  }
  return new Set(hostnames);
}

/**
 * Parses the target of a `CONNECT` request.
 *
 * @param target - The request target, e.g. `api.openai.com:443`.
 * @returns The host and port, or undefined if it is not `host:port`.
 */
export function parseConnectTarget(target: string): ConnectTarget | undefined {
  const match = /^([^:\s[\]]+):(\d{1,5})$/.exec(target);
  if (match === null) {
    return undefined;
  }
  const [, host = '', portText = ''] = match;
  const port = Number(portText);
  return port >= 1 && port <= 65_535 ? { host: host.toLowerCase(), port } : undefined;
}

/**
 * Decides whether a tunnel target is allowed, before any DNS lookup.
 *
 * @param target - The raw `CONNECT` target.
 * @param allowedHosts - Exact hostnames that may be reached.
 * @param allowedPort - The only permitted port.
 * @returns The parsed target, or the reason it was refused.
 */
export function checkConnectTarget(
  target: string,
  allowedHosts: ReadonlySet<string>,
  allowedPort: number,
): { target: ConnectTarget } | { denialReason: DenialReason } {
  const parsedTarget = parseConnectTarget(target);
  if (parsedTarget === undefined || isIP(parsedTarget.host) !== 0) {
    return { denialReason: DENIAL_REASONS.MALFORMED_TARGET };
  }
  if (parsedTarget.port !== allowedPort) {
    return { denialReason: DENIAL_REASONS.PORT_NOT_ALLOWED };
  }
  if (!allowedHosts.has(parsedTarget.host)) {
    return { denialReason: DENIAL_REASONS.HOST_NOT_ALLOWED };
  }
  return { target: parsedTarget };
}

/**
 * Builds the set of address ranges tunnels may not reach.
 *
 * @returns A block list of private, loopback and link-local ranges.
 */
function createPrivateAddressBlockList(): BlockList {
  const blockList = new BlockList();
  for (const [network, prefix, family] of PRIVATE_ADDRESS_RANGES) {
    blockList.addSubnet(network, prefix, family);
  }
  return blockList;
}

const PRIVATE_ADDRESS_BLOCK_LIST = createPrivateAddressBlockList();

/**
 * Reports whether an IP address is private, loopback or link-local.
 *
 * Checked after DNS resolution, so an allowed hostname that resolves to an
 * internal address (for example through DNS rebinding) is still refused.
 *
 * @param address - An IPv4 or IPv6 address.
 * @returns `true` if tunnels must not connect to it.
 */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address) === 6 ? 'ipv6' : 'ipv4';
  return PRIVATE_ADDRESS_BLOCK_LIST.check(address, family);
}

/** Writes a refusal to the client and closes its socket. */
function refuseTunnel(clientSocket: Duplex, response: string): void {
  clientSocket.end(response);
}

/** Copies bytes both ways until either side closes or goes idle. */
function spliceSockets(clientSocket: Duplex, upstreamSocket: Socket, head: Buffer): void {
  upstreamSocket.setTimeout(TUNNEL_IDLE_TIMEOUT_MS, () => upstreamSocket.destroy());
  if (head.length > 0) {
    upstreamSocket.write(head);
  }
  clientSocket.pipe(upstreamSocket);
  upstreamSocket.pipe(clientSocket);
  clientSocket.on('error', () => upstreamSocket.destroy());
  upstreamSocket.on('error', () => clientSocket.destroy());
  clientSocket.on('close', () => upstreamSocket.destroy());
  upstreamSocket.on('close', () => clientSocket.destroy());
}

/**
 * Creates the proxy server. It is not listening yet.
 *
 * @param options - Allowlist and logger.
 * @returns An HTTP server that handles `CONNECT` and refuses everything else.
 *
 * @example
 * ```ts
 * const proxy = createEgressProxy({ allowedHosts: new Set(['api.openai.com']), log });
 * proxy.listen(3128);
 * ```
 */
export function createEgressProxy(options: EgressProxyOptions): Server {
  const allowedPort = options.allowedPort ?? HTTPS_PORT;
  const isPrivateAddressAllowed = options.isPrivateAddressAllowed ?? false;
  const { allowedHosts, log } = options;

  async function openTunnel(
    request: IncomingMessage,
    clientSocket: Duplex,
    head: Buffer,
  ): Promise<void> {
    const rawTarget = request.url ?? '';
    const checkResult = checkConnectTarget(rawTarget, allowedHosts, allowedPort);
    if ('denialReason' in checkResult) {
      log({ event: 'tunnel_denied', target: rawTarget, reason: checkResult.denialReason });
      refuseTunnel(clientSocket, TUNNEL_RESPONSES.FORBIDDEN);
      return;
    }
    const { host, port } = checkResult.target;
    const { address } = await lookup(host);
    if (!isPrivateAddressAllowed && isPrivateAddress(address)) {
      log({ event: 'tunnel_denied', target: rawTarget, reason: DENIAL_REASONS.PRIVATE_ADDRESS });
      refuseTunnel(clientSocket, TUNNEL_RESPONSES.FORBIDDEN);
      return;
    }

    const upstreamSocket = connect({ host: address, port, timeout: UPSTREAM_CONNECT_TIMEOUT_MS });
    upstreamSocket.once('timeout', () => upstreamSocket.destroy(new Error('connect timeout')));
    upstreamSocket.once('error', (error) => {
      log({ event: 'tunnel_failed', target: rawTarget, error: error.message });
      refuseTunnel(clientSocket, TUNNEL_RESPONSES.BAD_GATEWAY);
    });
    upstreamSocket.once('connect', () => {
      upstreamSocket.setTimeout(0);
      log({ event: 'tunnel_opened', target: rawTarget });
      clientSocket.write(TUNNEL_RESPONSES.ESTABLISHED);
      spliceSockets(clientSocket, upstreamSocket, head);
    });
  }

  const server = createServer((_request: IncomingMessage, response: ServerResponse) => {
    // Plain HTTP would let the proxy see and forward request bodies; only
    // opaque HTTPS tunnels are offered.
    response.writeHead(405, { 'Content-Type': 'text/plain', Connection: 'close' });
    response.end('Only HTTPS CONNECT tunnels are allowed\n');
  });

  server.on('connect', (request: IncomingMessage, clientSocket: Duplex, head: Buffer) => {
    clientSocket.on('error', () => clientSocket.destroy());
    openTunnel(request, clientSocket, head).catch((error: unknown) => {
      log({
        event: 'tunnel_failed',
        target: request.url ?? '',
        error: error instanceof Error ? error.message : String(error),
      });
      refuseTunnel(clientSocket, TUNNEL_RESPONSES.BAD_GATEWAY);
    });
  });

  return server;
}

/** Writes a log entry as one JSON line on stdout. */
function writeLogLine(entry: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`);
}

/** Reads configuration from the environment and starts listening. */
function startEgressProxy(): void {
  const allowedHosts = parseAllowedHosts(process.env.EGRESS_ALLOWED_HOSTS);
  const listenPort = Number(process.env.EGRESS_PROXY_PORT ?? DEFAULT_LISTEN_PORT);
  const server = createEgressProxy({ allowedHosts, log: writeLogLine });
  server.listen(listenPort, () => {
    writeLogLine({ event: 'listening', port: listenPort, allowedHosts: [...allowedHosts] });
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      server.close();
      server.closeAllConnections();
    });
  }
}

if (import.meta.main) {
  try {
    startEgressProxy();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
