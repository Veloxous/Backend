import express from "express";
import { S3Service } from "../services/uploads/s3.service";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";

const router = express.Router();
const s3Service = new S3Service();

const MAX_UPLOAD_SIZE_BYTES = parseInt(process.env.MAX_UPLOAD_SIZE_BYTES || String(10 * 1024 * 1024), 10);

interface PresignRequest {
  filename: string;
  contentType: string;
}

/**
 * Returns a short-lived presigned POST so clients can upload images straight
 * to S3 without credentials. The POST policy enforces the content type and a
 * content-length-range server-side, so oversized uploads are rejected by S3
 * itself — the declared-size check below is just an early exit.
 */
router.post("/presign", requireAuth, async (req, res) => {
  try {
    const { userId } = req as AuthedRequest;

    const { filename, contentType, sizeBytes } = req.body as PresignRequest & { sizeBytes?: number };

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

    const presigned = await s3Service.getPresignedUploadUrl(userId!, contentType, MAX_UPLOAD_SIZE_BYTES);

    return res.status(200).json({
      upload: presigned,
      cdnUrl: presigned.cdnUrl,
      expiresIn: presigned.expiresIn,
    });
  } catch (err) {
    console.error("[presign] error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
