import { S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import crypto from "crypto";

const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

const EXTENSION_BY_TYPE: Record<AllowedContentType, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
};

const MAX_PRESIGN_EXPIRY_SECONDS = 300;

export class S3Service {
    private client: S3Client;
    private bucket: string;
    private region: string;
    private cdnBaseUrl: string;
    private expirySeconds: number;

    constructor(client?: S3Client) {
        this.region = process.env.S3_REGION || "us-east-1";
        this.bucket = process.env.S3_BUCKET || "";
        this.cdnBaseUrl = process.env.CDN_BASE_URL || "";

        // The issue caps presigned URLs at 5 minutes; clamp misconfigurations
        // into that window instead of silently issuing longer-lived URLs.
        const configured = parseInt(process.env.PRESIGN_EXPIRY_SECONDS || "300", 10);
        if (Number.isNaN(configured) || configured < 1) {
            this.expirySeconds = 300;
        } else {
            this.expirySeconds = Math.min(configured, MAX_PRESIGN_EXPIRY_SECONDS);
        }

        // Only pin static credentials when both are provided; otherwise let
        // the SDK's default provider chain (IAM roles, env, etc.) take over.
        const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
        const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
        this.client =
            client ??
            new S3Client({
                region: this.region,
                ...(accessKeyId && secretAccessKey
                    ? { credentials: { accessKeyId, secretAccessKey } }
                    : {}),
            });
    }

    public isContentTypeAllowed(contentType: string): contentType is AllowedContentType {
        return (ALLOWED_CONTENT_TYPES as readonly string[]).includes(contentType);
    }

    /**
     * Generates a short-lived presigned POST for a direct-to-S3 upload. Unlike
     * a bare presigned PUT, the policy enforces the content type and a
     * content-length-range server-side, so an omitted or lying size hint can't
     * bypass the upload cap.
     *
     * Object keys are namespaced by the uploader's user ID so one user can
     * never write into another user's path.
     */
    public async getPresignedUploadUrl(
        userId: string,
        contentType: AllowedContentType,
        maxSizeBytes: number
    ): Promise<{ url: string; fields: Record<string, string>; key: string; cdnUrl: string; expiresIn: number }> {
        const key = `uploads/${userId}/${crypto.randomUUID()}.${EXTENSION_BY_TYPE[contentType]}`;

        const { url, fields } = await createPresignedPost(this.client, {
            Bucket: this.bucket,
            Key: key,
            Conditions: [
                { "Content-Type": contentType },
                ["content-length-range", 1, maxSizeBytes],
            ],
            Expires: this.expirySeconds,
        });

        return {
            url,
            fields,
            key,
            cdnUrl: this.publicUrlFor(key),
            expiresIn: this.expirySeconds,
        };
    }

    /**
     * Confirms an image URL saved on a listing actually points at our storage
     * AND sits inside the uploading user's namespace — rejecting other users'
     * paths, foreign hosts, and traversal like `uploads/{id}/../escape.jpg`.
     */
    public validateImageOwnership(userId: string, imageUrl: string): boolean {
        try {
            const parsed = new URL(imageUrl);

            // Only accept URLs served from our own public endpoints.
            const trustedOrigins = [this.publicOrigin()];
            if (!trustedOrigins.includes(parsed.origin)) {
                return false;
            }

            const prefix = `uploads/${userId}/`;
            const pathname = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");

            if (!pathname.startsWith(prefix)) {
                return false;
            }

            // Reject anything that escapes the namespace via traversal segments.
            const relative = pathname.slice(prefix.length);
            return !relative.split("/").some((segment) => segment === "..");
        } catch {
            return false;
        }
    }

    /** Origin of the public URL users will fetch uploaded images from. */
    private publicOrigin(): string {
        if (this.cdnBaseUrl) {
            try {
                return new URL(this.cdnBaseUrl).origin;
            } catch {
                // fall through to bucket URL
            }
        }
        return new URL(`https://${this.bucket}.s3.${this.region}.amazonaws.com`).origin;
    }

    public publicUrlFor(key: string): string {
        if (this.cdnBaseUrl) {
            return `${this.cdnBaseUrl.replace(/\/+$/, "")}/${key}`;
        }
        return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
    }
}
