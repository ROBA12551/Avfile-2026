/**
 * js/video-compressor-official.js
 * ★ FFmpeg.wasm 完全準拠版（CDN読み込み + createFFmpeg/fetchFile）
 */

(function () {
  class VideoCompressor {
    constructor() {
      this.ffmpeg = null;
      this.isLoaded = false;
      this.isLoading = false;

      this.VIDEO_COMPRESSION_THRESHOLD = 50 * 1024 * 1024; // 50MB

      this.COMPRESSION_SETTINGS = {
        resolution: '1280x720',
        fps: 30,
        videoBitrate: '800k',
        audioBitrate: '64k',
        audioSampleRate: '44100',
        codec: 'libx264',
        preset: 'faster',
        crf: 23
      };

      this.SUPPORTED_VIDEO_FORMATS = {
        'mp4': 'video/mp4',
        'mov': 'video/quicktime',
        'avi': 'video/x-msvideo',
        'mkv': 'video/x-matroska',
        'webm': 'video/webm',
        'ogv': 'video/ogg',
        'ogg': 'video/ogg',
        'flv': 'video/x-flv',
        'wmv': 'video/x-ms-wmv',
        '3gp': 'video/3gpp',
        '3g2': 'video/3gpp2',
        'ts': 'video/mp2t',
        'm2ts': 'video/mp2t',
        'mts': 'video/mp2t',
        'mpg': 'video/mpeg',
        'mpeg': 'video/mpeg',
        'm4v': 'video/x-m4v',
        'asf': 'video/x-ms-asf',
        'vob': 'video/x-vob'
      };

      console.log('[VIDEO_COMPRESSOR] Class initialized');
    }

    // ★ ここで初めて FFmpeg を参照する（重要）
    _getFFmpegAPI() {
      const api = window.FFmpeg;
      if (!api) throw new Error('FFmpeg global not found (ffmpeg.min.js not loaded)');
      if (!api.createFFmpeg) throw new Error('FFmpeg.createFFmpeg not found');
      if (!api.fetchFile) throw new Error('FFmpeg.fetchFile not found');
      return api;
    }

    async initFFmpeg() {
      if (this.isLoaded || this.isLoading) return;

      this.isLoading = true;
      try {
        console.log('[VIDEO_COMPRESSOR] Creating FFmpeg instance...');

        const { createFFmpeg } = this._getFFmpegAPI();

        this.ffmpeg = createFFmpeg({
          log: true,
          corePath: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/ffmpeg-core.js'
        });

        console.log('[VIDEO_COMPRESSOR] Loading FFmpeg core...');
        await this.ffmpeg.load();

        this.isLoaded = true;
        console.log('[VIDEO_COMPRESSOR] ✓✓✓ FFmpeg LOADED SUCCESSFULLY ✓✓✓');
      } catch (e) {
        console.error('[VIDEO_COMPRESSOR] ✗ Failed to initialize FFmpeg:', e?.message || e);
        this.isLoaded = false;
      } finally {
        this.isLoading = false;
      }
    }

    shouldCompress(file) {
      if (!this.isLoaded) return false;

      const ext = this.getFileExtension(file?.name).toLowerCase();
      const isVideoFile =
        (file?.type && file.type.startsWith('video/')) ||
        Boolean(this.SUPPORTED_VIDEO_FORMATS[ext]);

      const isLargeFile = file?.size > this.VIDEO_COMPRESSION_THRESHOLD;
      return isVideoFile && isLargeFile;
    }

    async compressVideo(file, onProgress = () => {}) {
      if (!this.isLoaded) {
        throw new Error('FFmpeg not loaded');
      }

      const { fetchFile } = this._getFFmpegAPI();

      try {
        const inputExt = this.getFileExtension(file.name);
        const outputFormat = this.getOutputFormat(file.name);
        const inputFileName = `input.${inputExt}`;
        const outputFileName = `output.${outputFormat}`;

        console.log('[VIDEO_COMPRESSOR] Starting compression:', file.name);
        onProgress(5, 'Reading file...');

        const fileData = await fetchFile(file);
        this.ffmpeg.FS('writeFile', inputFileName, fileData);

        onProgress(10, 'Encoding...');

        const audioCodec = this.getAudioCodec(outputFormat);

        await this.ffmpeg.run(
          '-i', inputFileName,
          '-vf', `scale=${this.COMPRESSION_SETTINGS.resolution}`,
          '-r', String(this.COMPRESSION_SETTINGS.fps),
          '-c:v', this.COMPRESSION_SETTINGS.codec,
          '-preset', this.COMPRESSION_SETTINGS.preset,
          '-crf', String(this.COMPRESSION_SETTINGS.crf),
          '-b:v', this.COMPRESSION_SETTINGS.videoBitrate,
          '-c:a', audioCodec,
          '-b:a', this.COMPRESSION_SETTINGS.audioBitrate,
          '-ar', this.COMPRESSION_SETTINGS.audioSampleRate,
          outputFileName
        );

        onProgress(85, 'Finalizing...');

        const data = this.ffmpeg.FS('readFile', outputFileName);
        const mimeType = this.getMimeType(outputFormat);
        const compressedBlob = new Blob([data.buffer], { type: mimeType });

        // cleanup
        this.ffmpeg.FS('unlink', inputFileName);
        this.ffmpeg.FS('unlink', outputFileName);

        const originalSize = file.size;
        const compressedSize = compressedBlob.size;
        const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(1);

        console.log('[VIDEO_COMPRESSOR] ✓ Compressed:', compressionRatio + '%');
        onProgress(100, `Done! (${compressionRatio}% reduction)`);

        return {
          blob: compressedBlob,
          originalSize,
          compressedSize,
          compressionRatio,
          fileName: `compressed_${this.getFileNameWithoutExt(file.name)}.${outputFormat}`,
          outputFormat
        };
      } catch (e) {
        console.error('[VIDEO_COMPRESSOR] ✗ Compression failed:', e?.message || e);
        throw e;
      }
    }

    getFileExtension(fileName) {
      if (!fileName || typeof fileName !== 'string') return 'mp4';
      return fileName.split('.').pop().toLowerCase();
    }

    getOutputFormat(inputFileName) {
      const ext = this.getFileExtension(inputFileName);
      if (ext === 'webm' || ext === 'ogv' || ext === 'ogg') return ext;
      return 'mp4';
    }

    getAudioCodec(outputFormat) {
      switch (outputFormat) {
        case 'webm': return 'libopus';
        case 'ogv':
        case 'ogg': return 'libvorbis';
        default: return 'aac';
      }
    }

    getMimeType(format) {
      const mimeMap = {
        mp4: 'video/mp4',
        webm: 'video/webm',
        ogv: 'video/ogg',
        ogg: 'video/ogg',
        mov: 'video/quicktime',
        avi: 'video/x-msvideo',
        mkv: 'video/x-matroska'
      };
      return mimeMap[format] || 'video/mp4';
    }

    getFileNameWithoutExt(fileName) {
      if (!fileName || typeof fileName !== 'string') return 'file';
      const idx = fileName.lastIndexOf('.');
      return idx === -1 ? fileName : fileName.slice(0, idx);
    }
  }

  // ★ 二重読み込みガード（これで createFFmpeg already declared 系も潰せる）
  if (!window.videoCompressor) {
    window.videoCompressor = new VideoCompressor();
    console.log('[VIDEO_COMPRESSOR] Ready');
  } else {
    console.warn('[VIDEO_COMPRESSOR] videoCompressor already exists (script loaded twice?)');
  }
})();
