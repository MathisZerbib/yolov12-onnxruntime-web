declare module '*.mjs' {
  import type { PluginOption } from 'vite';
  export function envWriterPlugin(options?: { envFile?: string }): PluginOption;
  const value: unknown;
  export default value;
}
