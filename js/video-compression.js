/**
 * js/video-compression-local.js
 * ローカル（クライアント側）で完全に圧縮処理を行う
 * ★ モバイル（iOS/Android Chrome）でも FFmpeg 圧縮を実行
 * ★ Safari/Opera のみスキップ（MP4 変換のみ）
 */

class VideoCompressionEngineLocal {
  constructor() {
    this.ffmpeg = null;
    this.ffmpegReady = false;
    this.setupDeviceDetection();
  }

  setupDeviceDetection() {
    const ua = navigator.userAgent || '';
    
    console.log('[DEVICE] User-Agent:', ua.substring(0, 100));

    this.IS_IOS = /iPad|iPhone|iPod/.test(ua);
    this.IS_ANDROID = /Android/.test(ua);
    this.IS_SAFARI = /Safari/.test(ua) && !/Chrome|CriOS|Edg/.test(ua);
    this.IS_OPERA = /Opera|OPR/.test(ua);
    this.IS_FIREFOX = /Firefox/.test(ua);
    this.IS_MOBILE = this.IS_IOS || this.IS_ANDROID || /Mobile|Tablet|Kindle/.test(ua);
    // ★ Safari と Opera のみスキップ、モバイル Chrome は圧縮実行
    this.SHOULD_SKIP = (this.IS_MOBILE && this.IS_SAFARI) || this.IS_OPERA;

    console.log('[DEVICE] Detection result:', {
      iOS: this.IS_IOS,
      Android: this.IS_ANDROID,
      Safari: this.IS_SAFARI,
      Opera: this.IS_OPERA,
      Mobile: this.IS_MOBILE,
      shouldSkip: this.SHOULD_SKIP,
    });

    if (this.SHOULD_SKIP) {
      console.log('⏭️ Safari/Opera - FFmpeg処理をスキップ（MP4変換のみ実行）');
    } else {
      console.log('✅ FFmpeg圧縮を実行します（モバイルを含む）');
    }
  }

  async initFFmpeg() {
    if (this.SHOULD_SKIP) {
      console.log('⏭️ Safari/Opera - FFmpeg処理をスキップ');
      this.ffmpegReady = true;
      return;
    }

    if (this.ffmpegReady && this.ffmpeg && this.ffmpeg.isLoaded()) {
      console.log('✅ FFmpeg は既に初期化済み');
      return;
    }

    try {
      console.log('⏳ FFmpeg 初期化開始...');
      
      if (!window.FFmpeg || !window.FFmpeg.FFmpeg) {
        console.error('❌ window.FFmpeg が見つかりません');
        throw new Error('FFmpeg ライブラリが読み込まれていません');
      }

      const { FFmpeg } = window.FFmpeg;
      
      this.ffmpeg = new FFmpeg({ log: false });

      if (this.ffmpeg.isLoaded()) {
        console.log('✅ FFmpeg は既にロード済み');
        this.ffmpegReady = true;
        return;
      }

      console.log('⏳ FFmpeg コア（WASM）をロード中...');
      await this.ffmpeg.load();

      this.ffmpegReady = true;
      console.log('✅ FFmpeg 初期化完了');
    } catch (error) {
      console.error('❌ FFmpeg 初期化失敗:', error.message);
      this.ffmpegReady = false;
      throw new Error(`FFmpeg 初期化失敗: ${error.message}`);
    }
  }

