import unittest
from unittest.mock import MagicMock, patch

from app.services.ai_writer import LLMClient
from app.services.llm_settings import list_supported_llm_models


class LLMModelsTests(unittest.TestCase):
    def test_supported_models_include_gemini_3_flash_preview(self) -> None:
        self.assertIn("google/gemini-3-flash-preview", list_supported_llm_models())

    @patch("app.services.ai_writer.settings")
    @patch("app.services.ai_writer.httpx.Client")
    def test_claude_uses_dedicated_shorter_timeout(self, mock_client_cls: MagicMock, mock_settings: MagicMock) -> None:
        mock_settings.llm_provider = "openrouter"
        mock_settings.openrouter_model = "openai/gpt-5-mini"
        mock_settings.openrouter_api_key = "test-key"
        mock_settings.openrouter_base_url = "https://openrouter.ai/api/v1"
        mock_settings.llm_retry_count = 0
        mock_settings.llm_retry_backoff_seconds = 0
        mock_settings.llm_timeout_seconds = 300

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "pong"}}]
        }
        mock_response.raise_for_status.return_value = None

        mock_client = MagicMock()
        mock_client.post.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = None
        mock_client_cls.return_value = mock_client

        client = LLMClient(model="claude-sonnet-4.6")
        result = client.chat("ping")

        self.assertEqual(result, "pong")
        _, kwargs = mock_client_cls.call_args
        self.assertEqual(kwargs["timeout"], 120)
        _, post_kwargs = mock_client.post.call_args
        self.assertNotIn("reasoning", post_kwargs["json"])

    @patch("app.services.ai_writer.settings")
    @patch("app.services.ai_writer.httpx.Client")
    def test_gemini_openrouter_payload_does_not_include_reasoning(self, mock_client_cls: MagicMock, mock_settings: MagicMock) -> None:
        mock_settings.llm_provider = "openrouter"
        mock_settings.openrouter_model = "openai/gpt-5-mini"
        mock_settings.openrouter_api_key = "test-key"
        mock_settings.openrouter_base_url = "https://openrouter.ai/api/v1"
        mock_settings.llm_retry_count = 0
        mock_settings.llm_retry_backoff_seconds = 0
        mock_settings.llm_timeout_seconds = 30

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "pong"}}]
        }
        mock_response.raise_for_status.return_value = None

        mock_client = MagicMock()
        mock_client.post.return_value = mock_response
        mock_client.__enter__.return_value = mock_client
        mock_client.__exit__.return_value = None
        mock_client_cls.return_value = mock_client

        client = LLMClient(model="google/gemini-3-flash-preview")
        result = client.chat("ping")

        self.assertEqual(result, "pong")
        _, client_kwargs = mock_client_cls.call_args
        self.assertEqual(client_kwargs["timeout"], 30)
        _, kwargs = mock_client.post.call_args
        payload = kwargs["json"]
        self.assertEqual(payload["model"], "google/gemini-3-flash-preview")
        self.assertNotIn("reasoning", payload)


if __name__ == "__main__":
    unittest.main()
