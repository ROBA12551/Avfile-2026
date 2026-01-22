/**
 * js/video-compression-local.js
 * FFmpeg.wasm v0.8 対応版
 */

class VideoCompressionEngineLocal {
  constructor() {
    this.ffmpeg = null;
    this.ffmpegReady = false;
  }

  async initFFmpeg() {
    if (this.ffmpegReady && this.ffmpeg) {
      console.log('✅ FFmpeg は既に初期化済み');
      return;
    }

    try {
      console.log('⏳ FFmpeg 初期化開始...');
      
      // ★ v0.8: window.FFmpeg.createFFmpeg
      if (!window.FFmpeg || !window.FFmpeg.createFFmpeg) {
        console.error('❌ window.FFmpeg.createFFmpeg が見つかりません');
        console.log('window.FFmpeg:', window.FFmpeg);
        throw new Error('FFmpeg ライブラリが読み込まれていません');
      }

      const { createFFmpeg } = window.FFmpeg;
      
      this.ffmpeg = createFFmpeg({ 
        log: true,
        logger: ({ message }) => {
          console.log('[FFmpeg]', message);
        }
      });

      console.log('⏳ FFmpeg コア（WASM）をロード中...');
      await this.ffmpeg.load();

      this.ffmpegReady = true;
      console.log('✅ FFmpeg 初期化完了');
    } catch (error) {
      console.error('❌ FFmpeg 初期化失敗:', error.message);
      console.error('Stack:', error.stack);
      this.ffmpegReady = false;
      throw error;
    }
  }

  convertToMP4FileName(fileName) {
    if (!fileName) return 'output.mp4';
    if (fileName.toLowerCase().endsWith('.mp4')) return fileName;
    
    const nameWithoutExt = fileName.split('.').slice(0, -1).join('.');
    const newFileName = nameWithoutExt ? `${nameWithoutExt}.mp4` : 'output.mp4';
    
    console.log('[CONVERT] File name:', fileName, '→', newFileName);
    return newFileName;
  }

  async compress(videoFile, onProgress = () => {}) {
    try {
      console.log('[COMPRESS] Starting compression:', {
        name: videoFile.name,
        size: videoFile.size,
        type: videoFile.type,
      });

      const originalFileName = videoFile.name || 'video.mov';
      const mp4FileName = this.convertToMP4FileName(originalFileName);

      try {
        await this.initFFmpeg();
      } catch (error) {
        console.warn('⚠️ FFmpeg 初期化失敗:', error.message);
        onProgress(100, '⚠️ 圧縮スキップ');
        return new File([videoFile], mp4FileName, { type: 'video/mp4' });
      }

      onProgress(10, '📥 ファイル読み込み中...');

      const inputName = 'input.mov';
      const outputName = 'output.mp4';

      // ★ v0.8: write メソッドでファイルを書き込む
      console.log('[COMPRESS] Writing file to FFmpeg FS...');
      await this.ffmpeg.write(inputName, videoFile);
      
      const originalMB = (videoFile.size / 1024 / 1024).toFixed(2);
      console.log(`✅ ファイル読み込み完了: ${originalMB}MB`);

      onProgress(30, '⚙️ 圧縮開始...');

      // ★ v0.8: run メソッドでFFmpegコマンドを実行
      console.log('[COMPRESS] Running FFmpeg...');
      
      await this.ffmpeg.run(
        '-i', inputName,
        '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease',
        '-r', '30',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '28',
        '-c:a', 'aac',
        '-b:a', '96k',
        outputName
      );

      console.log('✅ FFmpeg 実行完了');

      onProgress(80, '📤 圧縮ファイル取得中...');

      // ★ v0.8: read メソッドでファイルを読み取る
      const outputData = await this.ffmpeg.read(outputName);
      console.log('[COMPRESS] Output file read:', outputData.length, 'bytes');

      // ★ クリーンアップ
      try {
        await this.ffmpeg.remove(inputName);
        await this.ffmpeg.remove(outputName);
        console.log('✅ Temporary files cleaned');
      } catch (err) {
        console.warn('[COMPRESS] Cleanup warning:', err.message);
      }

      const compressedBlob = new Blob([outputData.buffer], { type: 'video/mp4' });
      const compressedMB = (compressedBlob.size / 1024 / 1024).toFixed(2);
      const ratio = ((1 - compressedBlob.size / videoFile.size) * 100).toFixed(0);
      
      console.log(`✅ 圧縮完了: ${originalMB}MB → ${compressedMB}MB (${ratio}% 削減)`);

      onProgress(100, `✅ 圧縮完了 (${ratio}% 削減)`);

      return new File([compressedBlob], mp4FileName, { type: 'video/mp4' });
      
    } catch (error) {
      console.error('❌ 圧縮エラー:', error.message);
      console.error('Stack:', error.stack);
      
      const mp4FileName = this.convertToMP4FileName(videoFile.name || 'video.mov');
      onProgress(100, '⚠️ 圧縮失敗');
      
      return new File([videoFile], mp4FileName, { type: 'video/mp4' });
    }
  }

  async cleanup() {
    try {
      if (this.ffmpeg) {
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