/**
 * Cross-site request forgery (CSRF) protection for state-changing requests.
 *
 * The session cookie is already `SameSite=Strict`. As a second layer, every
 * request that can change state (anything but GET, HEAD and OPTIONS) must:
 *
 * 1. Come from an allowed browser origin, per the `Origin` header (or
 *    `Referer` when a browser omits `Origin`). Requests with neither are
 *    refused.
 * 2. Send its body as JSON. HTML forms cannot send `application/json`
 *    without a CORS preflight, which this API never approves.
 *
 * See D-018 in docs/decisions.md.
 */
import type { Request, RequestHandler } from 'express';
import { ForbiddenError, UnsupportedMediaTypeError } from '../errors/app-errors.js';

const SAFE_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const JSON_CONTENT_TYPE = 'application/json';

function findRequestOrigin(request: Request): string | undefined {
  const originHeader = request.get('origin');
  if (originHeader !== undefined) {
    return originHeader;
  }
  const refererHeader = request.get('referer');
  if (refererHeader === undefined) {
    return undefined;
  }
  try {
    return new URL(refererHeader).origin;
  } catch {
    return undefined;
  }
}

function hasRequestBody(request: Request): boolean {
  const contentLength = Number(request.get('content-length') ?? '0');
  return contentLength > 0 || request.get('transfer-encoding') !== undefined;
}

/**
 * Creates the CSRF protection middleware.
 *
 * @param allowedOrigins - Origins the web app is served from, e.g. `https://dashboard.lab.example`.
 * @returns Express middleware.
 * @throws {ForbiddenError} (via `next`) For a missing or disallowed origin.
 * @throws {UnsupportedMediaTypeError} (via `next`) For a non-JSON body.
 */
export function createCrossSiteRequestProtection(
  allowedOrigins: readonly string[],
): RequestHandler {
  const allowedOriginSet = new Set(allowedOrigins);

  return (request, _response, next) => {
    if (SAFE_HTTP_METHODS.has(request.method)) {
      next();
      return;
    }

    const requestOrigin = findRequestOrigin(request);
    if (requestOrigin === undefined || !allowedOriginSet.has(requestOrigin)) {
      throw new ForbiddenError('Cross-origin request blocked');
    }
    if (hasRequestBody(request) && !request.is(JSON_CONTENT_TYPE)) {
      throw new UnsupportedMediaTypeError();
    }
    next();
  };
}
