"""Tests for the /verify/transcript anti-hallucination endpoint."""

from __future__ import annotations

import importlib.util

import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_verify_transcript_invalid_video_id():
    resp = client.post(
        "/verify/transcript",
        json={
            "video_id": "bad/id??",
            "query": "Test query",
            "transcript_text": "Sample transcript content",
            "provider": "mock",
        },
    )
    assert resp.status_code == 400
    assert "invalid video_id" in resp.json()["detail"]


def test_verify_transcript_empty_text():
    resp = client.post(
        "/verify/transcript",
        json={
            "video_id": "abc123xyz00",
            "query": "Test query",
            "transcript_text": "   ",
            "provider": "mock",
        },
    )
    assert resp.status_code == 400
    assert "transcript_text cannot be empty" in resp.json()["detail"]


def test_verify_transcript_empty_query():
    resp = client.post(
        "/verify/transcript",
        json={
            "video_id": "abc123xyz00",
            "query": "",
            "transcript_text": "Some transcript",
            "provider": "mock",
        },
    )
    assert resp.status_code == 400
    assert "query cannot be empty" in resp.json()["detail"]


def test_verify_transcript_engine_missing_returns_503():
    if importlib.util.find_spec("reliable_agent") is not None:
        pytest.skip("reliable_agent is installed")
    resp = client.post(
        "/verify/transcript",
        json={
            "video_id": "dQw4w9WgXcQ",
            "query": "Tóm tắt nội dung video",
            "transcript_text": "Đây là video giới thiệu công nghệ mới được phát hành năm 2024.",
            "force_deep": True,
            "provider": "mock",
        },
    )
    assert resp.status_code == 503
    assert resp.json()["detail"] == "reliable_agent is not installed"


def test_verify_transcript_success_with_mock():
    pytest.importorskip("reliable_agent")
    resp = client.post(
        "/verify/transcript",
        json={
            "video_id": "dQw4w9WgXcQ",
            "query": "Tóm tắt nội dung video",
            "transcript_text": "Đây là video giới thiệu công nghệ mới được phát hành năm 2024.",
            "force_deep": True,
            "provider": "mock",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert "final_answer" in data
    assert isinstance(data["verified_facts_count"], int)
    assert isinstance(data["unverified_gaps"], list)
