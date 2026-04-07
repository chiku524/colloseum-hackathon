/// <reference types="vite/client" />

declare module '@idl' {
  const idl: { address: string; [key: string]: unknown };
  export default idl;
}

interface ImportMetaEnv {
  readonly VITE_RPC_URL?: string;
  readonly VITE_PROGRAM_ID?: string;
  /** Optional origin for serverless API (e.g. cross-domain). Default: same origin. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
