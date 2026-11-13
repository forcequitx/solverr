import { MINUTE_MS } from "@/lib/time";

/** How long a Telegram connect code works: the bot stores it with this lifetime, and the Settings card closes and words the code from it. */
export const CONNECT_CODE_MINUTES = 10;
export const CONNECT_CODE_TTL_MS = CONNECT_CODE_MINUTES * MINUTE_MS;
