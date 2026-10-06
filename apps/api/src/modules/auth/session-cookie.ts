/**
 * Reading and writing the session cookie.
 *
 * The cookie is HttpOnly (scripts can't read it), SameSite=Strict (never
 * sent on cross-site requests) and path `/`. In production it is also Secure
 * and uses the `__Host-` name prefix, which makes browsers refuse it unless
 * it is Secure, has no Domain and has path `/`. That stops a sibling
 * subdomain from setting or overriding it.
 */
import type { Request, Response } from 'express';

const COOKIE_BASE_NAME = 'agent_dashboard_session';
const SECURE_COOKIE_PREFIX = '__Host-';
const COOKIE_PATH = '/';

/** How the session cookie is issued. */
export interface SessionCookieSettings {
  /** True in production, where the app is served over HTTPS. */
  isSecure: boolean;
}

/**
 * Returns the cookie name for the current settings.
 *
 * @param settings - Cookie settings.
 * @returns `__Host-agent_dashboard_session` when secure, otherwise `agent_dashboard_session`.
 */
export function getSessionCookieName(settings: SessionCookieSettings): string {
  return settings.isSecure ? `${SECURE_COOKIE_PREFIX}${COOKIE_BASE_NAME}` : COOKIE_BASE_NAME;
}

/**
 * Finds one cookie's value in a `Cookie` header without a parsing library.
 *
 * @param cookieHeader - The raw header, e.g. `a=1; b=2`.
 * @param cookieName - The cookie to find.
 * @returns The decoded value, or undefined if absent or malformed.
 */
export function readCookieValue(
  cookieHeader: string | undefined,
  cookieName: string,
): string | undefined {
  if (cookieHeader === undefined) {
    return undefined;
  }
  for (const pair of cookieHeader.split(';')) {
    const separatorIndex = pair.indexOf('=');
    if (separatorIndex !== -1 && pair.slice(0, separatorIndex).trim() === cookieName) {
      try {
        return decodeURIComponent(pair.slice(separatorIndex + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/**
 * Reads the session token from the request's cookies.
 *
 * @param request - The current request.
 * @param settings - Cookie settings.
 * @returns The raw session token, if present.
 */
export function readSessionToken(
  request: Request,
  settings: SessionCookieSettings,
): string | undefined {
  return readCookieValue(request.get('cookie'), getSessionCookieName(settings));
}

/**
 * Sends the session cookie.
 *
 * @param response - The current response.
 * @param sessionToken - The raw token.
 * @param expiresAt - The session's absolute expiry.
 * @param settings - Cookie settings.
 */
export function setSessionCookie(
  response: Response,
  sessionToken: string,
  expiresAt: Date,
  settings: SessionCookieSettings,
): void {
  response.cookie(getSessionCookieName(settings), sessionToken, {
    httpOnly: true,
    secure: settings.isSecure,
    sameSite: 'strict',
    path: COOKIE_PATH,
    expires: expiresAt,
  });
}

/**
 * Tells the browser to delete the session cookie.
 *
 * @param response - The current response.
 * @param settings - Cookie settings.
 */
export function clearSessionCookie(response: Response, settings: SessionCookieSettings): void {
  response.clearCookie(getSessionCookieName(settings), {
    httpOnly: true,
    secure: settings.isSecure,
    sameSite: 'strict',
    path: COOKIE_PATH,
  });
}
