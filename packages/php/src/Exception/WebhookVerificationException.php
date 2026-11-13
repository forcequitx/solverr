<?php

declare(strict_types=1);

namespace Solverr\Exception;

/** A webhook whose signature, timestamp or body could not be verified. */
final class WebhookVerificationException extends \RuntimeException
{
}
