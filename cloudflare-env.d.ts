declare namespace Cloudflare {
  interface Env {
    DATABASE_URL?: string;
    LIVEKIT_URL?: string;
    LIVEKIT_API_KEY?: string;
    LIVEKIT_API_SECRET?: string;
    RESEND_API_KEY?: string;
    AUTH_EMAIL_FROM?: string;
    ICE_SERVERS_JSON?: string;
  }
}

