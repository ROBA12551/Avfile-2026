// /js/video-compressor-official.mjs
import { FFmpeg } from "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js";
import { fetchFile } from "https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js";

class VideoCompressor {
  constructor() {
    this.ffmpeg = new FFmpeg();
    this.isLoaded = false;
    this.isLoading = false;

    // ここはアップロード側と揃えるのが理想（テストは1MBなどに下げてもOK）
    this.VIDEO_COMPRESSION_THRESHOLD = 50 * 1024 * 1024; // 50MB

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
    if (this.isLoaded || this.isLoading) {
      console.log("[VIDEO_COMPRESSOR] initFFmpeg skipped (loaded/loading)");
      return;
    }

    this.isLoading = true;

    try {
      const CORE_VERSION = "0.12.10";

      // ✅ 0.12系：FFmpeg.load に coreURL/wasmURL を渡す
      // ※ パスは “dist/umd” が安定（ブラウザでのfetchが通りやすい）
      const coreURL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd/ffmpeg-core.js`;
      const wasmURL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd/ffmpeg-core.wasm`;

      console.log("[VIDEO_COMPRESSOR] Loading core:", coreURL);
      console.log("[VIDEO_COMPRESSOR] Loading wasm:", wasmURL);

      await this.ffmpeg.load({ coreURL, wasmURL });

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

    const name = file.name || "";
    const isVideo =
      (file.type && file.type.startsWith("video/")) ||
      /\.(mp4|mov|mkv|webm|avi|m4v|mpe?g|ts|mts|m2ts|3gp|3g2)$/i.test(name);

    const isLarge = file.size >= this.VIDEO_COMPRESSION_THRESHOLD;
    return isVideo && isLarge;
  }

  async compressVideo(file, onProgress = () => {}) {
    if (!this.isLoaded) throw new Error("FFmpeg not loaded");

    const inputExt = (file.name?.split(".").pop() || "mp4").toLowerCase();
    const inputName = `input.${inputExt}`;
    const outputName = "output.mp4";

    const onProg = ({ progress }) => {
      const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
      onProgress(pct, "Encoding...");
    };

    const onLog = ({ message }) => {
      // 必要ならログを見たい時だけ有効化
      // console.log("[FFMPEG]", message);
    };

    this.ffmpeg.on("progress", onProg);
    this.ffmpeg.on("log", onLog);

    const cleanup = async () => {
      try { await this.ffmpeg.deleteFile(inputName); } catch {}
      try { await this.ffmpeg.deleteFile(outputName); } catch {}
    };

    try {
      onProgress(5, "Reading file...");

      // writeFile: Uint8Array を渡す
      const data = await fetchFile(file);
      await this.ffmpeg.writeFile(inputName, data);

      onProgress(10, "Encoding...");

      const s = this.COMPRESSION_SETTINGS;

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
        "-ar", String(s.audioSampleRate),
        outputName,
      ]);

      onProgress(90, "Finalizing...");

      // readFile: Uint8Array が返る
      const out = await this.ffmpeg.readFile(outputName);
      const blob = new Blob([out.buffer], { type: "video/mp4" });

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
      await cleanup();
      this.ffmpeg.off("progress", onProg);
      this.ffmpeg.off("log", onLog);
    }
  }
}

// ✅ グローバル公開（既存の uploadMultiple から使える）
if (!window.videoCompressor) {
  window.videoCompressor = new VideoCompressor();
  console.log("[VIDEO_COMPRESSOR] Ready (module)");
} else {
  console.warn("[VIDEO_COMPRESSOR] Already exists (module loaded twice?)");
}
