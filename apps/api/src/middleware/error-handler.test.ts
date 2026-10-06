/**
 * Unit tests for the central error handler and the 404 handler.
 */
import express from 'express';
import type { Express } from 'express';
import request from 'supertest';
import type { ErrorResponseBody } from './error-handler.js';
import { describe, expect, it } from 'vitest';
import { NotFoundError, ValidationError } from '../errors/app-errors.js';
import { createLogger } from '../logger.js';
import { createErrorHandler, createNotFoundHandler } from './error-handler.js';

/** Builds a tiny app whose routes throw specific errors. */
function createAppWithFailingRoutes(): Express {
  const app = express();
  app.use(express.json({ limit: '1kb' }));

  app.get('/not-found', () => {
    throw new NotFoundError('Agent not found');
  });
  app.get('/invalid', () => {
    throw new ValidationError([{ path: 'name', message: 'Required' }]);
  });
  app.get('/crash', () => {
    throw new Error('connection string postgres://user:hunter2@db leaked');
  });
  app.get('/async-crash', () => Promise.reject(new Error('async failure')));
  app.post('/echo', (httpRequest, response) => {
    response.json(httpRequest.body);
  });

  app.use(createNotFoundHandler());
  app.use(createErrorHandler(createLogger('silent')));
  return app;
}

describe('createErrorHandler', () => {
  const app = createAppWithFailingRoutes();

  it('returns an AppError with its own status, code and message', async () => {
    const response = await request(app).get('/not-found');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: 'not_found', message: 'Agent not found' } });
  });

  it('includes field problems for validation errors', async () => {
    const response = await request(app).get('/invalid');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: 'validation_failed',
        message: 'Request validation failed',
        fieldProblems: [{ path: 'name', message: 'Required' }],
      },
    });
  });

  it('hides the message of unexpected errors behind a generic 500', async () => {
    const response = await request(app).get('/crash');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { code: 'internal_error', message: 'Internal server error' },
    });
    expect(response.text).not.toContain('hunter2');
  });

  it('catches rejected promises from async routes', async () => {
    const response = await request(app).get('/async-crash');

    expect(response.status).toBe(500);
  });

  it('turns malformed JSON into a 400', async () => {
    const response = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"unterminated":');

    expect(response.status).toBe(400);
    expect((response.body as ErrorResponseBody).error.code).toBe('malformed_request');
  });

  it('turns an oversized body into a 413', async () => {
    const response = await request(app)
      .post('/echo')
      .send({ padding: 'x'.repeat(2048) });

    expect(response.status).toBe(413);
  });
});

describe('createNotFoundHandler', () => {
  it('returns a JSON 404 for unknown routes', async () => {
    const response = await request(createAppWithFailingRoutes()).get('/does-not-exist');

    expect(response.status).toBe(404);
    expect((response.body as ErrorResponseBody).error.code).toBe('not_found');
  });
});
