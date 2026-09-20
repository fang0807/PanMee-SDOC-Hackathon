import json
import os
import urllib.error
import urllib.request
from typing import Any, Dict

from .config import (
    LLM_API_KEY,
    LLM_ENDPOINT,
    LLM_MODEL,
    LLM_TIMEOUT,
)


class SemanticProvider:
    def classify(self, prompt: str) -> Dict[str, Any]:
        raise NotImplementedError

    def extract(self, prompt: str) -> Dict[str, Any]:
        raise NotImplementedError


class MockProvider(SemanticProvider):
    """Deterministic provider for local integration tests."""

    def classify(self, prompt):
        return {
            "category": "GENERAL",
            "confidence": 0.50,
            "reason": "Mock provider",
        }

    def extract(self, prompt):
        return {"fields": {}}


class OpenAICompatibleProvider(SemanticProvider):
    """
    Provider for OpenAI-compatible Chat Completions endpoints.

    Environment variables:
        SEMANTIC_LLM_ENDPOINT
        SEMANTIC_LLM_API_KEY
        SEMANTIC_LLM_MODEL
        SEMANTIC_REASONING_EFFORT (optional, default: none)
    """

    def __init__(
        self,
        endpoint=LLM_ENDPOINT,
        api_key=LLM_API_KEY,
        model=LLM_MODEL,
        timeout=LLM_TIMEOUT,
    ):
        if not endpoint:
            raise ValueError(
                "SEMANTIC_LLM_ENDPOINT is not set"
            )

        if not model:
            raise ValueError(
                "SEMANTIC_LLM_MODEL is not set"
            )

        if not api_key:
            raise ValueError(
                "SEMANTIC_LLM_API_KEY is not set"
            )

        self.endpoint = endpoint
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

        self.reasoning_effort = os.getenv(
            "SEMANTIC_REASONING_EFFORT",
            "none",
        ).strip().lower()

    def _call(self, prompt):
        # Keep the request deliberately small and compatible.
        # In particular, do not send `temperature` for reasoning
        # model families unless you know that model/config supports it.
        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "user",
                    "content": prompt,
                }
            ],
            "reasoning_effort": self.reasoning_effort,
        }

        data = json.dumps(
            payload
        ).encode("utf-8")

        headers = {
            "Content-Type": "application/json",
            "Authorization": (
                f"Bearer {self.api_key}"
            ),
        }

        req = urllib.request.Request(
            self.endpoint,
            data=data,
            headers=headers,
            method="POST",
        )

        try:
            with urllib.request.urlopen(
                req,
                timeout=self.timeout,
            ) as response:
                raw_response = (
                    response.read()
                    .decode("utf-8")
                )

        except urllib.error.HTTPError as exc:
            # Important: show OpenAI's JSON error message.
            # Do not print the API key or request headers.
            try:
                error_body = (
                    exc.read()
                    .decode("utf-8", errors="replace")
                )
            except Exception:
                error_body = ""

            raise RuntimeError(
                f"LLM HTTP {exc.code}: "
                f"{error_body or exc.reason}"
            ) from exc

        except urllib.error.URLError as exc:
            raise RuntimeError(
                f"LLM connection error: {exc.reason}"
            ) from exc

        try:
            obj = json.loads(
                raw_response
            )
        except json.JSONDecodeError as exc:
            raise RuntimeError(
                "LLM returned non-JSON HTTP response: "
                f"{raw_response[:500]}"
            ) from exc

        try:
            content = (
                obj["choices"][0]
                ["message"]["content"]
            )
        except (
            KeyError,
            IndexError,
            TypeError,
        ) as exc:
            raise RuntimeError(
                "Unexpected Chat Completions response: "
                f"{json.dumps(obj)[:1000]}"
            ) from exc

        if isinstance(
            content,
            list,
        ):
            pieces = []

            for item in content:
                if isinstance(
                    item,
                    dict,
                ):
                    text = item.get("text")

                    if isinstance(
                        text,
                        str,
                    ):
                        pieces.append(text)

            content = "".join(
                pieces
            )

        content = str(
            content
        ).strip()

        # Accept accidental fenced JSON.
        if content.startswith(
            "```"
        ):
            content = (
                content.strip("`")
                .strip()
            )

            if content.lower().startswith(
                "json"
            ):
                content = (
                    content[4:]
                    .strip()
                )

        try:
            return json.loads(
                content
            )
        except json.JSONDecodeError as exc:
            raise RuntimeError(
                "LLM response was not valid JSON: "
                f"{content[:1000]}"
            ) from exc

    def classify(self, prompt):
        return self._call(prompt)

    def extract(self, prompt):
        return self._call(prompt)
