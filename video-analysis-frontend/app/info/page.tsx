import Link from "next/link";
export default function InfoPage() {
  return (
    <div className="min-h-screen bg-zinc-50 egg-background p-8">
      <div className="flex flex-col max-w-6xl mx-auto my-8 text-center">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            {/* info module */}
            <span>I</span>
            <span>n</span>
            <span>f</span>
            <span>o</span>
            <span> </span>
            <span>M</span>
            <span>o</span>
            <span>d</span>
            <span>u</span>
            <span>l</span>
            <span>e</span>
        </h1>

        <p className="mt-4 text-gray-700">
          This tool takes a video, listens to it, looks at it, and lines the two up. you get a readable view of{" "}
          <span className="font-semibold">what was said</span>,{" "}
          <span className="font-semibold">what was on screen</span>, and the{" "}
          <span className="font-semibold">overall emotional tone</span> over time.
        </p>
        <div className="mt-2">
          <Link href="/">
            &larr; home
          </Link>
        </div>
      </div>

      <div className="max-w-6xl mx-auto space-y-10">
        <section className="bg-white/80 rounded-2xl p-6 md:p-8 shadow-sm">
          <h2 className="text-2xl font-semibold mb-4">
            Step-by-Step
          </h2>

          <ol className="space-y-4 text-gray-700 text-sm">
            <li>
              <span className="font-semibold">1. Transcribe Audio</span>
              <br />
              Turn speech into text using a local Whisper model + store each line with a start / end time.
            </li>

            <li>
              <span className="font-semibold">2. Sample Frames</span>
              <br />
              Snapshot frames with OpenCV at a fixed rate of 1 frame per second to capture visual shifts.
            </li>

            <li>
              <span className="font-semibold">3. Caption Frames</span>
              <br />
              Use a BLIP model to describe what&apos;s on screen in a short sentence for every sampled frame.
            </li>

            <li>
              <span className="font-semibold">4. Group frames into scenes</span>
              <br />
              With the SequenceMaster library, cluster frames with similar captions into a longer scene with a start and end time.
            </li>

            <li>
              <span className="font-semibold">5. Pick a caption for each scene</span>
              <br />
              Choose the most representative caption from all frames (using similarity scores, compared each frame to each other frame).
            </li>

            <li>
              <span className="font-semibold">6. Merge speech with image</span>
              <br />
              Use timestamps to pull all transcript lines that happen inside that scene window into a merged data block.
            </li>

            <li>
              <span className="font-semibold">7. Estimate emotions</span>
              <br />
              For each sampled frame, estimate a dominant emotion + scores (happy, sad, surprised, neutral, etc.).
            </li>

            <li>
              <span className="font-semibold">8. Merge emotions with text</span>
              <br />
              Split the transcript into sentences and pair each one with the closest emotion in that timeframe.
            </li>
          </ol>
        </section>

        <section className="bg-white/80 rounded-2xl p-6 md:p-8 shadow-sm">
            <h2 className="text-2xl font-semibold mb-3">Models</h2>
            <ul className="space-y-3 text-gray-700 text-sm">
            <li>
                <span className="font-semibold">Whisper (faster-whisper package)</span>{" "}
                faster-whisper is a reimplementation of OpenAI&apos;s Whisper model using CTranslate2, which is a fast inference engine for Transformer models.
This implementation is up to 4 times faster than openai/whisper for the same accuracy while using less memory. The efficiency can be further improved with 8-bit quantization on both CPU and GPU. (source: faster-whisper GitHub)
            </li>
            <li>
                <span className="font-semibold">
                BLIP image captioning (&quot;Salesforce/blip-image-captioning-base&quot;)
                </span>{" "}
                BLIP (Bootstrapping Language-Image Pre-training) is an advanced multimodal model from Hugging Face, designed to merge Natural Language Processing (NLP) and Computer Vision (CV). By pre-training on millions of image-text pairs, BLIP excels at image captioning, visual question answering (VQA), cross-modal retrieval and more. Its architecture uses transformer-based components that allow effective interactions between text and images, making it valuable for researchers and developers in the AI space. (source: GeeksforGeeks)
            </li>
            <li>
                <span className="font-semibold">
                ViT emotion classifier (&quot;dima806/facial_emotions_image_detection&quot;)
                </span>{" "}
               Vit Emotion Classifier is an AI model that recognizes emotions from images. It was trained on the ImageFolder dataset using a fine-tuned version of the Google ViT-Base model. The model achieved an accuracy of 55% and a loss of 1.3090 on the evaluation set. With a learning rate of 5e-05 and a batch size of 16, it was trained for 50 epochs. Vit Emotion Classifier is designed to efficiently classify emotions in images, making it a valuable tool for applications like sentiment analysis and emotion detection. (source: DataLoop.ai)
            </li>
          </ul>
        </section>

        <section className="bg-white/70 rounded-2xl p-6 md:p-8 shadow-sm">
          <h2 className="text-2xl font-semibold mb-3">
            Notes
          </h2>
          <ul className="space-y-3 text-gray-700 text-sm">
            <li>
              <span className="font-semibold">Emotions, captions, etc. are estimates.</span> they are best guesses from facial features or image matching with a set list of captions.
            </li>
            <li>
              <span className="font-semibold">Lack of deeper recognition.</span> the pipeline can describe scenes and mood, but not idenfity characters.
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
