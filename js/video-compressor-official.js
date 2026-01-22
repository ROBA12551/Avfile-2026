// /js/video-compressor-official.mjs
import { FFmpeg } from "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js";
import { fetchFile } from "https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js";

class VideoCompressor {
  constructor() {
    this.ffmpeg = new FFmpeg();
    this.isLoaded = false;
    this.isLoading = false;

    this.VIDEO_COMPRESSION_THRESHOLD = 50 * 1024 * 1024; // 50MB（必要に応じて調整）

    this.COMPRESSION_SETTINGS = {
      resolution: "1280x720",
      fps: 30,
      videoBitrate: "800k",
      audioBitrate: "64k",
      audioSampleRate: "44100",
      codec: "libx264",
      preset: "faster",
      crf: 23,
    };

    console.log("[VIDEO_COMPRESSOR] Class initialized (FFmpeg class mode)");
  }

  async initFFmpeg() {
    if (this.isLoaded || this.isLoading) return;
    this.isLoading = true;

    try {
      // ドキュメントの load config（coreURL/wasmURL/workerURL） :contentReference[oaicite:2]{index=2}
      const CORE_VERSION = "0.12.10";
      await this.ffmpeg.load({
        coreURL: `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd/ffmpeg-core.js`,
        wasmURL: `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd/ffmpeg-core.wasm`,
        // workerURL は “mt版” を使うときに必要（今回は単純化して省略でもOK）
        // workerURL: `https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@${CORE_VERSION}/dist/umd/ffmpeg-core.worker.js`,
      });

      this.isLoaded = true;
      console.log("[VIDEO_COMPRESSOR] ✓ FFmpeg LOADED");
    } catch (e) {
      console.error("[VIDEO_COMPRESSOR] ✗ Failed to load FFmpeg:", e?.message || e);
      this.isLoaded = false;
    } finally {
      this.isLoading = false;
    }
  }

  shouldCompress(file) {
    if (!file) return false;
    const isVideo = (file.type && file.type.startsWith("video/")) || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(file.name || "");
    const isLarge = file.size >= this.VIDEO_COMPRESSION_THRESHOLD;
    return isVideo && isLarge;
  }

  async compressVideo(file, onProgress = () => {}) {
    if (!this.isLoaded) throw new Error("FFmpeg not loaded");

    const inputExt = (file.name?.split(".").pop() || "mp4").toLowerCase();
    const inputName = `input.${inputExt}`;
    const outputName = "output.mp4";

    // progress/log（ドキュメント） :contentReference[oaicite:3]{index=3}
    const onProg = ({ progress }) => {
      const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
      onProgress(pct, "Encoding...");
    };
    const onLog = ({ message }) => {
      // 必要なら message 解析してUIへ
      // console.log("[FFMPEG]", message);
    };

    this.ffmpeg.on("progress", onProg);
    this.ffmpeg.on("log", onLog);

    try {
      onProgress(5, "Reading file...");
      await this.ffmpeg.writeFile(inputName, await fetchFile(file)); // :contentReference[oaicite:4]{index=4}

      onProgress(10, "Encoding...");

      const s = this.COMPRESSION_SETTINGS;
      // exec は args 配列で実行 :contentReference[oaicite:5]{index=5}
      await this.ffmpeg.exec([
        "-i", inputName,
        "-vf", `scale=${s.resolution}`,
        "-r", String(s.fps),
        "-c:v", s.codec,
        "-preset", s.preset,
        "-crf", String(s.crf),
        "-b:v", s.videoBitrate,
        "-c:a", "aac",
        "-b:a", s.audioBitrate,
        "-ar", s.audioSampleRate,
        outputName,
      ]);

      onProgress(90, "Finalizing...");

      const data = await this.ffmpeg.readFile(outputName, "binary"); // :contentReference[oaicite:6]{index=6}
      const blob = new Blob([data.buffer], { type: "video/mp4" });

      const originalSize = file.size;
      const compressedSize = blob.size;
      const ratio = ((1 - compressedSize / originalSize) * 100).toFixed(1);

      onProgress(100, `Done (${ratio}% reduction)`);

      return {
        blob,
        originalSize,
        compressedSize,
        compressionRatio: ratio,
        fileName: `compressed_${(file.name || "video").replace(/\.[^.]+$/, "")}.mp4`,
      };
    } finally {
      // イベント解除
      this.ffmpeg.off("progress", onProg);
      this.ffmpeg.off("log", onLog);
    }
  }
}

// window に生やして既存コード（uploadMultiple）から使えるようにする
if (!window.videoCompressor) {
  window.videoCompressor = new VideoCompressor();
  console.log("[VIDEO_COMPRESSOR] Ready (module)");
}
