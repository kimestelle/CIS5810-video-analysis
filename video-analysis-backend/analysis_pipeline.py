"""
- Transcribe audio with faster-whisper
- Extract frames with OpenCV
- Caption frames with BLIP
- Group frames into scenes based on caption similarity
- Attach dialogue lines from the transcript to each scene
"""

from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional

from difflib import SequenceMatcher

import cv2
from PIL import Image
import torch

from faster_whisper import WhisperModel
from transformers import BlipProcessor, BlipForConditionalGeneration

import moviepy.editor as mp
import numpy as np
from tqdm import tqdm
from typing import List, Dict, Any

from transformers import AutoImageProcessor, AutoModelForImageClassification

_EMOTION_PROCESSOR: Optional[AutoImageProcessor] = None
_EMOTION_MODEL: Optional[AutoModelForImageClassification] = None

def get_emotion_model():
    global _EMOTION_PROCESSOR, _EMOTION_MODEL
    if _EMOTION_MODEL is None:
        # ViT model for emotion recognition
        model_name = "dima806/facial_emotions_image_detection"
        _EMOTION_PROCESSOR = AutoImageProcessor.from_pretrained(model_name)
        _EMOTION_MODEL = AutoModelForImageClassification.from_pretrained(model_name)
        _EMOTION_MODEL.eval()
    return _EMOTION_PROCESSOR, _EMOTION_MODEL



# ==========
# Lazy-loaded global models (so you don't reload them on every call)
# ==========

_WHISPER_MODEL: Optional[WhisperModel] = None
_BLIP_PROCESSOR: Optional[BlipProcessor] = None
_BLIP_MODEL: Optional[BlipForConditionalGeneration] = None


def get_whisper_model(model_size: str = "small") -> WhisperModel:
    global _WHISPER_MODEL
    if _WHISPER_MODEL is None:
        _WHISPER_MODEL = WhisperModel(model_size)
    return _WHISPER_MODEL


def get_blip_models() -> Tuple[BlipProcessor, BlipForConditionalGeneration]:
    global _BLIP_PROCESSOR, _BLIP_MODEL
    if _BLIP_PROCESSOR is None or _BLIP_MODEL is None:
        _BLIP_PROCESSOR = BlipProcessor.from_pretrained(
            "Salesforce/blip-image-captioning-base"
        )
        _BLIP_MODEL = BlipForConditionalGeneration.from_pretrained(
            "Salesforce/blip-image-captioning-base"
        )
    return _BLIP_PROCESSOR, _BLIP_MODEL

# 1. transcription
def transcribe_with_whisper(
    video_path: str,
    model_size: str = "small",
) -> Dict[str, Any]:
    model = get_whisper_model(model_size=model_size)
    segments, info = model.transcribe(video_path)

    seg_list: List[Dict[str, Any]] = []
    all_text_parts: List[str] = []

    for s in segments:
        seg_list.append(
            {"start": float(s.start), "end": float(s.end), "text": s.text}
        )
        all_text_parts.append(s.text)

    return {
        "segments": seg_list,
        "text": "".join(all_text_parts),
        "language": info.language,
    }

