/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const componente: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default componente;
}

interface ImportMetaEnv {
  /** Prefijo de la API. Por omisión `/api/v1`, mismo origen (ADR-0009 §6.3). */
  readonly VITE_CEIBA_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
