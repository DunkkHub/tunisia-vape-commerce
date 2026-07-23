/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_STOREFRONT_DESIGN_PREVIEW?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
