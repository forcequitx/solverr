<?php

declare(strict_types=1);

namespace Solverr\Resource;

use Solverr\HttpClient;

final class Subscriptions
{
    public function __construct(private readonly HttpClient $http)
    {
    }

    /** @param array{customer_email: string, amount: string, currency: string, interval: string, description?: string} $params Invoices every `interval` ("week" or "month").
        @param array{idempotency_key?: string} $options */
    public function create(array $params, array $options = []): array
    {
        return $this->http->request('POST', '/api/v1/subscriptions', body: $params, idempotencyKey: $options['idempotency_key'] ?? null);
    }

    /** @param array{limit?: int, starting_after?: string} $params
        @return array{object: string, data: list<array<string, mixed>>, has_more: bool} */
    public function list(array $params = []): array
    {
        return $this->http->request('GET', '/api/v1/subscriptions', query: $params);
    }

    /** Cancels a subscription and returns it with status `canceled`; invoices already sent stay payable.
        @return array<string, mixed> */
    public function cancel(string $id): array
    {
        return $this->http->request('DELETE', '/api/v1/subscriptions/' . HttpClient::pathSegment($id));
    }
}
