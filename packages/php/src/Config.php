<?php

declare(strict_types=1);

namespace Solverr;

/** Fixed settings shared by the client and webhook verification. */
final class Config
{
    public const SDK_VERSION = '0.1.0';

    public const BASE_URL_ENV = 'SOLVERR_URL';

    /** Hosts that may serve the API over plain http, for local development; every other host needs https. */
    public const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

    public const REQUEST_TIMEOUT_MS = 15_000;

    /** Extra attempts after a network error or a 5xx response. */
    public const MAX_RETRIES = 2;

    /** Delay before the first retry; each later retry doubles it. */
    public const RETRY_BASE_DELAY_MS = 500;

    /** Extra attempts after a 429, or a 409 for a key that is still being processed, each after its Retry-After wait. */
    public const MAX_RETRY_AFTER_RETRIES = 3;

    /** Longest Retry-After the client waits for; a longer one is thrown as an error. */
    public const MAX_RETRY_AFTER_SECONDS = 10;

    public const WEBHOOK_TOLERANCE_SECONDS = 300;

    /** Standard Webhooks headers (standardwebhooks.com), lowercase for lookups. */
    public const WEBHOOK_ID_HEADER = 'webhook-id';

    public const WEBHOOK_TIMESTAMP_HEADER = 'webhook-timestamp';

    public const WEBHOOK_SIGNATURE_HEADER = 'webhook-signature';

    public const WEBHOOK_SECRET_PREFIX = 'whsec_';

    /** Shortest signing key accepted after decoding; Standard Webhooks secrets are 24 to 64 bytes. */
    public const WEBHOOK_SECRET_MIN_BYTES = 24;

    private function __construct()
    {
    }
}
