from pydantic import BaseModel, Field, field_validator


DEFAULT_RAG_SYSTEM_INSTRUCTION = (
    "You are an AI assistant inside a study canvas application.\n"
    "Use the supplied canvas context when it is relevant.\n"
    "Do not assume the context is exhaustive."
)


class ChatRequest(BaseModel):
    """Client → backend chat payload.

    `prompt` is the user-visible message. Optional `system_instruction` and
    `canvas_context` are trusted request fields for RAG debug / future RAG.
    """

    prompt: str = Field(..., min_length=1, max_length=32_000)
    system_instruction: str | None = Field(default=None, max_length=8_000)
    canvas_context: str | None = Field(default=None, max_length=200_000)

    @field_validator("prompt")
    @classmethod
    def prompt_must_not_be_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("prompt must not be empty")
        return cleaned

    @field_validator("system_instruction", "canvas_context")
    @classmethod
    def empty_optional_to_none(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class ChatResponse(BaseModel):
    """Backend → client plain-text response."""

    text: str


class ErrorBody(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorBody
