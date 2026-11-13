<?php

declare(strict_types=1);

namespace Solverr\Resource;

use Solverr\HttpClient;

final class Credits
{
    public function __construct(private readonly HttpClient $http)
    {
    }

    /** @param array{amount: string, currency: 'USD', credit_account_id?: string} $params Without `credit_account_id`, creates a new account and token.
        @return array{credit_account: array<string, mixed>, invoice: array<string, mixed>} Account and funding invoice; the balance is added once it is paid. */
    public function topup(array $params, array $options = []): array
    {
        return $this->http->request('POST', '/api/v1/credits/topup', body: $params, idempotencyKey: $options['idempotency_key'] ?? null);
    }

    /** @param array{token: string, amount: string, currency?: 'USD', description?: string} $params Charges the credit account that owns `token`.
        @return array{id: string, object: string, amount: string, balance: string, currency: string} The charge and the remaining balance. */
    public function charge(array $params, array $options = []): array
    {
        return $this->http->request('POST', '/api/v1/credits/charge', body: $params, idempotencyKey: $options['idempotency_key'] ?? null);
    }

    /** Gives a charge back to its credit account, once; for a request the charge paid for that then failed.
        @return array{id: string, object: string, amount: string, refunded: bool, balance: string, currency: string} */
    public function refundCharge(string $id, array $options = []): array
    {
        return $this->http->request('POST', '/api/v1/credits/charges/' . HttpClient::pathSegment($id) . '/refund', body: [], idempotencyKey: $options['idempotency_key'] ?? null);
    }
}
