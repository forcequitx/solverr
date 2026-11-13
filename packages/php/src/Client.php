<?php

declare(strict_types=1);

namespace Solverr;

use Solverr\Resource\Credits;
use Solverr\Resource\Invoices;
use Solverr\Resource\PaymentLinks;
use Solverr\Resource\Payouts;
use Solverr\Resource\Refunds;
use Solverr\Resource\Subscriptions;
use Solverr\Resource\Tokens;
use Solverr\Resource\Webhooks;

final class Client
{
    private const API_KEY_PATTERN = '/^sk_live_[\x21-\x7E]+$/D';

    public readonly Invoices $invoices;
    public readonly PaymentLinks $paymentLinks;
    public readonly Refunds $refunds;
    public readonly Payouts $payouts;
    public readonly Subscriptions $subscriptions;
    public readonly Credits $credits;
    public readonly Tokens $tokens;
    public readonly Webhooks $webhooks;

    /** @param array{api_key: ?string, base_url?: ?string} $config `api_key` is an API key starting with sk_live_;
        `base_url` is the origin of the Solverr app and defaults to the SOLVERR_URL environment variable. */
    public function __construct(#[\SensitiveParameter] array $config)
    {
        $apiKey = $config['api_key'] ?? null;
        if (!is_string($apiKey) || preg_match(self::API_KEY_PATTERN, $apiKey) !== 1) {
            throw new \InvalidArgumentException('api_key must be a Solverr API key starting with sk_live_.');
        }
        /** getenv() gives false for an unset variable; that counts as not given, so SOLVERR_URL or the clear error below applies. */
        $baseUrl = $config['base_url'] ?? null;
        if ($baseUrl !== null && $baseUrl !== false && !is_string($baseUrl)) {
            throw new \InvalidArgumentException('base_url must be a string.');
        }
        $http = new HttpClient($apiKey, self::resolveBaseUrl($baseUrl === false ? null : $baseUrl));
        $this->invoices = new Invoices($http);
        $this->paymentLinks = new PaymentLinks($http);
        $this->refunds = new Refunds($http);
        $this->payouts = new Payouts($http);
        $this->subscriptions = new Subscriptions($http);
        $this->credits = new Credits($http);
        $this->tokens = new Tokens($http);
        $this->webhooks = new Webhooks($http);
    }

    /** Validates the base URL and drops a trailing slash so API paths can be appended. */
    private static function resolveBaseUrl(?string $baseUrl): string
    {
        $value = $baseUrl ?? getenv(Config::BASE_URL_ENV);
        if (!is_string($value) || $value === '') {
            throw new \InvalidArgumentException('Pass base_url to new Solverr\Client() or set the ' . Config::BASE_URL_ENV . ' environment variable.');
        }
        $parts = parse_url($value);
        /** curl refuses whitespace and control characters in a URL, which would otherwise surface as a connection error after every retry. */
        if ($parts === false || !isset($parts['scheme'], $parts['host']) || preg_match('/[\s\x00-\x1f\x7f]/', $value) === 1) {
            throw new \InvalidArgumentException("base_url is not a valid URL: {$value}");
        }
        $scheme = strtolower($parts['scheme']);
        if ($scheme !== 'https' && !($scheme === 'http' && in_array(strtolower($parts['host']), Config::LOCAL_HOSTS, true))) {
            throw new \InvalidArgumentException('base_url must be an https URL (http only for localhost).');
        }
        if (isset($parts['query']) || isset($parts['fragment'])) {
            throw new \InvalidArgumentException('base_url must not have a query string or fragment.');
        }
        return rtrim($value, '/');
    }
}
