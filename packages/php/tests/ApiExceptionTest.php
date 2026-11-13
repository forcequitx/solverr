<?php

declare(strict_types=1);

namespace Solverr\Tests;

use PHPUnit\Framework\TestCase;
use Solverr\Exception\ApiException;

final class ApiExceptionTest extends TestCase
{
    public function testKeepsEveryFieldAndTheMessage(): void
    {
        $error = new ApiException(429, 'rate_limited', 'Slow down.', 'amount', 'too_many', 7);
        self::assertSame(
            [429, 'rate_limited', 'Slow down.', 'amount', 'too_many', 7],
            [$error->status, $error->type, $error->getMessage(), $error->param, $error->errorCode, $error->retryAfter],
        );
        self::assertInstanceOf(\RuntimeException::class, $error);
    }

    public function testOptionalFieldsDefaultToNull(): void
    {
        $error = new ApiException(0, 'connection_error', 'Could not reach Solverr.');
        self::assertSame([null, null, null], [$error->param, $error->errorCode, $error->retryAfter]);
    }
}
