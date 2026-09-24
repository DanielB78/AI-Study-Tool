import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.errors import AiServiceError
from app.llm.base import LLMProvider
from app.llm.service import LLMService, build_llm_service
from app.main import create_app


class FakeProvider(LLMProvider):
    def __init__(self, text: str = "hello", *, error: Exception | None = None) -> None:
        self.text = text
        self.error = error
        self.calls: list[str] = []

    async def generate(self, prompt: str) -> str:
        self.calls.append(prompt)
        if self.error is not None:
            raise self.error
        return self.text


@pytest.fixture
def settings_no_key() -> Settings:
    return Settings(
        openai_api_key="",
        openai_model="gpt-test",
        cors_origins="http://localhost:5173",
    )


def make_client(provider: LLMProvider) -> TestClient:
    app = create_app()
    service = LLMService(provider)

    def override() -> LLMService:
        return service

    from app.llm import service as service_module

    app.dependency_overrides[service_module.get_llm_service] = override
    return TestClient(app)


def test_health_ok() -> None:
    client = TestClient(create_app())
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert "ai_configured" in body
    assert "model" in body


def test_chat_validation_missing_prompt() -> None:
    client = make_client(FakeProvider())
    res = client.post("/api/chat", json={})
    assert res.status_code == 422


def test_chat_validation_empty_prompt() -> None:
    client = make_client(FakeProvider())
    res = client.post("/api/chat", json={"prompt": "   "})
    assert res.status_code == 422


def test_chat_success_mocked_provider() -> None:
    provider = FakeProvider("Faraday's law relates induced EMF to changing flux.")
    client = make_client(provider)
    res = client.post("/api/chat", json={"prompt": "Explain Faraday's law simply"})
    assert res.status_code == 200
    assert res.json() == {
        "text": "Faraday's law relates induced EMF to changing flux.",
    }
    assert provider.calls == ["Explain Faraday's law simply"]


def test_chat_trims_prompt() -> None:
    provider = FakeProvider("ok")
    client = make_client(provider)
    res = client.post("/api/chat", json={"prompt": "  hello  "})
    assert res.status_code == 200
    assert provider.calls == ["hello"]


def test_chat_provider_error_safe_message() -> None:
    provider = FakeProvider(
        error=AiServiceError(
            "AI request failed. Please try again.",
            code="provider_error",
            status_code=502,
            detail="secret stack trace with sk-SECRET",
        )
    )
    client = make_client(provider)
    res = client.post("/api/chat", json={"prompt": "hi"})
    assert res.status_code == 502
    body = res.json()
    assert body["error"]["message"] == "AI request failed. Please try again."
    assert body["error"]["code"] == "provider_error"
    assert "sk-SECRET" not in res.text


def test_chat_mock_provider() -> None:
    settings = Settings(llm_provider="mock", openai_api_key="")
    service = build_llm_service(settings)
    app = create_app()

    def override() -> LLMService:
        return service

    from app.llm import service as service_module

    app.dependency_overrides[service_module.get_llm_service] = override
    client = TestClient(app)
    res = client.post("/api/chat", json={"prompt": "Explain Gauss's law simply"})
    assert res.status_code == 200
    assert "mock AI response" in res.json()["text"]
    assert "Gauss" in res.json()["text"]


def test_chat_missing_api_key_via_real_provider(settings_no_key: Settings) -> None:
    from app.llm.openai_provider import OpenAIProvider

    app = create_app()
    service = LLMService(OpenAIProvider(settings_no_key))

    def override() -> LLMService:
        return service

    from app.llm import service as service_module

    app.dependency_overrides[service_module.get_llm_service] = override
    client = TestClient(app)
    res = client.post("/api/chat", json={"prompt": "hi"})
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "missing_api_key"
    assert "OPENAI_API_KEY" in res.json()["error"]["message"]
