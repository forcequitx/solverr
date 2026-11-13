from __future__ import annotations


class SolverrError(Exception):
    """An error returned by the Solverr API, or a request that never got a response (``status`` 0)."""

    def __init__(
        self,
        status: int,
        type: str,
        message: str,
        param: str | None = None,
        code: str | None = None,
        retry_after: int | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.type = type
        self.message = message
        self.param = param
        # Finer reason inside ``type``, such as ``invoice_paid``, when the API sends one.
        self.code = code
        # Seconds the API asked to wait before trying again (its ``Retry-After`` header), such as on a 429.
        self.retry_after = retry_after

    def __reduce__(self) -> tuple[type[SolverrError], tuple[int, str, str, str | None, str | None, int | None]]:
        """Rebuilds the error from all its fields, so it survives pickling across processes and ``copy``."""
        return (SolverrError, (self.status, self.type, self.message, self.param, self.code, self.retry_after))

    def __repr__(self) -> str:
        return (
            f"SolverrError(status={self.status!r}, type={self.type!r}, code={self.code!r}, "
            f"message={self.message!r}, param={self.param!r}, retry_after={self.retry_after!r})"
        )


class WebhookVerificationError(Exception):
    """A webhook whose signature, timestamp or body could not be verified."""
