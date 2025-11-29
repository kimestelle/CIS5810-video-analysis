"use client";

import { useState, useEffect } from "react";
import {
  pingBackend,
  uploadVideo,
  startAnalysis,
  getAnalysisStatus,
  AnalyzeVideoResponse,
} from "./api";

export default function Home() {
  const [backendHealth, setBackendHealth] = useState("Checking backend...");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<{ percent: number; step: string } | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalyzeVideoResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const onProgress = (percent: number, step: string) => {
    console.log(`Progress: ${percent}% - ${step}`);
    setProgress({ percent, step });
  }

  useEffect(() => {
    let isMounted = true;
    pingBackend()
      .then((data) => {
        if (isMounted) {
          setBackendHealth(`Hello: ${data.Hello}`);
        }
      })
      .catch((error) => {
        if (isMounted) {
          setBackendHealth(
            `Backend is down, please contact devs: ${error.message}`
          );
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const handleUpload = async () => {
    if (!videoFile) return;
    setLoading(true);
    setAnalysisResult(null);
    try {
      const res = await handleAnalyze(videoFile, onProgress);
      setAnalysisResult(res);
    } catch (error) {
      alert((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  async function handleAnalyze(file: File, onProgress: (p: number, s: string) => void): Promise<AnalyzeVideoResponse> {
    const uploadRes = await uploadVideo(file);
    const { job_id } = await startAnalysis(uploadRes.filename);

    while (true) {
      const status = await getAnalysisStatus(job_id);
      if (status.status === "completed") {
        return status.result;
      }
      if (status.status === "failed") {
        throw new Error(status.error);
      }
      if (status.status === "processing" && status.progress) {
        onProgress(status.progress.percent ?? 0, status.progress.step ?? "processing");
      }
      // poll periodically
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex min-h-screen w-full max-w-3xl flex-col items-center justify-between py-32 px-16 bg-white dark:bg-black sm:items-start">
        <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left">
          <h1 className="max-w-xs text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50">
            Video Analysis
          </h1>
          <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
            Upload a video to receive a comprehensive textual analysis including
            scene descriptions, emotion analysis, and plot summaries.
          </p>
          {backendHealth && (
            <p className="text-green-600 dark:text-green-400">
              {backendHealth}
            </p>
          )}
        </div>

        {progress && (
          <div className="mt-8 w-full">
            <h2 className="mb-2 text-lg font-medium text-black dark:text-zinc-50">
              Analysis Progress:
            </h2>
            <div className="w-full rounded-full bg-zinc-200 dark:bg-zinc-700">
              <div
                className="rounded-full bg-blue-600 py-1 text-center text-sm font-medium text-white"
                style={{ width: `${progress.percent}%` }}
              >
                {progress.step} ({progress.percent}%)
              </div>
            </div>
          </div>
        )}

        {analysisResult && (
          <div className="mt-8 w-full">
            <h2 className="mb-4 text-2xl font-semibold text-black dark:text-zinc-50">
              Analysis Result:
            </h2>
            <pre className="max-h-96 w-full overflow-auto rounded-lg bg-zinc-100 p-4 text-left text-sm text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
              {JSON.stringify(analysisResult, null, 2)}
            </pre>
          </div>
        )}

        <div className="flex flex-col gap-4 text-base font-medium sm:flex-row">
          <input
            type="file"
            accept="video/*"
            className="block w-full text-sm text-zinc-500 file:mr-4 file:rounded-full file:border-0 file:bg-blue-50 file:py-2 file:px-4 file:text-sm file:font-semibold file:text-blue-700 hover:file:bg-blue-100 dark:text-zinc-400 dark:file:bg-zinc-800 dark:file:text-zinc-200 dark:hover:file:bg-zinc-700"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                setVideoFile(e.target.files[0]);
              } else {
                setVideoFile(null);
              }
            }}
          />
          {videoFile && (
            <button
              className="inline-block rounded-full bg-blue-600 px-6 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              onClick={handleUpload}
              disabled={loading}
            >
              {loading ? "Analyzing..." : "Analyze"}
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
