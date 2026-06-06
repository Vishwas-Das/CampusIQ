from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── App ──
    app_name: str = "CampusIQ API"
    app_version: str = "0.1.0"
    environment: str = "development"
    api_v1_prefix: str = "/api/v1"

    # ── Database ──
    database_url: str = "sqlite:///./campusiq.db"

    # ── Redis (used from Phase 12+) ──
    redis_url: str = "redis://localhost:6379/0"

    # ── Auth ──
    jwt_secret_key: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 days

    # ── Supabase ──
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_storage_bucket: str = "campusiq-documents"

    # ── AI/ML services ──
    anthropic_api_key: str = ""
    anthropic_model_dev: str = "claude-haiku-4-5-20251001"
    anthropic_model_prod: str = "claude-opus-4-6"
    use_production_model: bool = False  # flip to True only for final demo

    openai_api_key: str = ""  # for Whisper
    elevenlabs_api_key: str = ""  # for TTS in voice interviews

    # ── CORS ──
    frontend_url: str = "http://localhost:5173"
    cors_allowed_origins: str = "http://localhost:5173,http://localhost:3000"

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_allowed_origins.split(",") if origin.strip()]

    @property
    def active_anthropic_model(self) -> str:
        """Return Opus only for the single final demo, Haiku for everything else."""
        return self.anthropic_model_prod if self.use_production_model else self.anthropic_model_dev

    # ── Rate limiting (used in Phase 21) ──
    claude_requests_per_minute: int = 20  # per-user limit to prevent runaway costs

    # ── Daily Claude spend cap (lever 5) ──
    # Maximum USD spend per UTC day across ALL Claude calls. When the day's
    # logged spend reaches this number, generate_completion gracefully returns
    # an empty string instead of calling the API. 0 = unlimited (default for
    # dev). Set explicitly in production.
    anthropic_daily_budget_usd: float = 0.0

    # ── Audio storage retention (Phase 6) ──
    # Recordings older than this are purged on a periodic background task.
    audio_retention_days: int = 7
    # How often the cleanup loop wakes up. Set to 0 to disable.
    audio_cleanup_interval_hours: int = 6


@lru_cache
def get_settings() -> Settings:
    return Settings()
