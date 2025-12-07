/* main page: upload video and  */

"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { AnalyzeVideoResponse, MergedTextEmotion, TranscriptSegment, CombinedScene } from "./api";

// emotion label to UI mappings
function uiForEmotionLabel(label: string | null | undefined) {
  const l = (label || "neutral").toLowerCase();

  if (l.includes("happy") || l.includes("joy")) {
    return { label: "happy", color: "bg-emerald-200", textColor: "text-emerald-800" };
  }
  if (l.includes("sad") || l.includes("angry") || l.includes("fear") || l.includes("disgust")) {
    return { label: "sad/angry", color: "bg-red-200", textColor: "text-red-800" };
  }
  if (l.includes("surprise")) {
    return { label: "surprised", color: "bg-amber-200", textColor: "text-amber-800" };
  }
  return { label: "neutral", color: "bg-gray-200", textColor: "text-gray-800" };
}

// fallback heuristic (for when there are no backend emotions)
function inferEmotionFromText(text: string | null) {
  if (!text || text.trim().length === 0)
    return { label: "neutral", color: "bg-gray-300", textColor: "text-gray-800" };

  const t = text.toLowerCase();

  const positive = ["happy", "joy", "laugh", "love", "smile", "excited", "cheerful", "delight"];
  const negative = ["sad", "angry", "mad", "hate", "upset", "cry", "depressed", "annoy"];
  const surprise = ["wow", "surprise", "surprised", "oh my", "what a"];

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

async function safeJson(resp: Response) {
  try {
    return await resp.json();
  } catch {
    return null;
  }
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [videoURL, setVideoURL] = useState<string | null>(null);

  const [progress, setProgress] = useState<{ percent: number; step: string } | null>(null);

  const [analysis, setAnalysis] = useState< AnalyzeVideoResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    return () => {
      if (videoURL) URL.revokeObjectURL(videoURL);
    };
  }, [videoURL]);

  //helper functions to upload + start analysis and poll for status
  async function handleUploadAndAnalyze() {
    if (!file) return alert("Please choose a video file first.");
    setAnalysis(null);
    setProgress(null);
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

      // 3) poll
      pollStatus(jid);
    } catch (err) {
      alert((err as Error).message);
      setLoading(false);
    }
  }

  // polling
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

  // emotions from backend
  const mergedEmotions: MergedTextEmotion[] | undefined =
    analysis && Array.isArray(analysis.merged_text_emotions)
      ? analysis.merged_text_emotions
      : undefined;

  // pick the most frequent emotion label across merged_text_emotions
  let dominantEmotionLabel: string | null = null;
  if (mergedEmotions && mergedEmotions.length > 0) {
    const counts: Record<string, number> = {};
    for (const m of mergedEmotions) {
      const key = (m.emotion || "neutral").toLowerCase();
      counts[key] = (counts[key] || 0) + 1;
    }
    const entries = Object.entries(counts);
    if (entries.length > 0) {
      entries.sort((a, b) => b[1] - a[1]);
      dominantEmotionLabel = entries[0][0];
    }
  }

  // fallback to text-based heuristic if no backend emotion
  const emotionTag = dominantEmotionLabel
    ? uiForEmotionLabel(dominantEmotionLabel)
    : inferEmotionFromText(analysis?.transcript_text ?? null);

  return (
    <div className="min-h-screen bg-zinc-50 egg-background p-8">
      <div className='flex flex-col justify-center items-center max-w-6xl mx-auto my-8 text-center'>
      <h1>
        {/* Comprehensive Video Analysis */}
        <span>C</span>
        <span>o</span>
        <span>m</span>
        <span>p</span>
        <span>r</span>
        <span>e</span>
        <span>h</span>
        <span>e</span>
        <span>n</span>
        <span>s</span>
        <span>i</span>
        <span>v</span>
        <span>e</span>
        <span> </span>
        <span>V</span>
        <span>i</span>
        <span>d</span>
        <span>e</span>
        <span>o</span>
        <span> </span>
        <span>A</span>
        <span>n</span>
        <span>a</span>
        <span>l</span>
        <span>y</span>
        <span>s</span>
        <span>i</span>
        <span>s</span>
      </h1>
      <p>by <span className="font-semibold">Ji Yoon Kang & Estelle Kim</span></p>
      <p className='max-w-2xl mt-4'>
        Upload a video file to analyze scenes, generate transcripts, extract captions, and detect emotions. Use a video including dialogue and human faces to experience the full features!
      </p>
      <p className='max-w-2xl mt-4'>
        A pipeline of local ML models will process your video and provide detailed insights.
      </p>
      <p className='max-w-2xl mt-4'>
        More info <span><Link href="/info">here &rarr;</Link></span>
      </p>
      </div>
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT: upload & video */}
        <div className="lg:col-span-1 bg-white/80 rounded-xl p-6 shadow">

          <label
            htmlFor="video-file"
            className="flex items-center justify-center flex-col gap-2 border-2 border-dashed border-zinc-300 rounded-lg p-6 cursor-pointer hover:border-zinc-400"
          >
            <svg className="w-10 h-10 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 15a4 4 0 004 4h10a4 4 0 004-4V8a4 4 0 00-4-4h-3l-2-2H9L7 4H4a1 1 0 00-1 1v10z"
              />
            </svg>
            <div className="text-sm text-zinc-600">Click to choose a video file</div>
            <div className="text-xs text-zinc-400">MP4, MOV, WebM — keep under ~200MB</div>
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

          {progress && (
            <div className="mt-4">
              <div className="flex justify-between mb-1">
                <div className="text-sm font-medium text-zinc-700">{progress.step}</div>
                <div className="text-sm text-zinc-600">{progress.percent}%</div>
              </div>
              <div className="w-full bg-zinc-200 h-3 rounded-full">
                <div
                  className="h-3 rounded-full bg-gradient-to-r from-blue-400 to-blue-600"
                  style={{ width: `${progress.percent}%` }}
                />
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
        <div className="lg:col-span-2 bg-white/80 rounded-xl p-6 shadow overflow-auto">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold">Analysis Result</h2>
              <div className="text-sm text-zinc-500">Scenes, transcript, captions, emotions</div>
            </div>

            <div>
              <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full ${emotionTag.color}`}>
                <span className={`text-sm font-medium ${emotionTag.textColor}`}>
                  {emotionTag.label.toUpperCase()}
                </span>
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
                {/* Transcript with emotion bars driven by merged_text_emotions if available */}
                <div>
                  <h3 className="text-sm font-semibold text-zinc-700 mb-2">Transcript</h3>
                  <div className="flex flex-col gap-1">
                    {(analysis.transcript_segments || []).map((seg: TranscriptSegment, idx: number) => {
                      const merged = mergedEmotions?.[idx];
                      const emo = merged
                        ? uiForEmotionLabel(merged.emotion)
                        : inferEmotionFromText(seg.text);
                      return (
                        <div key={idx} className="flex items-center gap-2">
                          <div className={`w-2 h-6 rounded ${emo.color}`} title={emo.label}></div>
                          <div className="text-sm text-zinc-800">{seg.text}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Scenes */}
                <div>
                  <h3 className="text-sm font-semibold text-zinc-700 mb-2">Scenes</h3>
                  <div className="space-y-3">
                    {Array.isArray(analysis.combined_scenes) && analysis.combined_scenes.length > 0 ? (
                      analysis.combined_scenes.map((s: CombinedScene, idx: number) => (
                        <div key={idx} className="p-3 border rounded-md bg-white/80">
                          <div className="flex justify-between items-start gap-2">
                            <div>
                              <div className="text-sm font-semibold">{s.description ?? "Scene"}</div>
                              <div className="text-xs text-zinc-500">
                                {`${s.start_time?.toFixed?.(1) ?? s.start_time}s — ${
                                  s.end_time?.toFixed?.(1) ?? s.end_time
                                }s`}
                              </div>
                            </div>
                            <div className="text-xs text-zinc-500">#{idx + 1}</div>
                          </div>

                          {Array.isArray(s.dialogue) && s.dialogue.length > 0 && (
                            <details className="mt-2">
                              <summary className="text-xs text-zinc-600 cursor-pointer">
                                Dialogue ({s.dialogue.length})
                              </summary>
                              <div className="mt-2 flex flex-col gap-1">
                                {s.dialogue.map((d: string, i: number) => {
                                  const emo = inferEmotionFromText(d);
                                  return (
                                    <div key={i} className="flex items-center gap-2">
                                      <div className={`w-2 h-5 rounded ${emo.color}`} title={emo.label}></div>
                                      <div className="text-sm text-zinc-800">{d}</div>
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

              {/* RIGHT: captions + emotion timeline */}
              <div>
                <h3 className="text-sm font-semibold text-zinc-700 mb-2">
                  Top frame captions
                </h3>
                <div className="space-y-2">
                  {Array.isArray(analysis.frame_captions) && analysis.frame_captions.length > 0 ? (
                    analysis.frame_captions.slice(0, 12).map((c: string, i: number) => (
                      <div
                        key={i}
                        className="text-sm text-zinc-800 bg-zinc-50 p-2 rounded"
                      >
                        {c}
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-zinc-500">No captions</div>
                  )}
                </div>

                {/* Emotion timeline from merged_text_emotions */}
                <div className="mt-6">
                  <h3 className="text-sm font-semibold text-zinc-700 mb-2">
                    Emotion timeline
                  </h3>
                  {mergedEmotions && mergedEmotions.length > 0 ? (
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                      {mergedEmotions.map((m: MergedTextEmotion, i: number) => {
                        const ui = uiForEmotionLabel(m.emotion);
                        return (
                          <div key={i} className="flex items-start gap-2 text-xs">
                            <div className={`w-2 h-5 rounded ${ui.color}`} title={ui.label}></div>
                            <div className="flex-1">
                              <div className="flex justify-between">
                                <span className={`font-medium ${ui.textColor}`}>{ui.label}</span>
                                {m.time != null && (
                                  <span className="text-[10px] text-zinc-500">
                                    {m.time.toFixed(1)}s
                                  </span>
                                )}
                              </div>
                              <div className="text-zinc-700">
                                {shortText(m.text, 120)}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-xs text-zinc-500">No emotion data.</div>
                  )}
                </div>

                <div className="mt-4">
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(JSON.stringify(analysis, null, 2));
                      alert("Copied result JSON to clipboard");
                    }}
                    className="px-3 py-2 rounded bg-zinc-100 text-sm"
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
