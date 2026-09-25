from fastapi import APIRouter, Depends

from ..llm.service import LLMService, get_llm_service
from ..models.chat import ChatRequest, ChatResponse

router = APIRouter(prefix="/api", tags=["chat"])


@router.post(
    "/chat",
    response_model=ChatResponse,
    responses={
        422: {"description": "Invalid request"},
        429: {"description": "Rate limited"},
        502: {"description": "Provider error"},
        503: {"description": "Not configured"},
        504: {"description": "Timeout"},
    },
)
async def chat(
    body: ChatRequest,
    llm: LLMService = Depends(get_llm_service),
) -> ChatResponse:
    # `prompt` is already stripped/validated by ChatRequest.
    text = await llm.generate(
        body.prompt,
        system_instruction=body.system_instruction,
        canvas_context=body.canvas_context,
    )
    return ChatResponse(text=text)
