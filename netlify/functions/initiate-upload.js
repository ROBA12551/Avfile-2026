const crypto = require('crypto');

const uploads = new Map(); // メモリ内一時ストレージ

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: '',
    };
  }

  try {
    const { fileName, uploadUrl } = JSON.parse(event.body);

    // ★ アップロードIDを生成
    const uploadId = crypto.randomBytes(16).toString('hex');

    // ★ アップロード情報を保存
    uploads.set(uploadId, {
      fileName,
      uploadUrl,
      chunks: [],
      createdAt: Date.now(),
    });

    console.log('[INITIATE] Upload ID:', uploadId);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ 
        success: true, 
        uploadId,
        chunkUploadUrl: `/.netlify/functions/upload-chunk?id=${uploadId}`
      }),
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};