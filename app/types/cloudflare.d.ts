interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

// The concrete methods are supplied by the Cloudflare runtime.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface D1Database {}

declare module "cloudflare:workers" {
  export const env: { DB?: D1Database };
}
