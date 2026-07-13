#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Transcribe an audio file with faster-whisper.")
    parser.add_argument("audio_file")
    parser.add_argument("--model", default="base")
    parser.add_argument("--device", default="auto")
    parser.add_argument("--compute-type", default="auto")
    args = parser.parse_args()

    audio_path = Path(args.audio_file)
    if not audio_path.exists():
        print(json.dumps({"error": f"Audio file not found: {audio_path}"}), file=sys.stderr)
        return 2

    try:
        from faster_whisper import WhisperModel
    except Exception as exc:
        print(
            json.dumps(
                {
                    "error": "faster-whisper is not installed. Run npm run setup:whisper first.",
                    "detail": str(exc),
                }
            ),
            file=sys.stderr,
        )
        return 3

    try:
        model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
        segments, info = model.transcribe(
            str(audio_path),
            beam_size=5,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500},
        )
        text = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
        print(
            json.dumps(
                {
                    "text": text,
                    "language": getattr(info, "language", None),
                    "languageProbability": getattr(info, "language_probability", None),
                    "duration": getattr(info, "duration", None),
                }
            )
        )
        return 0
    except Exception as exc:
        print(json.dumps({"error": "Whisper transcription failed.", "detail": str(exc)}), file=sys.stderr)
        return 4


if __name__ == "__main__":
    raise SystemExit(main())
