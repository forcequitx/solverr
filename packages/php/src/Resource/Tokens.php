<?php

declare(strict_types=1);

namespace Solverr\Resource;

use Solverr\HttpClient;

final class Tokens
{
    public function __construct(private readonly HttpClient $http)
    {
    }

    /** Lists the coins the checkout accepts, with USD prices, in one response without pages; the API caches the list for 60 seconds.
        @return array{object: string, data: list<array{asset_id: string, symbol: string, blockchain: string, chain_name: string, decimals: int, price_usd: int|float, contract_address: ?string}>} */
    public function list(): array
    {
        return $this->http->request('GET', '/api/v1/tokens');
    }
}
