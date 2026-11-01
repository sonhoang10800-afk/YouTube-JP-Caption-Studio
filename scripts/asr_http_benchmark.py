#!/usr/bin/env python3
"""Run the ASR benchmark matrix through a real bridge HTTP endpoint."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

ROOT = Path(__file__).resolve().parent.parent
LOCAL_BRIDGE = ROOT / "local-bridge"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(LOCAL_BRIDGE) not in sys.path:
    sys.path.insert(0, str(LOCAL_BRIDGE))

from app.services.asr import (
    ALLOWED_MODELS,
    BENCHMARK_ALLOWLIST_ENV,
    BENCHMARK_MODELS,
    DEFAULT_INITIAL_PROMPT,
    DEFAULT_MODEL_NAME,
)
from scripts.asr_benchmark import evaluate_windows

DEFAULT_BENCHMARK_MODELS = ALLOWED_MODELS + BENCHMARK_MODELS
GENERIC_BROADCAST_INITIAL_PROMPT = "日本語のニュースや会議の書き起こしです。"
MAX_ROLLING_CONTEXT_CHARS = 200


def sha256_file(path: Path, expected: Optional[str] = None) -> str:
    """Return the SHA-256 digest and optionally enforce the manifest digest."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    actual = digest.hexdigest()
    if expected and actual.lower() != expected.lower():
        raise ValueError(
            f"audio SHA-256 mismatch for {path}: expected {expected.lower()}, got {actual}"
        )
    return actual


