"use client";

import { useState, useEffect } from "react";

/**
 * page.tsx
 *
 * Works with FastAPI endpoints:
 *  - POST http://127.0.0.1:8000/upload-video/    (form field: video_file)
 *  - POST http://127.0.0.1:8000/analyze-video/   (JSON: { video_filename })
 *  - GET  http://127.0.0.1:8000/analysis/{job_id}
 *
 * Expects analysis result shape (from analysis_pipeline.py):
 * {
 *   transcript_text: string,
 *   transcript_segments: [{text: string, start: number, end: number}],
 *   frame_captions: [...],
 *   scenes: [...],
 *   combined_scenes: [...],
 *   language: string | null
 * }
 */

// ----------------- Helpers -----------------
function inferEmotionFromText(text: string | null) {
  if (!text || text.trim().length === 0)
    return { label: "neutral", color: "bg-gray-300", textColor: "text-gray-800" };

  const t = text.toLowerCase();

  const positive = ["happy", "joy", "laugh", "love", "smile", "excited", "cheerful", "delight"];
  const negative = ["sad", "angry", "mad", "hate", "upset", "cry", "depressed", "annoy"];
  const surprise = ["wow", "surprise", "surprised", "oh my", "what a"];
  const neutral = ["okay", "fine", "alright", "hm", "hmm"];

  let scorePos = 0,
    scoreNeg = 0,
    scoreSurp = 0;
  positive.forEach((k) => (scorePos += t.includes(k) ? 1 : 0));
  negative.forEach((k) => (scoreNeg += t.includes(k) ? 1 : 0));
  surprise.forEach((k) => (scoreSurp += t.includes(k) ? 1 : 0));

  if (scorePos > Math.max(scoreNeg, scoreSurp))
    return { label: "happy", color: "bg-emerald-200", textColor: "text-emerald-800" };
  if (scoreNeg > Math.max(scorePos, scoreSurp))
    return { label: "sad/angry", color: "bg-red-200", textColor: "text-red-800" };
  if (scoreSurp > Math.max(scorePos, scoreNeg))
    return { label: "surprised", color: "bg-amber-200", textColor: "text-amber-800" };
  return { label: "neutral", color: "bg-gray-200", textColor: "text-gray-800" };
}

function shortText(text: string | null, n = 300) {
  if (!text) return "-";
  if (text.length <= n) return text;
  return text.slice(0, n) + "...";
}

