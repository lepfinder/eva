/// <reference types="vite/client" />

declare global {
  interface Window {
    api: any
  }
}

declare module '*.vrm' {
  const src: string
  export default src
}

export {}
