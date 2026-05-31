const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { cloudinary: cloudinaryConfig, storageType } = require('../config/env');

const uploadsRoot = path.join(__dirname, '..', 'uploads', 'chat-media');

const ensureUploadsDir = async () => {
  await fs.promises.mkdir(uploadsRoot, { recursive: true });
};

const generateFileName = (originalName) => {
  const extension = path.extname(originalName) || '';
  return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extension}`;
};

const uploadLocal = async ({ fileName, mimeType, buffer }) => {
  const generatedName = generateFileName(fileName);
  await ensureUploadsDir();

  const absolutePath = path.join(uploadsRoot, generatedName);
  await fs.promises.writeFile(absolutePath, buffer);

  return {
    storageType: 'local',
    bucketType: 'local',
    storageId: generatedName,
    fileName: generatedName,
    storagePath: absolutePath,
    publicUrl: `/uploads/chat-media/${generatedName}`,
    mimeType
  };
};

const getCloudinaryClient = () => {
  if (!cloudinaryConfig.cloudName || !cloudinaryConfig.apiKey || !cloudinaryConfig.apiSecret) {
    throw new Error('Cloudinary storage is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.');
  }

  // Lazy load so local storage can still work even if Cloudinary dependency is not installed.
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const { v2: cloudinary } = require('cloudinary');

  cloudinary.config({
    cloud_name: cloudinaryConfig.cloudName,
    api_key: cloudinaryConfig.apiKey,
    api_secret: cloudinaryConfig.apiSecret
  });

  return cloudinary;
};

const uploadCloudinary = async ({ fileName, mimeType, buffer, category }) => {
  const cloudinary = getCloudinaryClient();
  const generatedName = generateFileName(fileName);
  const publicId = generatedName.replace(path.extname(generatedName), '');
  const dataUri = `data:${mimeType};base64,${buffer.toString('base64')}`;

  const uploadResult = await cloudinary.uploader.upload(dataUri, {
    folder: cloudinaryConfig.folder,
    public_id: publicId,
    resource_type: category === 'image' ? 'image' : 'raw'
  });

  return {
    storageType: 'cloudinary',
    bucketType: 'cloudinary',
    storageId: uploadResult.public_id,
    fileName: generatedName,
    storagePath: uploadResult.secure_url,
    publicUrl: uploadResult.secure_url,
    mimeType: uploadResult.resource_type === 'raw' ? mimeType : uploadResult.format ? `${mimeType.split('/')[0]}/${uploadResult.format}` : mimeType
  };
};

const uploadMediaBuffer = async ({ fileName, mimeType, buffer, category }) => {
  if (storageType === 'cloudinary') {
    return uploadCloudinary({ fileName, mimeType, buffer, category });
  }

  return uploadLocal({ fileName, mimeType, buffer, category });
};

module.exports = {
  uploadMediaBuffer
};