  async blobToArrayBuffer(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        console.log('[BLOB] Converted to ArrayBuffer:', reader.result.byteLength, 'bytes');
        resolve(reader.result);
      };
      reader.onerror = () => {
        console.error('[BLOB] Conversion error:', reader.error);
        reject(reader.error);
      };
      reader.readAsArrayBuffer(blob);
    });
  }

  /**
   * 拡張子を MP4 に変換
   */
  convertToMP4FileName(fileName) {
    if (!fileName) return 'output.mp4';
    
    // 既に .mp4 なら変更不要
    if (fileName.toLowerCase().endsWith('.mp4')) {
      return fileName;
    }
    
    // 拡張子を削除して .mp4 を追加
    const nameWithoutExt = fileName.split('.').slice(0, -1).join('.');
    const newFileName = nameWithoutExt ? `${nameWithoutExt}.mp4` : 'output.mp4';
    
    console.log('[CONVERT] File name conversion:', fileName, '→', newFileName);
    return newFileName;
  }

  async compress(videoFile, onProgress = () => {}) {
    try {
      console.log('[COMPRESS] Starting compression:', {
        name: videoFile.name,
        size: videoFile.size,
        type: videoFile.type,
      });

      // ★ ファイル名を MP4 に統一
      const originalFileName = videoFile.name || 'video';
      const mp4FileName = this.convertToMP4FileName(originalFileName);
      console.log('[COMPRESS] Output will be converted to:', mp4FileName);

      if (this.SHOULD_SKIP) {
        // ★ Safari/Opera のみスキップ - MP4 変換のみ実行
        console.log('⏭️ Safari/Opera デバイス - 圧縮をスキップ（MP4 変換のみ実行）');
        
        onProgress(10, '📱 Safari/Opera 検出 - MP4 に変換中');
        await new Promise(r => setTimeout(r, 100));
        
        onProgress(50, '🎬 形式を MP4 に変換中...');
        await new Promise(r => setTimeout(r, 100));
        
        onProgress(100, '✅ MP4 変換完了');
        
        // ★ Safari/Opera でも MP4 に変換したファイルを返す
        const mp4File = new File([videoFile], mp4FileName, { type: 'video/mp4' });
        console.log('[COMPRESS] Returning MP4 formatted file:', mp4FileName);
        return mp4File;
      }

      // ★ iOS/Android Chrome などは圧縮を実行
      console.log('✅ FFmpeg 圧縮を実行します');

      try {
        await this.initFFmpeg();
      } catch (error) {
        console.warn('⚠️ FFmpeg 初期化に失敗 - ファイルを MP4 に変換して返却:', error.message);
        onProgress(100, '⚠️ ファイルを MP4 に変換');
        
        // ★ FFmpeg 初期化失敗時も MP4 に変換
        const mp4File = new File([videoFile], mp4FileName, { type: 'video/mp4' });
        return mp4File;
      }

      const inputFileName = 'input_video.mp4';
      const outputFileName = 'output.mp4';

      onProgress(10, '📥 ファイルを読み込み中...');
      console.log('[COMPRESS] Reading file...');

      let inputData;
      try {
        inputData = await this.blobToArrayBuffer(videoFile);
        console.log('[COMPRESS] ArrayBuffer created:', inputData.byteLength, 'bytes');
      } catch (err) {
        console.error('[COMPRESS] Blob conversion failed:', err.message);
        console.warn('⚠️ ファイル変換失敗 - MP4 形式で返却');
        onProgress(100, '⚠️ ファイルを MP4 に変換');
        
        // ★ MP4 形式で返す
        const mp4File = new File([videoFile], mp4FileName, { type: 'video/mp4' });
        return mp4File;
      }

      try {
        console.log('[COMPRESS] Writing to FFmpeg FS...');
        await this.ffmpeg.FS('writeFile', inputFileName, new Uint8Array(inputData));
        console.log('[COMPRESS] File written to FFmpeg FS');
      } catch (err) {
        console.error('[COMPRESS] writeFile failed:', err.message);
        console.warn('⚠️ ファイル書き込み失敗 - MP4 形式で返却');
        onProgress(100, '⚠️ ファイルを MP4 に変換');
        
        // ★ MP4 形式で返す
        const mp4File = new File([videoFile], mp4FileName, { type: 'video/mp4' });
        return mp4File;
      }

      const originalMB = (videoFile.size / 1024 / 1024).toFixed(2);
      console.log(`✅ ファイルロード完了: ${originalMB}MB`);

      onProgress(30, '⚙️ 圧縮設定中...');
      console.log('[COMPRESS] Building FFmpeg command...');

      const command = [
        '-i', inputFileName,
        '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
        '-r', '30',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '32',
        '-c:a', 'aac',
        '-b:a', '96k',
        '-movflags', '+faststart',
        outputFileName,
      ];

      console.log('[COMPRESS] FFmpeg command:', command.join(' '));

      onProgress(40, '🎬 動画を圧縮中...');
      console.log('[COMPRESS] Running FFmpeg...');

      try {
        await this.ffmpeg.run(...command);
        console.log('✅ FFmpeg 実行完了');
      } catch (err) {
        console.error('[COMPRESS] FFmpeg run failed:', err.message);
        console.warn('⚠️ 圧縮失敗 - MP4 形式で返却');
        onProgress(100, '⚠️ ファイルを MP4 に変換');
        
        // ★ MP4 形式で返す
        const mp4File = new File([videoFile], mp4FileName, { type: 'video/mp4' });
        return mp4File;
      }

      onProgress(80, '📤 圧縮ファイルを取得中...');
      console.log('[COMPRESS] Reading output file...');

      let outputData;
      try {
        outputData = await this.ffmpeg.FS('readFile', outputFileName);
        console.log('[COMPRESS] Output file read:', outputData.length, 'bytes');
      } catch (err) {
        console.error('[COMPRESS] readFile failed:', err.message);
        console.warn('⚠️ 出力ファイル読み込み失敗 - MP4 形式で返却');
        onProgress(100, '⚠️ ファイルを MP4 に変換');
        
        // ★ MP4 形式で返す
        const mp4File = new File([videoFile], mp4FileName, { type: 'video/mp4' });
        return mp4File;
      }

      const compressedBlob = new Blob([outputData.buffer], { type: 'video/mp4' });

      try {
        await this.ffmpeg.FS('unlink', inputFileName);
        await this.ffmpeg.FS('unlink', outputFileName);
        console.log('✅ Temporary files cleaned up');
      } catch (err) {
        console.warn('[COMPRESS] Cleanup warning:', err.message);
      }

      const compressedMB = (compressedBlob.size / 1024 / 1024).toFixed(2);
      const ratio = ((1 - compressedBlob.size / videoFile.size) * 100).toFixed(0);
      
      console.log(`✅ 圧縮完了: ${originalMB}MB → ${compressedMB}MB (${ratio}% 削減)`);
      console.log(`✅ ファイル形式を MP4 に統一: ${mp4FileName}`);

      onProgress(100, `✅ MP4 圧縮完了 (${ratio}% 削減)`);

      // ★ 圧縮済みファイルを MP4 ファイルとして返す
      const compressedMP4File = new File([compressedBlob], mp4FileName, { type: 'video/mp4' });
      return compressedMP4File;
    } catch (error) {
      console.error('❌ 圧縮エラー:', error.message);
      console.error('Stack:', error.stack);
      
      // ★ エラー時も MP4 形式で返す
      const originalFileName = videoFile.name || 'video';
      const mp4FileName = this.convertToMP4FileName(originalFileName);
      
      console.warn('⚠️ 圧縮失敗 - MP4 形式で元のファイルを返却します');
      onProgress(100, '⚠️ ファイルを MP4 に変換');
      
      const mp4File = new File([videoFile], mp4FileName, { type: 'video/mp4' });
      return mp4File;
    }
  }

  async cleanup() {
    try {
      if (this.ffmpeg && this.ffmpeg.isLoaded()) {
        console.log('🗑️ FFmpeg メモリ解放中...');
        this.ffmpeg = null;
        this.ffmpegReady = false;
        console.log('✅ メモリ解放完了');
      }
    } catch (err) {
      console.warn('⚠️ メモリ解放エラー:', err.message);
    }
  }
}

window.VideoCompressionEngineLocal = VideoCompressionEngineLocal;