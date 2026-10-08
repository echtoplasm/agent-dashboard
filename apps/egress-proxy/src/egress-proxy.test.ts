/**
 * Tests for the egress proxy's allowlist rules and tunnelling.
 */
import { once } from 'node:events';
import { connect, createServer } from 'node:net';
import type { AddressInfo, Server as TcpServer, Socket } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DENIAL_REASONS,
  EgressProxyConfigError,
  checkConnectTarget,
  createEgressProxy,
  isPrivateAddress,
  parseAllowedHosts,
  parseConnectTarget,
} from './egress-proxy.js';

const ALLOWED_HOSTS = new Set(['api.anthropic.com', 'api.openai.com']);

describe('parseAllowedHosts', () => {
  it('splits, trims and lowercases the list', () => {
    expect(parseAllowedHosts(' API.anthropic.com , api.openai.com ,')).toEqual(ALLOWED_HOSTS);
  });

  it('refuses an empty list, so a misconfigured proxy cannot start', () => {
    expect(() => parseAllowedHosts(undefined)).toThrow(EgressProxyConfigError);
    expect(() => parseAllowedHosts(' , ')).toThrow(EgressProxyConfigError);
  });

  it('refuses wildcards, IPs and ports', () => {
    expect(() => parseAllowedHosts('*.openai.com')).toThrow(/invalid hostnames: \*\.openai\.com/);
    expect(() => parseAllowedHosts('10.0.0.1')).toThrow(EgressProxyConfigError);
    expect(() => parseAllowedHosts('api.openai.com:443')).toThrow(EgressProxyConfigError);
  });
});

describe('parseConnectTarget', () => {
  it('parses host:port', () => {
    expect(parseConnectTarget('API.OpenAI.com:443')).toEqual({ host: 'api.openai.com', port: 443 });
  });

  it.each(['api.openai.com', '[::1]:443', 'api.openai.com:0', 'api.openai.com:70000', ':443'])(
    'rejects %s',
    (target) => {
      expect(parseConnectTarget(target)).toBeUndefined();
    },
  );
});

describe('checkConnectTarget', () => {
  it('allows an exact allowlisted host on 443', () => {
    expect(checkConnectTarget('api.openai.com:443', ALLOWED_HOSTS, 443)).toEqual({
      target: { host: 'api.openai.com', port: 443 },
    });
  });

  it.each([
    ['evil.example.com:443', DENIAL_REASONS.HOST_NOT_ALLOWED],
    ['sub.api.openai.com:443', DENIAL_REASONS.HOST_NOT_ALLOWED],
    ['api.openai.com:22', DENIAL_REASONS.PORT_NOT_ALLOWED],
    ['10.0.0.1:443', DENIAL_REASONS.MALFORMED_TARGET],
    ['not a target', DENIAL_REASONS.MALFORMED_TARGET],
  ])('refuses %s (%s)', (target, denialReason) => {
    expect(checkConnectTarget(target, ALLOWED_HOSTS, 443)).toEqual({ denialReason });
  });
});

describe('isPrivateAddress', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.17.0.1', '192.168.1.10', '169.254.169.254', '::1'])(
    'treats %s as private',
    (address) => {
      expect(isPrivateAddress(address)).toBe(true);
    },
  );

  it.each(['160.79.104.10', '2606:4700::6810:84e5'])('treats %s as public', (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});

describe('createEgressProxy', () => {
  const serversToClose: (Server | TcpServer)[] = [];
  const openSockets = new Set<Socket>();

  afterEach(async () => {
    for (const socket of openSockets) {
      socket.destroy();
    }
    openSockets.clear();
    await Promise.all(
      serversToClose.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => {
              resolve();
            });
          }),
      ),
    );
  });

  /** Listens on every interface, so `localhost` works whether it resolves to IPv4 or IPv6. */
  async function listenOnRandomPort(server: Server | TcpServer): Promise<number> {
    serversToClose.push(server);
    server.on('connection', (socket: Socket) => openSockets.add(socket));
    server.listen(0);
    await once(server, 'listening');
    return (server.address() as AddressInfo).port;
  }

  /** An upstream that echoes whatever it receives. */
  async function startEchoServer(): Promise<number> {
    const echoServer = createServer((socket) => socket.pipe(socket));
    return listenOnRandomPort(echoServer);
  }

  async function sendConnect(
    proxyPort: number,
    target: string,
  ): Promise<{ socket: Socket; statusLine: string }> {
    const socket = connect(proxyPort, '127.0.0.1');
    await once(socket, 'connect');
    socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
    const [chunk] = (await once(socket, 'data')) as [Buffer];
    return { socket, statusLine: chunk.toString('utf8').split('\r\n')[0] ?? '' };
  }

  it('tunnels bytes to an allowed host', async () => {
    const echoPort = await startEchoServer();
    const logEntries: Record<string, unknown>[] = [];
    const proxyPort = await listenOnRandomPort(
      createEgressProxy({
        allowedHosts: new Set(['localhost']),
        allowedPort: echoPort,
        isPrivateAddressAllowed: true,
        log: (entry) => logEntries.push(entry),
      }),
    );

    const { socket, statusLine } = await sendConnect(proxyPort, `localhost:${echoPort}`);
    socket.write('ping');
    const [echoed] = (await once(socket, 'data')) as [Buffer];
    socket.destroy();

    expect(statusLine).toBe('HTTP/1.1 200 Connection Established');
    expect(echoed.toString('utf8')).toBe('ping');
    expect(logEntries).toContainEqual({ event: 'tunnel_opened', target: `localhost:${echoPort}` });
  });

  it('refuses an allowed hostname that resolves to a private address', async () => {
    const echoPort = await startEchoServer();
    const logEntries: Record<string, unknown>[] = [];
    const proxyPort = await listenOnRandomPort(
      createEgressProxy({
        allowedHosts: new Set(['localhost']),
        allowedPort: echoPort,
        log: (entry) => logEntries.push(entry),
      }),
    );

    const { socket, statusLine } = await sendConnect(proxyPort, `localhost:${echoPort}`);
    socket.destroy();

    expect(statusLine).toBe('HTTP/1.1 403 Forbidden');
    expect(logEntries[0]).toMatchObject({ reason: DENIAL_REASONS.PRIVATE_ADDRESS });
  });

  it('refuses hosts outside the allowlist without connecting anywhere', async () => {
    const proxyPort = await listenOnRandomPort(
      createEgressProxy({ allowedHosts: ALLOWED_HOSTS, log: () => undefined }),
    );

    const { socket, statusLine } = await sendConnect(proxyPort, 'example.com:443');
    socket.destroy();

    expect(statusLine).toBe('HTTP/1.1 403 Forbidden');
  });

  it('refuses plain HTTP proxying', async () => {
    const proxyPort = await listenOnRandomPort(
      createEgressProxy({ allowedHosts: ALLOWED_HOSTS, log: () => undefined }),
    );

    const response = await fetch(`http://127.0.0.1:${proxyPort}/`);

    expect(response.status).toBe(405);
  });
});