class HttpAsrClient:
    """Minimal raw-body client for the bridge's `/asr/transcribe` contract."""

    def __init__(self, base_url: str, timeout: float = 300.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def transcribe(
        self,
        audio: bytes,
        *,
        model: str = DEFAULT_MODEL_NAME,
        language: str = "ja",
        preprocess: bool = True,
        temperature: float = 0.0,
        condition_on_previous_text: bool = False,
        no_speech_threshold: float = 0.85,
        logprob_threshold: float = -1.5,
        initial_prompt: Optional[str] = DEFAULT_INITIAL_PROMPT,
        fp16: bool = False,
    ) -> Dict[str, Any]:
        params = {
            "model": model,
            "language": language,
            "temperature": str(temperature),
            "condition_on_previous_text": str(condition_on_previous_text).lower(),
            "no_speech_threshold": str(no_speech_threshold),
            "logprob_threshold": str(logprob_threshold),
            "preprocess": str(preprocess).lower(),
            "fp16": str(fp16).lower(),
        }
        if initial_prompt is not None:
            params["initial_prompt"] = initial_prompt
        url = f"{self.base_url}/asr/transcribe?{urllib.parse.urlencode(params)}"
        request = urllib.request.Request(
            url,
            data=audio,
            method="POST",
            headers={"Content-Type": "audio/wav"},
        )

        status: Optional[int] = None
        response_body = b""
        transport_error: Optional[str] = None
        start = time.perf_counter()
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                status = response.status
                response_body = response.read()
        except urllib.error.HTTPError as exc:
            status = exc.code
            response_body = exc.read()
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            transport_error = str(exc)
        elapsed = time.perf_counter() - start

        payload: Any = None
        if response_body:
            try:
                payload = json.loads(response_body.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                payload = None

        if transport_error:
            return {
                "text": "",
                "segments": [],
                "httpStatus": None,
                "networkElapsedSec": round(elapsed, 4),
                "error": transport_error,
            }
        if status != 200:
            detail = payload.get("detail") if isinstance(payload, dict) else None
            if not detail:
                detail = response_body.decode("utf-8", errors="replace")[:500]
            return {
                "text": "",
                "segments": [],
                "httpStatus": status,
                "networkElapsedSec": round(elapsed, 4),
                "error": str(detail or f"HTTP {status}"),
            }
        if not isinstance(payload, dict):
            return {
                "text": "",
                "segments": [],
                "httpStatus": status,
                "networkElapsedSec": round(elapsed, 4),
                "contractError": "response was not a JSON object",
            }

        result = dict(payload)
        result["httpStatus"] = status
        result["networkElapsedSec"] = round(elapsed, 4)
        result["requestedModel"] = model
        result["requestedPreprocess"] = preprocess
        if not isinstance(result.get("text"), str) or not isinstance(result.get("segments"), list):
            result["contractError"] = "response lacks text or segments"
        if not result.get("backend"):
            result["contractError"] = "response lacks backend"
        if result.get("model") and result["model"] != model:
            result["contractError"] = "response model does not match request"
        if "preprocess" in result and result["preprocess"] != preprocess:
            result["contractError"] = "response preprocess does not match request"
        return result


def _window_audio_path(
    manifest_path: Path, wav_dir: Optional[Path], window: Dict[str, Any]
) -> Path:
    raw_candidates: List[Path] = []
    for key in ("audioFile", "wavFile"):
        value = window.get(key)
        if value:
            raw_candidates.append(Path(str(value)))
    raw_candidates.extend([
        Path(f"{window['id']}.wav"),
        Path("wav") / f"{window['id']}.wav",
    ])
    search_roots = [wav_dir] if wav_dir else []
    search_roots.extend([manifest_path.parent, ROOT])
    for candidate in raw_candidates:
        if candidate.is_absolute() and candidate.is_file():
            return candidate
        for root in search_roots:
            if root is None:
                continue
            path = root / candidate
            if path.is_file():
                return path
    raise FileNotFoundError(f"Audio not found for window {window['id']}")


def run_http_model(
    *,
    manifest_path: Path,
    wav_dir: Optional[Path],
    base_url: str,
    model: str,
    dsp_configs: Sequence[bool],
    timeout: float = 300.0,
    initial_prompt: Optional[str] = DEFAULT_INITIAL_PROMPT,
    decode_variants: Optional[Sequence[tuple[bool, str, Optional[str]]]] = None,
    rolling_context: bool = False,
) -> Dict[str, Dict[str, Dict[str, Any]]]:
    """Run one model across DSP configurations and return window predictions."""
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    windows = manifest.get("windows", [])
    if not windows:
        raise ValueError(f"No windows in manifest: {manifest_path}")
    client = HttpAsrClient(base_url, timeout=timeout)
    predictions: Dict[str, Dict[str, Dict[str, Any]]] = {}
    first_request = True

    if rolling_context and decode_variants:
        raise ValueError("rolling_context cannot be combined with decode_variants")
    if rolling_context:
        variants = [(False, "rolling-context", None)]
    elif decode_variants:
        variants = list(decode_variants)
    else:
        variants = [(False, "default", initial_prompt)]
    matrix_mode = len(variants) > 1 or rolling_context
    for condition_on_previous_text, prompt_mode, prompt in variants:
        for preprocess in dsp_configs:
            dsp_tag = "dsp_on" if preprocess else "dsp_off"
            config_key = f"{model} [{dsp_tag}]"
            if matrix_mode:
                config_key = (
                    f"{model} [dsp_{'on' if preprocess else 'off'},"
                    f"cond_{str(condition_on_previous_text).lower()},prompt_{prompt_mode}]"
                )
            print(f"--- HTTP {config_key} on {len(windows)} windows ---", file=sys.stderr)
            previous_window: Optional[Dict[str, Any]] = None
            for window in windows:
                window_id = window["id"]
                video_id = str(window.get("videoId", ""))
                audio_path = _window_audio_path(manifest_path, wav_dir, window)
                if window.get("audioSha256"):
                    sha256_file(audio_path, expected=str(window["audioSha256"]))
                audio = audio_path.read_bytes()
                request_prompt = prompt
                if rolling_context:
                    request_prompt = None
                    if (
                        previous_window
                        and previous_window["videoId"] == video_id
                        and int(window.get("startMs", 0)) <= int(previous_window["endMs"])
                        and previous_window["text"]
                    ):
                        context_tail = previous_window["text"].strip()[-MAX_ROLLING_CONTEXT_CHARS:]
                        request_prompt = context_tail or None
                result = client.transcribe(
                    audio,
                    model=model,
                    preprocess=preprocess,
                    condition_on_previous_text=condition_on_previous_text,
                    initial_prompt=request_prompt,
                )
                result["decode"] = {
                    "dsp": preprocess,
                    "conditionOnPreviousText": condition_on_previous_text,
                    "initialPromptMode": prompt_mode,
                    "initialPrompt": request_prompt or None,
                    "rollingContext": rolling_context,
                }
                result["coldStart"] = first_request
                if first_request:
                    result["coldStartElapsedSec"] = result.get("elapsedSec")
                first_request = False
                result["audioPath"] = str(audio_path)
                predictions.setdefault(window_id, {})[config_key] = result
                if rolling_context:
                    decoded_text = result.get("text")
                    previous_window = {
                        "videoId": video_id,
                        "endMs": int(window.get("endMs", 0)),
                        "text": decoded_text if isinstance(decoded_text, str) else "",
                    }
                status = result.get("httpStatus")
                print(
                    f"[{window_id}] HTTP {status} backend={result.get('backend')} "
                    f"text={result.get('text', '')[:40]}...",
                    file=sys.stderr,
                )
    return predictions


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _wait_for_health(base_url: str, process: subprocess.Popen[Any], timeout: float = 60.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"bridge exited before health check (exit {process.returncode})")
        try:
            with urllib.request.urlopen(f"{base_url}/health", timeout=2) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, TimeoutError, OSError):
            time.sleep(0.2)
    raise TimeoutError(f"bridge did not become healthy within {timeout}s")


class BridgeProcess:
    """Start a fresh bridge process so model loading is measured cold."""

    def __init__(self, python: str, log_path: Path, env_overrides: Optional[Dict[str, str]] = None):
        self.python = python
        self.log_path = log_path
        self.env_overrides = dict(env_overrides or {})
        self.process: Optional[subprocess.Popen[Any]] = None
        self.log_handle = None
        self.port = _free_port()
        self.base_url = f"http://127.0.0.1:{self.port}"

    def __enter__(self) -> "BridgeProcess":
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        self.log_handle = self.log_path.open("w", encoding="utf-8")
        env = dict(os.environ)
        env["PYTHONUNBUFFERED"] = "1"
        env.update(self.env_overrides)
        self.process = subprocess.Popen(
            [
                self.python,
                "-m",
                "uvicorn",
                "app.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(self.port),
                "--workers",
                "1",
                "--log-level",
                "warning",
            ],
            cwd=str(LOCAL_BRIDGE),
            env=env,
            stdout=self.log_handle,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            _wait_for_health(self.base_url, self.process)
        except Exception:
            self.stop()
            raise
        return self

    def stop(self) -> None:
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        if self.log_handle:
            self.log_handle.close()
            self.log_handle = None

    def __exit__(self, exc_type, exc, tb) -> None:
        self.stop()


def _write_json(path: Optional[Path], payload: Dict[str, Any]) -> None:
    text = json.dumps(payload, indent=2, ensure_ascii=False)
    if path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text + "\n", encoding="utf-8")
    print(text)


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Run ASR benchmarks over real bridge HTTP.")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--wav-dir", default=None)
    parser.add_argument("--models", default=",".join(DEFAULT_BENCHMARK_MODELS))
    parser.add_argument("--compare-dsp", action="store_true")
    parser.add_argument("--bridge-url", default=None, help="Use an existing bridge instead of spawning one per model")
    parser.add_argument("--python", default=sys.executable)
    parser.add_argument("--server-log-dir", default=None)
    parser.add_argument("--timeout", type=float, default=900.0)
    parser.add_argument("--include-unverified", action="store_true")
    parser.add_argument("--min-ref-chars", type=int, default=2400)
    parser.add_argument("--streaming", action=argparse.BooleanOptionalAction, default=True)
    decode_group = parser.add_mutually_exclusive_group()
    decode_group.add_argument(
        "--decode-matrix",
        action="store_true",
        help="Run condition_on_previous_text x initial_prompt variants in one model load",
    )
    decode_group.add_argument(
        "--rolling-context",
        action="store_true",
        help="Prompt each overlapping window with the previous decoded text",
    )
    parser.add_argument(
        "--initial-prompt",
        default=DEFAULT_INITIAL_PROMPT,
        help="Fixed initial prompt for non-rolling runs; pass an empty string for none",
    )
    parser.add_argument("--json-out", default=None)
    args = parser.parse_args(argv)

    manifest_path = Path(args.manifest)
    wav_dir = Path(args.wav_dir) if args.wav_dir else None
    models = [model.strip() for model in args.models.split(",") if model.strip()]
    dsp_configs = [True, False] if args.compare_dsp else [True]
    decode_variants = None
    decode_metadata = [(False, "default", args.initial_prompt)]
    if args.decode_matrix:
        decode_metadata = [
            (condition, prompt_mode, prompt)
            for condition in (False, True)
            for prompt_mode, prompt in (
                ("none", ""),
                ("generic-broadcast", GENERIC_BROADCAST_INITIAL_PROMPT),
            )
        ]
        decode_variants = decode_metadata
    elif args.rolling_context:
        decode_metadata = [(False, "rolling-context", None)]
    predictions: Dict[str, Dict[str, Dict[str, Any]]] = {}
    run_models: List[Dict[str, Any]] = []
    log_dir = Path(args.server_log_dir) if args.server_log_dir else None

    for model in models:
        if args.bridge_url:
            base_url = args.bridge_url
            server_log = None
            model_predictions = run_http_model(
                manifest_path=manifest_path,
                wav_dir=wav_dir,
                base_url=base_url,
                model=model,
                dsp_configs=dsp_configs,
                timeout=args.timeout,
                initial_prompt=args.initial_prompt,
                decode_variants=decode_variants,
                rolling_context=args.rolling_context,
            )
        else:
            slug = model.replace("/", "__")
            server_log = (log_dir / f"bridge-{slug}.log") if log_dir else Path(os.devnull)
            with BridgeProcess(
                args.python,
                server_log,
                env_overrides={BENCHMARK_ALLOWLIST_ENV: "1"},
            ) as bridge:
                base_url = bridge.base_url
                model_predictions = run_http_model(
                    manifest_path=manifest_path,
                    wav_dir=wav_dir,
                    base_url=base_url,
                    model=model,
                    dsp_configs=dsp_configs,
                    timeout=args.timeout,
                    initial_prompt=args.initial_prompt,
                    decode_variants=decode_variants,
                    rolling_context=args.rolling_context,
                )
        for window_id, configs in model_predictions.items():
            predictions.setdefault(window_id, {}).update(configs)
        run_models.append({"model": model, "bridgeUrl": base_url, "serverLog": str(server_log) if server_log else None})

    summary = evaluate_windows(
        manifest_path,
        predictions=predictions,
        include_unverified=args.include_unverified,
        min_ref_chars=args.min_ref_chars,
        streaming=args.streaming,
    )
    summary["runMetadata"] = {
        "transport": "http",
        "endpoint": "/asr/transcribe",
        "models": models,
        "dspConfigs": ["on" if value else "off" for value in dsp_configs],
        "decodeMatrix": [
            {
                "conditionOnPreviousText": condition,
                "initialPromptMode": prompt_mode,
                "initialPrompt": prompt or None,
            }
            for condition, prompt_mode, prompt in decode_metadata
        ],
        "coldStartPerModel": args.bridge_url is None,
        "rollingContext": args.rolling_context,
        "rollingContextChars": MAX_ROLLING_CONTEXT_CHARS if args.rolling_context else None,
        "initialPrompt": args.initial_prompt or None,
        "serverRuns": run_models,
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    _write_json(Path(args.json_out) if args.json_out else None, summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