// ----------------- Component -----------------
export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [videoURL, setVideoURL] = useState<string | null>(null);

  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ percent: number; step: string } | null>(null);

  const [analysis, setAnalysis] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  const [showFullTranscript, setShowFullTranscript] = useState(false);

  useEffect(() => {
    // cleanup object URLs on unmount/file change
    return () => {
      if (videoURL) URL.revokeObjectURL(videoURL);
    };
  }, [videoURL]);

  // ----------------- upload + start flow -----------------
  async function handleUploadAndAnalyze() {
    if (!file) return alert("Please choose a video file first.");
    setAnalysis(null);
    setProgress(null);
    setJobId(null);
    setLoading(true);

    try {
      // 1) upload (FormData: video_file)
      const fd = new FormData();
      fd.append("video_file", file);

      const up = await fetch("http://127.0.0.1:8000/upload-video/", {
        method: "POST",
        body: fd,
      });

      if (!up.ok) {
        const err = await safeJson(up);
        throw new Error(err?.detail ?? err?.message ?? `Upload failed ${up.status}`);
      }
      const upData = await up.json();
      const filename = upData.filename;
      if (!filename) throw new Error("Upload response missing filename.");

      // 2) start analysis
      const start = await fetch("http://127.0.0.1:8000/analyze-video/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ video_filename: filename }),
      });

      if (!start.ok) {
        const err = await safeJson(start);
        throw new Error(err?.detail ?? err?.message ?? `Start analysis failed ${start.status}`);
      }
      const startData = await start.json();
      const jid = startData.job_id;
      setJobId(jid);

      // 3) poll
      pollStatus(jid);
    } catch (err) {
      alert((err as Error).message);
      setLoading(false);
    }
  }

  async function safeJson(resp: Response) {
    try {
      return await resp.json();
    } catch {
      return null;
    }
  }

  // ----------------- polling -----------------
  function pollStatus(jid: string) {
    let stopped = false;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`http://127.0.0.1:8000/analysis/${jid}`);
        if (!res.ok) {
          const j = await safeJson(res);
          throw new Error(j?.detail ?? `Status failed ${res.status}`);
        }
        const data = await res.json();

        if (data.status === "processing" && data.progress) {
          setProgress({
            percent: data.progress.percent ?? 0,
            step: data.progress.step ?? "processing",
          });
        } else if (data.status === "pending") {
          setProgress({ percent: 0, step: "queued" });
        } else if (data.status === "completed") {
          setAnalysis(data.result ?? null);
          setProgress(null);
          clearInterval(interval);
          stopped = true;
          setLoading(false);
        } else if (data.status === "failed") {
          clearInterval(interval);
          stopped = true;
          setLoading(false);
          alert("Analysis failed: " + (data.error ?? "unknown"));
        } else {
          setProgress({ percent: 5, step: data.status ?? "working" });
        }
      } catch (err) {
        clearInterval(interval);
        stopped = true;
        setLoading(false);
        console.error("poll error", err);
        alert((err as Error).message);
      }
    }, 1500);

    setTimeout(() => {
      if (!stopped) {
        clearInterval(interval);
        setLoading(false);
      }
    }, 1000 * 60 * 30);
  }

  // ----------------- Render -----------------
  const emotionTag = inferEmotionFromText(analysis?.transcript_text ?? null);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black p-8">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT: upload & video */}
        <div className="lg:col-span-1 bg-white dark:bg-zinc-900 rounded-xl p-6 shadow">
          <h1 className="text-2xl font-semibold mb-4">Upload & Analyze</h1>

          {/* fancy choose file block */}
          <label
            htmlFor="video-file"
            className="flex items-center justify-center flex-col gap-2 border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-lg p-6 cursor-pointer hover:border-zinc-400"
          >
            <svg className="w-10 h-10 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M3 15a4 4 0 004 4h10a4 4 0 004-4V8a4 4 0 00-4-4h-3l-2-2H9L7 4H4a1 1 0 00-1 1v10z" />
            </svg>
            <div className="text-sm text-zinc-600 dark:text-zinc-300">Click to choose a video file</div>
            <div className="text-xs text-zinc-400 dark:text-zinc-500">MP4, MOV, WebM — keep under ~200MB</div>
            <input
              id="video-file"
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f) {
                  try {
                    setVideoURL(URL.createObjectURL(f));
                  } catch {}
                } else {
                  setVideoURL(null);
                }
              }}
            />
          </label>

          <div className="mt-4 flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium">{file?.name ?? "No file selected"}</div>
              <div className="text-xs text-zinc-500">{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : ""}</div>
            </div>
            <button
              disabled={!file || loading}
              onClick={handleUploadAndAnalyze}
              className={`ml-auto px-4 py-2 rounded-lg text-white ${
                file && !loading ? "bg-blue-600 hover:bg-blue-700" : "bg-zinc-300 text-zinc-600"
              }`}
            >
              {loading ? "Analyzing..." : "Analyze"}
            </button>
          </div>

          {/* progress */}
          {progress && (
            <div className="mt-4">
              <div className="flex justify-between mb-1">
                <div className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{progress.step}</div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">{progress.percent}%</div>
              </div>
              <div className="w-full bg-zinc-200 dark:bg-zinc-800 h-3 rounded-full">
                <div className="h-3 rounded-full bg-gradient-to-r from-blue-400 to-blue-600" style={{ width: `${progress.percent}%` }} />
              </div>
            </div>
          )}

          {videoURL && (
            <div className="mt-4">
              <video controls src={videoURL} className="w-full rounded-md border" />
            </div>
          )}
        </div>

        {/* RIGHT: analysis */}
        <div className="lg:col-span-2 bg-white dark:bg-zinc-900 rounded-xl p-6 shadow overflow-auto">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold">Analysis Result</h2>
              <div className="text-sm text-zinc-500">Scenes, transcript, captions</div>
            </div>

            <div>
              <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full ${emotionTag.color}`}>
                <span className={`text-sm font-medium ${emotionTag.textColor}`}>{emotionTag.label.toUpperCase()}</span>
              </div>
            </div>
          </div>

          {!analysis && (
            <div className="mt-6 text-zinc-500">
              No analysis yet. Upload a file and click <b>Analyze</b>.
            </div>
          )}

          {analysis && (
            <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* LEFT: transcript & scenes */}
              <div className="col-span-2 space-y-4">
                {/* Transcript with emotion bars */}
                <div>
                  <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-2">Transcript</h3>
                  <div className="flex flex-col gap-1">
                    {(analysis.transcript_segments || []).map((seg: any, idx: number) => {
                      const emo = inferEmotionFromText(seg.text);
                      return (
                        <div key={idx} className="flex items-center gap-2">
                          <div className={`w-2 h-6 rounded ${emo.color}`} title={emo.label}></div>
                          <div className="text-sm text-zinc-800 dark:text-zinc-100">{seg.text}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Scenes */}
                <div>
                  <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-2">Scenes</h3>
                  <div className="space-y-3">
                    {Array.isArray(analysis.combined_scenes) && analysis.combined_scenes.length > 0 ? (
                      analysis.combined_scenes.map((s: any, idx: number) => (
                        <div key={idx} className="p-3 border rounded-md bg-white dark:bg-zinc-800">
                          <div className="flex justify-between items-start gap-2">
                            <div>
                              <div className="text-sm font-semibold">{s.description ?? "Scene"}</div>
                              <div className="text-xs text-zinc-500">{` ${s.start_time?.toFixed?.(1) ?? s.start_time}s — ${s.end_time?.toFixed?.(1) ?? s.end_time}s`}</div>
                            </div>
                            <div className="text-xs text-zinc-500">#{idx + 1}</div>
                          </div>

                          {Array.isArray(s.dialogue) && s.dialogue.length > 0 && (
                            <details className="mt-2">
                              <summary className="text-xs text-zinc-600 cursor-pointer">Dialogue ({s.dialogue.length})</summary>
                              <div className="mt-2 flex flex-col gap-1">
                                {s.dialogue.map((d: string, i: number) => {
                                  const emo = inferEmotionFromText(d);
                                  return (
                                    <div key={i} className="flex items-center gap-2">
                                      <div className={`w-2 h-5 rounded ${emo.color}`} title={emo.label}></div>
                                      <div className="text-sm text-zinc-800 dark:text-zinc-100">{d}</div>
                                    </div>
                                  );
                                })}
                              </div>
                            </details>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-zinc-500">No scenes detected.</div>
                    )}
                  </div>
                </div>
              </div>

              {/* RIGHT: top frame captions */}
              <div>
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200 mb-2">Top frame captions</h3>
                <div className="space-y-2">
                  {Array.isArray(analysis.frame_captions) && analysis.frame_captions.length > 0 ? (
                    analysis.frame_captions.slice(0, 12).map((c: string, i: number) => (
                      <div key={i} className="text-sm text-zinc-800 dark:text-zinc-100 bg-zinc-50 dark:bg-zinc-800 p-2 rounded">{c}</div>
                    ))
                  ) : (
                    <div className="text-sm text-zinc-500">No captions</div>
                  )}
                </div>

                <div className="mt-4">
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(JSON.stringify(analysis, null, 2));
                      alert("Copied result JSON to clipboard");
                    }}
                    className="px-3 py-2 rounded bg-zinc-100 dark:bg-zinc-800 text-sm"
                  >
                    Copy JSON
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
