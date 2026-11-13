<?php

declare(strict_types=1);

namespace Solverr\Resource;

use Solverr\HttpClient;

final class PaymentLinks
{
    public function __construct(private readonly HttpClient $http)
    {
    }

    /** @param array{title: string, amount?: string, currency: string, redirect_url?: string} $params Leave out `amount` to let the customer choose it.
        @param array{idempotency_key?: string} $options */
    public function create(array $params, array $options = []): array
    {
        return $this->http->request('POST', '/api/v1/payment-links', body: $params, idempotencyKey: $options['idempotency_key'] ?? null);
    }

    /** @param array{limit?: int, starting_after?: string} $params
        @return array{object: string, data: list<array<string, mixed>>, has_more: bool} */
    public function list(array $params = []): array
    {
        return $this->http->request('GET', '/api/v1/payment-links', query: $params);
    }

    /** Turns a link off and returns it with `active` false; invoices already created from it stay payable.
        @return array<string, mixed> */
    public function deactivate(string $id): array
    {
        return $this->http->request('DELETE', '/api/v1/payment-links/' . HttpClient::pathSegment($id));
    }
}
