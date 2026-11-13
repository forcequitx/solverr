<?php

declare(strict_types=1);

namespace Solverr;

use Solverr\Exception\WebhookVerificationException;

final class Webhook
{
    private const TIMESTAMP_PATTERN = '/^[0-9]{1,12}$/D';
    private const SIGNATURE_VERSION = 'v1,';

    private function __construct()
    {
    }

    /** @param array<string, string|list<string>> $headers Any key casing (getallheaders(), PSR-7 getHeaders()); pass the raw body exactly as received.
        @return array<string, mixed> The event (id, type, mode, created_at, data); throws WebhookVerificationException on a bad signature or stale timestamp. */
    public static function verify(string $rawBody, array $headers, #[\SensitiveParameter] string $secret, int $tolerance = Config::WEBHOOK_TOLERANCE_SECONDS): array
    {
        if ($tolerance < 0) {
            throw new WebhookVerificationException('tolerance must be a whole number of seconds, 0 or more.');
        }
        if (!str_starts_with($secret, Config::WEBHOOK_SECRET_PREFIX)) {
            throw new WebhookVerificationException('The webhook secret must start with whsec_.');
        }
        $key = self::secretKey($secret);

        $id = self::header($headers, Config::WEBHOOK_ID_HEADER);
        $timestamp = self::header($headers, Config::WEBHOOK_TIMESTAMP_HEADER);
        $signatures = self::header($headers, Config::WEBHOOK_SIGNATURE_HEADER);
        if ($id === null || $id === '' || $timestamp === null || $timestamp === '' || $signatures === null || $signatures === '') {
            throw new WebhookVerificationException('The webhook-id, webhook-timestamp or webhook-signature header is missing.');
        }
        if (preg_match(self::TIMESTAMP_PATTERN, $timestamp) !== 1) {
            throw new WebhookVerificationException('webhook-timestamp must be a unix time in seconds.');
        }

        $expected = base64_encode(hash_hmac('sha256', $id . '.' . $timestamp . '.' . $rawBody, $key, true));
        $matches = false;
        foreach (explode(' ', $signatures) as $entry) {
            if (str_starts_with($entry, self::SIGNATURE_VERSION) && hash_equals($expected, substr($entry, strlen(self::SIGNATURE_VERSION)))) {
                $matches = true;
            }
        }
        if (!$matches) {
            throw new WebhookVerificationException('The webhook signature does not match. Check the webhook secret and pass the raw request body.');
        }

        if (abs(time() - (int) $timestamp) > $tolerance) {
            throw new WebhookVerificationException("The webhook timestamp is more than {$tolerance} seconds from the current time.");
        }

        try {
            /** Decoded as objects first, since an associative array cannot tell a JSON object from a list. */
            $isObject = json_decode($rawBody, false, 512, JSON_THROW_ON_ERROR) instanceof \stdClass;
        } catch (\JsonException) {
            throw new WebhookVerificationException('The webhook body is not valid JSON.');
        }
        if (!$isObject) {
            throw new WebhookVerificationException('The webhook body is not a JSON object.');
        }
        return json_decode($rawBody, true, 512, JSON_THROW_ON_ERROR);
    }

    /** The HMAC key of a `whsec_` secret: the base64 after the prefix, decoded, and long enough to be a real secret. */
    private static function secretKey(#[\SensitiveParameter] string $secret): string
    {
        $encoded = substr($secret, strlen(Config::WEBHOOK_SECRET_PREFIX));
        /** base64_decode() skips whitespace even in strict mode, so the alphabet is checked first. */
        $key = preg_match('/^[A-Za-z0-9+\/]*={0,2}$/D', $encoded) === 1 ? base64_decode($encoded, true) : false;
        if ($key === false || strlen($key) < Config::WEBHOOK_SECRET_MIN_BYTES) {
            throw new WebhookVerificationException('The webhook secret must be whsec_ followed by at least ' . Config::WEBHOOK_SECRET_MIN_BYTES . ' bytes in standard base64.');
        }
        return $key;
    }

    /** Reads a header by lowercase name, accepting a plain string or a list holding one value.
        @param array<string, string|list<string>> $headers */
    private static function header(array $headers, string $name): ?string
    {
        foreach ($headers as $key => $value) {
            if (strtolower((string) $key) !== $name) {
                continue;
            }
            if (is_array($value)) {
                return count($value) === 1 && is_string(reset($value)) ? reset($value) : null;
            }
            return is_string($value) ? $value : null;
        }
        return null;
    }
}
