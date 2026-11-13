<?php

declare(strict_types=1);

namespace Solverr;

use Solverr\Exception\ApiException;

/** Sends authenticated JSON requests, retrying network errors and 5xx responses, and 429s or in-progress 409s after a short Retry-After.
    @internal Used by the resource classes; call the API through {@see Client}. */
final class HttpClient
{
    public function __construct(
        #[\SensitiveParameter] private readonly string $apiKey,
        private readonly string $baseUrl,
    ) {
    }

    /** @param array<string, mixed>|null $body Query values are array<string, string|int|null>.
        @return array<string, mixed> */
    public function request(string $method, string $path, array $query = [], ?array $body = null, ?string $idempotencyKey = null): array
    {
        $url = $this->url($path, $query);
        $headers = [
            'Accept: application/json',
            'Authorization: Bearer ' . $this->apiKey,
            'User-Agent: solverr-php/' . Config::SDK_VERSION,
        ];
        $payload = null;
        if ($method === 'POST') {
            /** curl drops a header with an empty value and would send line breaks as extra headers, so such keys are refused. */
            if ($idempotencyKey !== null && ($idempotencyKey === '' || preg_match('/[\r\n\0]/', $idempotencyKey) === 1)) {
                throw new \InvalidArgumentException('idempotency_key must not be empty or contain line breaks or NUL characters.');
            }
            /** The same key is sent on every retry, so the server never applies a POST twice. */
            $headers[] = 'Idempotency-Key: ' . ($idempotencyKey ?? self::uuid());
            $payload = '';
            if ($body !== null) {
                $headers[] = 'Content-Type: application/json';
                $payload = self::encodeJson($body);
            } else {
                /** An empty value stops curl from adding its form content type to a POST without a body. */
                $headers[] = 'Content-Type:';
            }
        }

        $attempt = 0;
        $retryAfterRetries = 0;
        while (true) {
            $canRetry = $attempt < Config::MAX_RETRIES;
            [$status, $text, $retryAfter, $networkError, $location] = $this->send($method, $url, $headers, $payload);

            if ($networkError !== null) {
                if ($canRetry) {
                    self::waitBeforeRetry($attempt++);
                    continue;
                }
                throw new ApiException(0, 'connection_error', "Could not reach Solverr at {$this->baseUrl}: {$networkError}");
            }

            if ($status >= 300 && $status < 400) {
                $target = $location !== null ? " to {$location}" : '';
                throw new ApiException($status, 'api_error', "Solverr answered with a redirect{$target}. Set base_url to the address Solverr is served from.");
            }
            if ($status >= 500 && $canRetry) {
                self::waitBeforeRetry($attempt++);
                continue;
            }
            $decoded = self::decodeJson($text);
            $delay = $retryAfterRetries < Config::MAX_RETRY_AFTER_RETRIES ? self::retryAfterDelay($status, $retryAfter, $decoded) : null;
            if ($delay !== null) {
                sleep($delay);
                $retryAfterRetries++;
                continue;
            }
            if ($status < 200 || $status >= 300) {
                throw self::toApiException($status, $decoded, $retryAfter);
            }
            if ($decoded === null) {
                throw new ApiException($status, 'api_error', 'Solverr returned a response that is not JSON.');
            }
            return $decoded;
        }
    }

    /** An id as one URL path segment; empty, `.` and `..` are refused because the URL would point at another path. */
    public static function pathSegment(string $id): string
    {
        if ($id === '' || $id === '.' || $id === '..') {
            throw new \InvalidArgumentException(json_encode($id) . ' is not a valid id.');
        }
        return rawurlencode($id);
    }

