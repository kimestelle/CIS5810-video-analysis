# run command: celery -A tasks.celery_app worker --loglevel=info

import os
from celery import Celery
from analysis_pipeline import (
    transcribe_with_whisper,
    extract_frames,
    caption_frames,
    categorize_scenes,
    combine_scenes_with_transcript,
    analyze_emotions,
    merge_text_and_emotions,
)

CELERY_BROKER_URL = os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0")
CELERY_RESULT_BACKEND = os.environ.get("CELERY_RESULT_BACKEND", "redis://localhost:6379/1")

celery_app = Celery(
    "video_analysis",
    broker=CELERY_BROKER_URL,
    backend=CELERY_RESULT_BACKEND,
)

@celery_app.task(bind=True)
def process_video_task(self, video_path: str) -> dict:
    """
    Background task that runs your full pipeline,
    and updates progress in Celery's result backend.
    """
    try:
        # 0. starting
        self.update_state(
            state="PROGRESS",
            meta={"percent": 5, "step": "starting analysis"},
        )

        # 1. Transcribe
        self.update_state(
            state="PROGRESS",
            meta={"percent": 20, "step": "transcribing audio"},
        )
        t = transcribe_with_whisper(video_path)
        transcript_segments = t["segments"]
        transcript_text = t["text"]
        language = t.get("language")

        # 2. Frames
        self.update_state(
            state="PROGRESS",
            meta={"percent": 40, "step": "extracting frames"},
        )
        frames = extract_frames(video_path, fps=1.0)

        # 3. Captions
        self.update_state(
            state="PROGRESS",
            meta={"percent": 60, "step": "captioning frames"},
        )
        frame_captions = caption_frames(frames)

        # 4. Scenes
        self.update_state(
            state="PROGRESS",
            meta={"percent": 70, "step": "grouping scenes"},
        )
        scenes = categorize_scenes(
            captions=frame_captions,
            threshold=0.6,
            max_gap=1,
            fps=1.0,
        )

        # 5. Combine with transcript
        self.update_state(
            state="PROGRESS",
            meta={"percent": 80, "step": "attaching dialogue"},
        )
        combined_scenes = combine_scenes_with_transcript(scenes, transcript_segments)

        # 6. Emotion analysis
        self.update_state(
            state="PROGRESS",
            meta={"percent": 90, "step": "analyzing emotions"},
        )

        emotions = analyze_emotions(video_path, sample_rate=1)
        merged = merge_text_and_emotions(transcript_text, emotions)
        # 7. Final result
        result = {
            "transcript_text": transcript_text,
            "transcript_segments": transcript_segments,
            "frame_captions": frame_captions,
            "scenes": scenes,
            "combined_scenes": combined_scenes,
            "language": language,
            "merged_text_emotions": merged,
        }
        # Final
        self.update_state(
            state="PROGRESS",
            meta={"percent": 100, "step": "finalizing"},
        )

        return result

    finally:
        try:
            os.remove(video_path)
        except OSError:
            pass
