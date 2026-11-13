<?php

declare(strict_types=1);

namespace Solverr\Resource;

use Solverr\HttpClient;

final class Webhooks
{
    public function __construct(private readonly HttpClient $http)
    {
    }

    /** Queues a signed `test.ping` event to the business's webhook URL; fails with status 409 when no webhook URL is set.
        @return array{queued: bool} */
    public function sendTest(): array
    {
        return $this->http->request('POST', '/api/v1/webhooks/test');
    }
}
