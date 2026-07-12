/// <reference types="vite/client" />

declare module '*.mjs' {
  const value: unknown;
  export default value;
  export function envWriterPlugin(options?: { envFile?: string }): unknown;
}

interface ImportMetaEnv {
  readonly BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

