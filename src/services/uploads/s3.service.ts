import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";

const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

const EXTENSION_BY_TYPE: Record<AllowedContentType, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
};

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
        this.expirySeconds = parseInt(process.env.PRESIGN_EXPIRY_SECONDS || "300", 10);

        this.client =
            client ??
            new S3Client({
                region: this.region,
                credentials: {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
                },
            });
    }

    public isContentTypeAllowed(contentType: string): contentType is AllowedContentType {
        return (ALLOWED_CONTENT_TYPES as readonly string[]).includes(contentType);
    }

    /**
     * Generates a short-lived presigned PUT URL for a direct-to-S3 upload.
     * Object keys are namespaced by the uploader's user ID so one user can
     * never write into another user's path.
     */
    public async getPresignedUploadUrl(
        userId: string,
        contentType: AllowedContentType
    ): Promise<{ uploadUrl: string; key: string; cdnUrl: string; expiresIn: number }> {
        const key = `uploads/${userId}/${crypto.randomUUID()}.${EXTENSION_BY_TYPE[contentType]}`;

        const command = new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            ContentType: contentType,
        });

        const uploadUrl = await getSignedUrl(this.client, command, {
            expiresIn: this.expirySeconds,
        });

        return {
            uploadUrl,
            key,
            cdnUrl: this.publicUrlFor(key),
            expiresIn: this.expirySeconds,
        };
    }

    /**
     * Confirms an image URL saved on a listing actually points inside the
     * uploading user's namespace, blocking cross-user path traversal like
     * `uploads/other-user/...` or `uploads/{id}/../escape.jpg`.
     */
    public validateImageOwnership(userId: string, imageUrl: string): boolean {
        try {
            const parsed = new URL(imageUrl);
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

    public publicUrlFor(key: string): string {
        if (this.cdnBaseUrl) {
            return `${this.cdnBaseUrl.replace(/\/+$/, "")}/${key}`;
        }
        return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
    }
}
