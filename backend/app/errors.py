from fastapi import Request
from fastapi.responses import JSONResponse


class AiServiceError(Exception):
    """Safe, user-facing AI failure with optional internal detail for logs."""

    def __init__(
        self,
        message: str = "AI request failed. Please try again.",
        *,
        code: str = "ai_error",
        status_code: int = 502,
        detail: str | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.detail = detail


async def ai_service_error_handler(_request: Request, exc: AiServiceError) -> JSONResponse:
    if exc.detail:
        print(f"[ai] {exc.code}: {exc.detail}")
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": exc.code,
                "message": exc.message,
            }
        },
    )