#2. frame extraction
def extract_frames(video_path: str, fps: float = 1.0) -> List[Any]:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Failed to open video: {video_path}")

    orig_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    if orig_fps <= 0:
        orig_fps = 30.0

    frames: List[Any] = []
    frame_id = 0
    frame_interval = max(1, int(orig_fps // fps))

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_id % frame_interval == 0:
            frames.append(frame)
        frame_id += 1

    cap.release()
    return frames


# caption frames
def caption_frames(frames: List[Any]) -> List[str]:
    if not frames:
        return []

    processor, model = get_blip_models()
    captions: List[str] = []

    for f in frames:
        # Convert BGR (OpenCV) to RGB and then to PIL Image
        image = Image.fromarray(cv2.cvtColor(f, cv2.COLOR_BGR2RGB))
        inputs = processor(images=image, return_tensors="pt")
        with torch.no_grad():
            out = model.generate(**inputs)
        caption = processor.decode(out[0], skip_special_tokens=True)
        captions.append(caption)

    return captions


# 4. group scenes
def similar(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()

def categorize_scenes(
    captions: List[str],
    threshold: float = 0.6,
    max_gap: int = 1,
    fps: float = 1.0,
) -> List[Dict[str, Any]]:
    if not captions:
        return []

    scenes: List[Dict[str, Any]] = []

    current = {
        "captions": [captions[0]],
        "start_idx": 0,
        "end_idx": 1,
        "anchor": captions[0],
        "gap": 0,
    }

    for i in range(1, len(captions)):
        curr = captions[i]
        prev = captions[i - 1]

        if similar(curr, prev) >= threshold or similar(curr, current["anchor"]) >= threshold:
            current["captions"].append(curr)
            current["end_idx"] = i + 1
            current["gap"] = 0
        elif current["gap"] < max_gap:
            # tolerate an outlier without splitting
            current["captions"].append(curr)
            current["end_idx"] = i + 1
            current["gap"] += 1
        else:
            # finish current scene
            scenes.append(
                {
                    "captions": current["captions"],
                    "start_time": current["start_idx"] / fps,
                    "end_time": current["end_idx"] / fps,
                }
            )
            # start new scene
            current = {
                "captions": [curr],
                "start_idx": i,
                "end_idx": i + 1,
                "anchor": curr,
                "gap": 0,
            }

    # final scene
    scenes.append(
        {
            "captions": current["captions"],
            "start_time": current["start_idx"] / fps,
            "end_time": current["end_idx"] / fps,
        }
    )

    return scenes


#5. picking representative scene captions
def representative_caption(
    captions: List[str],
) -> Tuple[str, int, List[float]]:
    """
    Pick the caption that is most similar (on average) to all others in the scene.

    Returns:
        (best_caption, index_of_best, similarity_scores_per_caption)
    """
    n = len(captions)
    if n == 0:
        return "", -1, []
    if n == 1:
        return captions[0], 0, [1.0]

    scores = [0.0] * n
    for i in range(n):
        ai = captions[i]
        s = 0.0
        for j in range(n):
            if i == j:
                continue
            s += similar(ai, captions[j])
        scores[i] = s

    best_i = max(range(n), key=lambda i: scores[i])
    return captions[best_i], best_i, scores


# 6. combine with transcript
def combine_scenes_with_transcript(
    scenes: List[Dict[str, Any]],
    transcript_segments: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    combined: List[Dict[str, Any]] = []

    for scene in scenes:
        rep, _, _ = representative_caption(scene["captions"])
        scene_dialogue = [
            seg["text"]
            for seg in transcript_segments
            if scene["start_time"] <= float(seg["start"]) <= scene["end_time"]
            and scene["start_time"] <= float(seg["end"]) <= scene["end_time"]
        ]
        combined.append(
            {
                "start_time": scene["start_time"],
                "end_time": scene["end_time"],
                "description": rep,
                "dialogue": scene_dialogue,
            }
        )

    return combined

#7. analyze emotions
def analyze_emotions(video_path: str, sample_rate: float = 1.0):
    """
    Sample frames from the video with moviepy, run them through a
    HuggingFace ViT emotion classifier (PyTorch-only, no TensorFlow),
    and return the same shape of data you used before.
    """
    print("Analyzing emotions with HuggingFace ViT model...")

    processor, model = get_emotion_model()

    clip = mp.VideoFileClip(video_path)
    duration = clip.duration
    times = np.arange(0, duration, sample_rate)

    emotions: List[Dict[str, Any]] = []

    for t in tqdm(times, desc="Emotion detection"):
        frame = clip.get_frame(float(t))

        # resize for model
        h, w, _ = frame.shape
        scale = 800 / max(h, w) if max(h, w) > 800 else 1.0
        frame_resized = cv2.resize(frame, (int(w * scale), int(h * scale)))

        image = Image.fromarray(frame_resized)

        try:
            inputs = processor(images=image, return_tensors="pt")
            with torch.no_grad():
                outputs = model(**inputs)
                logits = outputs.logits[0]
                probs = torch.softmax(logits, dim=-1)

            top_prob, top_idx = torch.max(probs, dim=0)
            top_idx = int(top_idx)
            labels = model.config.id2label
            dominant = labels[top_idx]

            scores = {
                labels[i]: float(probs[i])
                for i in range(len(probs))
            }

            emotions.append({
                "time": float(t),
                "dominant_emotion": dominant,
                "emotion_scores": scores,
                "num_faces": 1,
            })

        except Exception as e:
            emotions.append({
                "time": float(t),
                "dominant_emotion": "error",
                "emotion_scores": {},
                "num_faces": 0,
                "error": str(e),
            })

    return emotions


#8. merge text and emotions
def merge_text_and_emotions(transcript_text, emotions):
    print("Merging transcript and emotion data...")

    sentences = [s.strip() for s in transcript_text.split(". ") if s.strip()]
    merged = []

    for i, line in enumerate(sentences):
        merged.append({
            "text": line,
            "emotion": emotions[i]["dominant_emotion"] if i < len(emotions) else "neutral",
            "emotion_scores": emotions[i]["emotion_scores"] if i < len(emotions) else {},
            "time": emotions[i]["time"] if i < len(emotions) else None
        })
    return merged


# 7. full pipeline
def analyze_video(
    video_path: str,
    whisper_model_size: str = "small",
    frame_fps: float = 1.0,
    scene_threshold: float = 0.6,
    scene_max_gap: int = 1,
) -> Dict[str, Any]:
    
    video_path = str(Path(video_path))

    # 1. Transcribe
    t = transcribe_with_whisper(video_path, model_size=whisper_model_size)
    transcript_segments = t["segments"]
    transcript_text = t["text"]
    language = t.get("language")

    # 2. Extract frames
    frames = extract_frames(video_path, fps=frame_fps)

    # 3. Caption frames
    frame_captions = caption_frames(frames)

    # 4. Group captions into scenes
    scenes = categorize_scenes(
        captions=frame_captions,
        threshold=scene_threshold,
        max_gap=scene_max_gap,
        fps=frame_fps,
    )

    # 5. Attach dialogue per scene
    combined_scenes = combine_scenes_with_transcript(scenes, transcript_segments)

    emotions = analyze_emotions(video_path, sample_rate=1)
    merged = merge_text_and_emotions(transcript_text, emotions)

    return {
        "transcript_text": transcript_text,
        "transcript_segments": transcript_segments,
        "frame_captions": frame_captions,
        "scenes": scenes,
        "combined_scenes": combined_scenes,
        "language": language,
        "merged_text_emotions": merged,
    }
