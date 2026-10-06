/**
 * Unit tests for the request logger.
 */
import { Writable } from 'node:stream';
import express, { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../logger.js';
import { createRequestLogger } from './request-logger.js';

interface LoggedRequest {
  method: string;
  path: string;
  statusCode: number;
}

/** Builds an app with a mounted router whose request log lines are captured. */
function createLoggedApp(): { app: express.Express; loggedRequests: LoggedRequest[] } {
  const loggedRequests: LoggedRequest[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback): void {
      loggedRequests.push(JSON.parse(chunk.toString()) as LoggedRequest);
      callback();
    },
  });

  const mountedRouter = Router();
  mountedRouter.get('/status', (_request, response) => {
    response.json({});
  });

  const app = express();
  app.use(createRequestLogger(createLogger('info', destination)));
  app.use('/api/widgets', mountedRouter);
  return { app, loggedRequests };
}

describe('createRequestLogger', () => {
  it('logs the full path of requests handled by mounted routers', async () => {
    const { app, loggedRequests } = createLoggedApp();

    await request(app).get('/api/widgets/status');

    expect(loggedRequests[0]).toMatchObject({
      method: 'GET',
      path: '/api/widgets/status',
      statusCode: 200,
    });
  });

  it('never logs the query string', async () => {
    const { app, loggedRequests } = createLoggedApp();

    await request(app).get('/api/widgets/status?token=secret-value');

    expect(JSON.stringify(loggedRequests)).not.toContain('secret-value');
  });
});
