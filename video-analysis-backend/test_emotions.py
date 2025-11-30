from analysis_pipeline import analyze_emotions

video_path = "./uploaded_videos/_talkv_wyOnSEO2rI_psYG1YE5xRAz5DNtMHf6I1_talkv_high.mp4"
emotions = analyze_emotions(video_path, sample_rate=1.0)
print(len(emotions), emotions[:3])
