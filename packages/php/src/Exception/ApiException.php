<?php

declare(strict_types=1);

namespace Solverr\Exception;

/** An error returned by the Solverr API, or a request that never got a response (status 0). */
final class ApiException extends \RuntimeException
{
    public function __construct(
        public readonly int $status,
        public readonly string $type,
        string $message,
        public readonly ?string $param = null,
        /** Finer reason inside the type, such as `invoice_paid`, when the API sends one (the API's `code` field). */
        public readonly ?string $errorCode = null,
        /** Seconds the API asked to wait before trying again (its `Retry-After` header), such as on a 429. */
        public readonly ?int $retryAfter = null,
    ) {
        parent::__construct($message);
    }
}
