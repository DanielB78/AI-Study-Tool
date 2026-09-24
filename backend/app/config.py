from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Backend configuration loaded from environment variables / .env."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    openai_base_url: str = "https://api.openai.com/v1"
    llm_timeout_seconds: float = 60.0
    # "openai" (default) or "mock" for local UI testing without a paid key.
    llm_provider: str = "openai"
    # Comma-separated origins for local Vite / future web clients.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def has_openai_api_key(self) -> bool:
        return bool(self.openai_api_key.strip())

    @property
    def is_mock_provider(self) -> bool:
        return self.llm_provider.strip().lower() == "mock"

@lru_cache
def get_settings() -> Settings:
    return Settings()
