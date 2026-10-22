import pytest


@pytest.fixture(autouse=True)
def _no_real_llm(monkeypatch):
    """Unit tests must never spend tokens, even if a developer has a key in .env."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
