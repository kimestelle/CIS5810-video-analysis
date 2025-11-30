// api.ts
const BASE_URL = "http://localhost:8000";

// ----------------- 타입 정의 -----------------
export interface HealthResponse {
  Hello: string;
}

export interface UploadVideoResponse {
  message: string;
  filename: string;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface Scene {
  captions: string[];
  start_time: number;
  end_time: number;
}

export interface CombinedScene {
  start_time: number;
  end_time: number;
  description: string;
  dialogue: string[];
}

export interface AnalyzeVideoResponse {
  transcript_text: string;
  transcript_segments: TranscriptSegment[];
  frame_captions: string[];
  scenes: Scene[];
  combined_scenes: CombinedScene[];
  language: string | null;
}

export interface StartAnalysisResponse {
  job_id: string;
}

export interface AnalysisStatusPending {
  status: "pending" | "processing";
  progress?: {
    percent?: number;
    step?: string;
  };
}

export interface AnalysisStatusDone {
  status: "completed";
  result: AnalyzeVideoResponse;
}

export interface AnalysisStatusFailed {
  status: "failed";
  error: string;
}

export type AnalysisStatusResponse =
  | AnalysisStatusPending
  | AnalysisStatusDone
  | AnalysisStatusFailed;

// ----------------- API 함수 -----------------
export async function pingBackend(signal?: AbortSignal): Promise<HealthResponse> {
  const res = await fetch(`${BASE_URL}/`, { method: "GET", signal });
  if (!res.ok) throw new Error(`Backend health check failed: ${res.status} ${res.statusText}`);
  return res.json();
}

export async function uploadVideo(file: File, signal?: AbortSignal): Promise<UploadVideoResponse> {
  const formData = new FormData();
  formData.append("video_file", file);

  const res = await fetch(`${BASE_URL}/upload-video/`, {
    method: "POST",
    body: formData,
    signal,
  });

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (typeof data.detail === "string") detail = data.detail;
      else if (typeof data.message === "string") detail = data.message;
    } catch {}
    throw new Error(`Video upload failed: ${detail}`);
  }

  return res.json();
}

export async function startAnalysis(videoFilename: string, signal?: AbortSignal): Promise<StartAnalysisResponse> {
  const res = await fetch(`${BASE_URL}/analyze-video/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ video_filename: videoFilename }),
    signal,
  });

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (typeof data.detail === "string") detail = data.detail;
    } catch {}
    throw new Error(`Start analysis failed: ${detail}`);
  }

  return res.json();
}

export async function getAnalysisStatus(jobId: string, signal?: AbortSignal): Promise<AnalysisStatusResponse> {
  const res = await fetch(`${BASE_URL}/analysis/${jobId}`, { method: "GET", signal });

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (typeof data.detail === "string") detail = data.detail;
    } catch {}
    throw new Error(`Get analysis failed: ${detail}`);
  }

  return res.json();
}
