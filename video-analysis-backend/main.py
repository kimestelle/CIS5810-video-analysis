#run commmand: uvicorn main:app
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pathlib import Path
from tasks import celery_app, process_video_task
from celery.result import AsyncResult
import os

from tasks import celery_app, process_video_task
app = FastAPI()

origins = [
    "http://localhost",
    "http://localhost:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploaded_videos"
UPLOAD_DIR.mkdir(exist_ok=True)

class AnalyzeVideoRequest(BaseModel):
    video_filename: str

@app.get("/")
def read_root():
    return {"Hello": "World"}

@app.post("/upload-video/")
async def upload_video(video_file: UploadFile = File(...)):
    try:
        file_path = UPLOAD_DIR / video_file.filename

        with open(file_path, "wb") as buffer:
            while content := await video_file.read(1024 * 1024):
                buffer.write(content)

        print("Uploaded to:", file_path)
        return {
            "message": f"Video '{video_file.filename}' uploaded successfully!",
            "filename": video_file.filename,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error uploading video: {e}")


@app.post("/analyze-video/")
def analyze_video_endpoint(payload: AnalyzeVideoRequest):
    video_path = UPLOAD_DIR / payload.video_filename
    if not video_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Video file '{payload.video_filename}' not found.",
        )

    # enqueue background job
    task = process_video_task.delay(str(video_path))
    print("Queued task:", task.id, "for", video_path)

    return {"job_id": task.id}


@app.get("/analysis/{job_id}")
def get_analysis(job_id: str):
    res = AsyncResult(job_id, app=celery_app)

    if res.state == "PROGRESS":
        meta = res.info or {}
        print(meta.get("percent", 0))
        return {
            "status": "processing",
            "progress": {
                "percent": meta.get("percent", 0),
                "step": meta.get("step", "working"),
            },
        }

    if res.state == "PENDING":
        return {"status": "pending"}

    if res.state == "STARTED":
        # started but no progress meta yet
        return {"status": "processing"}

    if res.state == "FAILURE":
        return {
            "status": "failed",
            "error": str(res.info),
        }

    if res.state == "SUCCESS":
        return {
            "status": "completed",
            "result": res.result,  # full JSON
        }

    return {"status": res.state.lower()}