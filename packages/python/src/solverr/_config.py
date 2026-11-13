SDK_VERSION = "0.1.1"

BASE_URL_ENV = "SOLVERR_URL"

# Hosts that may serve the API over plain http, for local development; every other host needs https.
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})

# Socket timeout for connecting and for each read; reading the body also stops once this many seconds have passed since the attempt began.
REQUEST_TIMEOUT_SECONDS = 15.0

# Largest piece of a response body read at once, between checks of the request deadline.
READ_CHUNK_BYTES = 65536

# Extra attempts after a network error or a 5xx response.
MAX_RETRIES = 2

# Delay before the first retry; each later retry doubles it.
RETRY_BASE_DELAY_SECONDS = 0.5

# Extra attempts after a 429, or a 409 for a key that is still being processed, each after its Retry-After wait.
MAX_RETRY_AFTER_RETRIES = 3

# Longest Retry-After the client waits for; a longer one is raised as an error.
MAX_RETRY_AFTER_SECONDS = 10

WEBHOOK_TOLERANCE_SECONDS = 300

# Standard Webhooks headers (standardwebhooks.com), lowercase for lookups.
WEBHOOK_ID_HEADER = "webhook-id"

WEBHOOK_TIMESTAMP_HEADER = "webhook-timestamp"

WEBHOOK_SIGNATURE_HEADER = "webhook-signature"

WEBHOOK_SECRET_PREFIX = "whsec_"

# Shortest signing key accepted after decoding; Standard Webhooks secrets are 24 to 64 bytes.
WEBHOOK_SECRET_MIN_BYTES = 24
