#!/usr/bin/env python3
"""Run the live Gemini translation probe with a temporary OmniRoute export."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--credential-id", required=True)
    parser.add_argument("--model")
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--ids")
    parser.add_argument("--languages", default="vi,en")
    args = parser.parse_args()

    languages = [language.strip() for language in args.languages.split(",") if language.strip()]
    if not languages or any(language not in {"vi", "en"} for language in languages):
        raise SystemExit("--languages must contain vi and/or en")

    manifest = args.manifest or Path("testdata/translation-gold/mofa-2026-01-09.20cue.manifest.json")
    subset_path: Path | None = None
    if args.ids:
        wanted = set(args.ids.split(","))
        data = json.loads(manifest.read_text())
        data["cues"] = [cue for cue in data["cues"] if cue["id"] in wanted]
        if not data["cues"]:
            raise SystemExit("no matching cues")
        fd, name = tempfile.mkstemp(prefix="gemini-manifest-", suffix=".json")
        os.close(fd)
        subset_path = Path(name)
        subset_path.write_text(json.dumps(data, ensure_ascii=False))
        manifest = subset_path

    fd, credential_path = tempfile.mkstemp(prefix="omniroute-gemini-", suffix=".json", dir="/tmp")
    os.close(fd)
    os.chmod(credential_path, 0o600)
    try:
        export = subprocess.run(
            ["omniroute", "auth", "export", "--id", args.credential_id,
             "--format", "json", "--out", credential_path, "--force"],
            capture_output=True, text=True, timeout=60,
        )
        if export.returncode:
            sys.stderr.write(export.stderr[-2000:])
            return export.returncode

        env = os.environ.copy()
        env["GEMINI_LIVE_MANIFEST"] = str(manifest)
        env["GEMINI_LIVE_LANGUAGES"] = ",".join(languages)
        if args.model:
            env["GEMINI_TRANSLATION_MODEL"] = args.model
        return subprocess.run(
            ["node", "scripts/gemini_live_translation_test.js", credential_path],
            env=env,
        ).returncode
    finally:
        try:
            os.unlink(credential_path)
        except FileNotFoundError:
            pass
        if subset_path:
            try:
                os.unlink(subset_path)
            except FileNotFoundError:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
