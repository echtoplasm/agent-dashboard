/**
 * Request rate limiting, keyed by client IP.
 *
 * A general limit protects the whole API. Login gets a much stricter limit
 * that counts only failed attempts, to slow down password guessing without
 * locking out someone who signs in successfully. Counters live in memory,
 * which suits a single API instance; a shared store would be needed if the
 * API is ever scaled out.
 */
import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { RateLimitedError } from '../errors/app-errors.js';

const MILLISECONDS_PER_MINUTE = 60 * 1000;

/** Rate limit settings. */
export interface RateLimitSettings {
  /** Requests per client IP per minute across the API. */
  apiRequestsPerMinute: number;
  /** Failed login attempts per client IP per 15 minutes. */
  failedLoginsPerWindow: number;
}

/** Production defaults. */
export const DEFAULT_RATE_LIMIT_SETTINGS: RateLimitSettings = {
  apiRequestsPerMinute: 300,
  failedLoginsPerWindow: 10,
};

const LOGIN_WINDOW_MS = 15 * MILLISECONDS_PER_MINUTE;

const rejectWithRateLimitedError: RequestHandler = (_request, _response, next) => {
  next(new RateLimitedError());
};

/**
 * Creates the API-wide rate limiter.
 *
 * @param settings - Rate limit settings.
 * @returns Express middleware.
 */
export function createApiRateLimiter(settings: RateLimitSettings): RequestHandler {
  return rateLimit({
    windowMs: MILLISECONDS_PER_MINUTE,
    limit: settings.apiRequestsPerMinute,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: rejectWithRateLimitedError,
  });
}

/**
 * Creates the login rate limiter. Successful logins don't count.
 *
 * @param settings - Rate limit settings.
 * @returns Express middleware for the login route.
 */
export function createLoginRateLimiter(settings: RateLimitSettings): RequestHandler {
  return rateLimit({
    windowMs: LOGIN_WINDOW_MS,
    limit: settings.failedLoginsPerWindow,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: rejectWithRateLimitedError,
  });
}