    /** @param list<string> $headers One HTTP attempt; the timeout covers the whole exchange.
        @return array{0: int, 1: string, 2: ?string, 3: ?string, 4: ?string} Status, body, Retry-After, network error or null, Location. */
    private function send(string $method, string $url, array $headers, ?string $payload): array
    {
        $handle = curl_init($url);
        if ($handle === false) {
            return [0, '', null, 'curl_init failed', null];
        }
        $retryAfter = null;
        $location = null;
        curl_setopt_array($handle, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_TIMEOUT_MS => Config::REQUEST_TIMEOUT_MS,
            CURLOPT_HEADERFUNCTION => static function (\CurlHandle $handle, string $line) use (&$retryAfter, &$location): int {
                if (stripos($line, 'retry-after:') === 0) {
                    $retryAfter = trim(substr($line, strlen('retry-after:')));
                } elseif (stripos($line, 'location:') === 0) {
                    $location = trim(substr($line, strlen('location:')));
                }
                return strlen($line);
            },
        ]);
        if ($payload !== null) {
            curl_setopt($handle, CURLOPT_POSTFIELDS, $payload);
        }

        $text = curl_exec($handle);
        if ($text === false) {
            return [0, '', null, curl_error($handle), null];
        }
        return [(int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE), (string) $text, $retryAfter, null, $location];
    }

    /** @param array<string, string|int|null> $query */
    private function url(string $path, array $query): string
    {
        $url = $this->baseUrl . $path;
        $queryString = http_build_query($query, '', '&', PHP_QUERY_RFC3986);
        return $queryString === '' ? $url : $url . '?' . $queryString;
    }

    /** @param array<string, mixed>|null $payload */
    private static function toApiException(int $status, ?array $payload, ?string $retryAfter): ApiException
    {
        $seconds = self::retryAfterSeconds($retryAfter);
        $error = $payload['error'] ?? null;
        if (is_array($error) && is_string($error['type'] ?? null) && is_string($error['message'] ?? null)) {
            $param = is_string($error['param'] ?? null) ? $error['param'] : null;
            $errorCode = is_string($error['code'] ?? null) ? $error['code'] : null;
            return new ApiException($status, $error['type'], $error['message'], $param, $errorCode, $seconds);
        }
        return new ApiException($status, 'api_error', "Solverr returned HTTP {$status}.", retryAfter: $seconds);
    }

    /** Retry-After in seconds; only the delay-seconds form is read, as the API never sends an HTTP date. */
    private static function retryAfterSeconds(?string $retryAfter): ?int
    {
        return $retryAfter !== null && preg_match('/^\d+$/D', $retryAfter) === 1 ? (int) $retryAfter : null;
    }

    /** Seconds to wait before retrying a 429 or an in-progress Idempotency-Key 409; null when it must not be retried.
        @param array<string, mixed>|null $payload */
    private static function retryAfterDelay(int $status, ?string $retryAfter, ?array $payload): ?int
    {
        $type = is_array($payload['error'] ?? null) ? ($payload['error']['type'] ?? null) : null;
        $retryable = $status === 429 || ($status === 409 && $type === 'idempotency_conflict');
        $seconds = self::retryAfterSeconds($retryAfter);
        if (!$retryable || $seconds === null) {
            return null;
        }
        return $seconds <= Config::MAX_RETRY_AFTER_SECONDS ? $seconds : null;
    }

    /** @param array<string, mixed> $body */
    private static function encodeJson(array $body): string
    {
        /** Fields set to null are left out, because the API refuses null in place of an omitted optional field. */
        $fields = array_filter($body, static fn (mixed $value): bool => $value !== null);
        /** An empty PHP array encodes as "[]"; the API expects a JSON object. */
        if ($fields === []) {
            return '{}';
        }
        return json_encode($fields, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }

    /** @return array<string, mixed>|null */
    private static function decodeJson(string $text): ?array
    {
        if ($text === '') {
            return null;
        }
        try {
            $decoded = json_decode($text, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return null;
        }
        return is_array($decoded) ? $decoded : null;
    }

    /** Exponential backoff with up to 25% random jitter. */
    private static function waitBeforeRetry(int $attempt): void
    {
        $delayMs = Config::RETRY_BASE_DELAY_MS * (2 ** $attempt) * (1 + mt_rand() / mt_getrandmax() / 4);
        usleep((int) ($delayMs * 1000));
    }

    /** A random version 4 UUID. */
    private static function uuid(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
    }
}
