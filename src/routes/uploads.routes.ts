import express from "express";
import { S3Service } from "../services/uploads/s3.service";

const router = express.Router();
const s3Service = new S3Service();

const MAX_UPLOAD_SIZE_BYTES = parseInt(process.env.MAX_UPLOAD_SIZE_BYTES || String(10 * 1024 * 1024), 10);

interface PresignRequest {
  filename: string;
  contentType: string;
  sizeBytes?: number;
}

/**
 * Returns a short-lived presigned PUT URL so clients can upload images
 * straight to S3 without credentials.
 */
router.post("/presign", async (req, res) => {
  try {
    const user_id = req.headers["x-user-id"] as string;
    if (!user_id) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { filename, contentType, sizeBytes } = req.body as PresignRequest;

    if (!filename || !contentType) {
      return res.status(400).json({ error: "filename and contentType are required" });
    }

    if (!s3Service.isContentTypeAllowed(contentType)) {
      return res.status(400).json({
        error: "Only image/jpeg, image/png and image/webp uploads are allowed",
      });
    }

    if (sizeBytes !== undefined && sizeBytes > MAX_UPLOAD_SIZE_BYTES) {
      return res.status(413).json({ error: "Payload Too Large" });
    }

    const { uploadUrl, key, cdnUrl, expiresIn } = await s3Service.getPresignedUploadUrl(
      user_id,
      contentType
    );

    return res.status(200).json({
      uploadUrl,
      key,
      cdnUrl,
      expiresIn,
    });
  } catch (err) {
    console.error("[presign] error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
