declare interface ImportMetaEnv {
  readonly [key: string]: string | undefined;
}
declare interface ImportMeta {
  readonly env: ImportMetaEnv;
}
