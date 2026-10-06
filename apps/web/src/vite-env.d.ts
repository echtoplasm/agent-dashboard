/**
 * Types for the environment variables Vite exposes to the web app.
 */
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the API. Unset means same origin. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
