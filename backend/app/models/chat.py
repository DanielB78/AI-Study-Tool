from pydantic import BaseModel, Field, field_validator


class ChatRequest(BaseModel):
    """Client → backend chat payload.

    Intentionally minimal for v1. Later fields (boardId, selectedElementIds,
    context, …) can be added as optional without breaking existing clients.
    """

    prompt: str = Field(..., min_length=1, max_length=32_000)

    @field_validator("prompt")
    @classmethod
    def prompt_must_not_be_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("prompt must not be empty")
        return cleaned


class ChatResponse(BaseModel):
    """Backend → client plain-text response."""

    text: str


class ErrorBody(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorBody
