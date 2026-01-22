const uploads = require('./initiate-upload').uploads || new Map();

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
    const uploadId = event.queryStringParameters?.id;
    const chunkIndex = parseInt(event.queryStringParameters?.index || '0');

    if (!uploadId) {
      throw new Error('Missing upload ID');
    }

    const upload = uploads.get(uploadId);
    if (!upload) {
      throw new Error('Upload not found');
    }

    // ★ チャンクを保存
    const chunk = event.isBase64Encoded 
      ? Buffer.from(event.body, 'base64')
      : Buffer.from(event.body, 'binary');

    upload.chunks[chunkIndex] = chunk;

    console.log(`[CHUNK] Upload ${uploadId}, chunk ${chunkIndex}, size: ${chunk.length}`);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: true, chunkIndex }),
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};