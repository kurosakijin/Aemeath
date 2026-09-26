declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    ICE_SERVERS_JSON?: string;
    BUCKET?: R2Bucket;
  }
}

