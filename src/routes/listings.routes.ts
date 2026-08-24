import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { z, ZodError } from "zod";
import { pool } from "../db/db";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "super_secret_jwt_key_change_me_in_prod";

export const ALLOWED_CATEGORIES = [
  "phone",
  "phones",
  "smartphone",
  "smartphones",
  "laptop",
  "laptops",
  "tablet",
  "tablets",
  "smartwatch",
  "smartwatches",
  "wearables",
  "audio",
  "headphones",
  "desktop",
  "desktops",
  "gaming",
  "gaming_console",
  "accessories",
  "monitor",
  "monitors",
  "camera",
  "cameras",
  "other",
] as const;

export const ALLOWED_CONDITIONS = [
  "new",
  "like_new",
  "like new",
  "open_box",
  "open box",
  "refurbished",
  "excellent",
  "good",
  "fair",
  "poor",
  "for_parts",
  "for parts",
] as const;

export function isValidUrl(urlStr: string): boolean {
  if (typeof urlStr !== "string" || !urlStr.trim()) {
    return false;
  }

  try {
    const parsed = new URL(urlStr.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function formatZodError(error: any) {
  const rawIssues = error && Array.isArray(error.issues)
    ? error.issues
    : error && Array.isArray(error.errors)
      ? error.errors
      : [];

  const details = rawIssues.map((issue: any) => ({
    field: Array.isArray(issue.path) && issue.path.length > 0 ? issue.path.join(".") : "body",
    message: issue.message || "Invalid value",
    code: issue.code || "custom",
  }));

  const mainMessage = details.length > 0 ? details[0].message : error?.message || "Validation failed";

  return {
    error: "Unprocessable Entity",
    message: mainMessage,
    errors: details,
    details: details,
  };
}

export const createListingSchema = z
  .object({
    title: z.string().optional(),
    description: z.string().optional(),
    category: z
      .string({
        message: "Category is required",
      })
      .trim()
      .min(1, "Category is required")
      .superRefine((val, ctx) => {
        if (!ALLOWED_CATEGORIES.includes(val.toLowerCase() as any)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Invalid category: '${val}'. Allowed categories: ${ALLOWED_CATEGORIES.join(", ")}`,
          });
        }
      }),
    condition: z
      .string({
        message: "Condition is required",
      })
      .trim()
      .min(1, "Condition is required")
      .superRefine((val, ctx) => {
        if (!ALLOWED_CONDITIONS.includes(val.toLowerCase() as any)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Invalid condition: '${val}'. Allowed conditions: ${ALLOWED_CONDITIONS.join(", ")}`,
          });
        }
      }),
    price: z
      .union([z.number(), z.string()], {
        message: "Price must be a positive number in USDC",
      })
      .superRefine((val, ctx) => {
        const num = typeof val === "string" ? parseFloat(val) : val;
        if (Number.isNaN(num) || !Number.isFinite(num) || num <= 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Price must be a positive number in USDC",
          });
        }
      })
      .transform((val) => (typeof val === "string" ? parseFloat(val) : val)),
    image_urls: z.array(z.string()).optional(),
    imageUrls: z.array(z.string()).optional(),
    images: z.array(z.string()).optional(),
    device_type: z.string().optional(),
    estimated_value: z
      .union([z.number(), z.string()])
      .optional()
      .superRefine((val, ctx) => {
        if (val === undefined || val === null) return;
        const num = typeof val === "string" ? parseFloat(val) : val;
        if (Number.isNaN(num) || !Number.isFinite(num) || num < 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "estimated_value must be a valid non-negative number",
          });
        }
      })
      .transform((val) =>
        val !== undefined && val !== null
          ? typeof val === "string"
            ? parseFloat(val)
            : val
          : undefined
      ),
  })
  .superRefine((data, ctx) => {
    const rawImages = data.image_urls ?? data.imageUrls ?? data.images;
    if (!rawImages || !Array.isArray(rawImages) || rawImages.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["image_urls"],
        message: "At least one image URL is required in image_urls",
      });
      return;
    }

    for (let i = 0; i < rawImages.length; i++) {
      const url = rawImages[i];
      if (!isValidUrl(url)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["image_urls", i],
          message: `Invalid image URL: '${url}'. Must be a valid HTTP or HTTPS URL.`,
        });
      }
    }
  });

export const updateListingSchema = z
  .object({
    title: z.string().trim().min(1, "Title cannot be empty").optional(),
    description: z.string().optional(),
    category: z
      .string()
      .trim()
      .min(1, "Category cannot be empty")
      .superRefine((val, ctx) => {
        if (!ALLOWED_CATEGORIES.includes(val.toLowerCase() as any)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Invalid category: '${val}'. Allowed categories: ${ALLOWED_CATEGORIES.join(", ")}`,
          });
        }
      })
      .optional(),
    condition: z
      .string()
      .trim()
      .min(1, "Condition cannot be empty")
      .superRefine((val, ctx) => {
        if (!ALLOWED_CONDITIONS.includes(val.toLowerCase() as any)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Invalid condition: '${val}'. Allowed conditions: ${ALLOWED_CONDITIONS.join(", ")}`,
          });
        }
      })
      .optional(),
    price: z
      .union([z.number(), z.string()], {
        message: "Price must be a positive number in USDC",
      })
      .optional()
      .superRefine((val, ctx) => {
        if (val === undefined || val === null) return;
        const num = typeof val === "string" ? parseFloat(val) : val;
        if (Number.isNaN(num) || !Number.isFinite(num) || num <= 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Price must be a positive number in USDC",
          });
        }
      })
      .transform((val) =>
        val !== undefined && val !== null
          ? typeof val === "string"
            ? parseFloat(val)
            : val
          : undefined
      ),
    image_urls: z.array(z.string()).optional(),
    imageUrls: z.array(z.string()).optional(),
    images: z.array(z.string()).optional(),
    device_type: z.string().trim().min(1, "device_type cannot be empty").optional(),
    estimated_value: z
      .union([z.number(), z.string()])
      .optional()
      .superRefine((val, ctx) => {
        if (val === undefined || val === null) return;
        const num = typeof val === "string" ? parseFloat(val) : val;
        if (Number.isNaN(num) || !Number.isFinite(num) || num < 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "estimated_value must be a valid non-negative number",
          });
        }
      })
      .transform((val) =>
        val !== undefined && val !== null
          ? typeof val === "string"
            ? parseFloat(val)
            : val
          : undefined
      ),
  })
  .superRefine((data, ctx) => {
    const hasAnyField =
      data.title !== undefined ||
      data.description !== undefined ||
      data.category !== undefined ||
      data.condition !== undefined ||
      data.price !== undefined ||
      data.image_urls !== undefined ||
      data.imageUrls !== undefined ||
      data.images !== undefined ||
      data.device_type !== undefined ||
      data.estimated_value !== undefined;

    if (!hasAnyField) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["body"],
        message: "No fields provided to update",
      });
      return;
    }

    const rawImages = data.image_urls ?? data.imageUrls ?? data.images;
    if (rawImages !== undefined) {
      if (!Array.isArray(rawImages) || rawImages.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["image_urls"],
          message: "At least one image URL is required in image_urls",
        });
      } else {
        for (let i = 0; i < rawImages.length; i++) {
          const url = rawImages[i];
          if (!isValidUrl(url)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["image_urls", i],
              message: `Invalid image URL: '${url}'. Must be a valid HTTP or HTTPS URL.`,
            });
          }
        }
      }
    }
  });

function parseNonNegativeQueryNumber(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function extractUserId(req: Request): string | null {
  const headerUserId = req.headers["x-user-id"] as string;
  if (headerUserId && headerUserId.trim()) {
    return headerUserId.trim();
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7).trim();
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { sub?: string };
      if (decoded && decoded.sub) {
        return decoded.sub;
      }
    } catch {
      console.log("[extractUserId] Invalid JWT token provided in Authorization header.");
    }
  }

  return null;
}

interface CursorPayload {
  val: string | number;
  id: string;
}

export function encodeCursor(val: string | number, id: string): string {
  return Buffer.from(JSON.stringify({ val, id }), "utf-8").toString("base64url");
}

export function decodeCursor(cursorStr: string): CursorPayload | null {
  try {
    const raw = Buffer.from(cursorStr, "base64url").toString("utf-8");
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      (typeof parsed.val === "string" || typeof parsed.val === "number") &&
      typeof parsed.id === "string" &&
      parsed.id.trim()
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

router.post("/", async (req: Request, res: Response) => {
  try {
    const userId = extractUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parseResult = createListingSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(422).json(formatZodError(parseResult.error));
    }

    const validated = parseResult.data;
    const normalizedCategory = validated.category.trim().toLowerCase();
    const normalizedCondition = validated.condition.trim().toLowerCase();
    const numPrice = validated.price;
    const rawImages = validated.image_urls ?? validated.imageUrls ?? validated.images ?? [];
    const validUrls = rawImages.map((u) => u.trim());

    const deviceType = validated.device_type || validated.title || normalizedCategory;
    const estimatedVal = validated.estimated_value ?? numPrice;
    const listingTitle = validated.title?.trim() || `${normalizedCategory} (${normalizedCondition})`;
    const listingDescription = validated.description?.trim() || "";

    const query = `
      INSERT INTO listings (
        owner_id,
        title,
        description,
        category,
        condition,
        price,
        image_urls,
        device_type,
        estimated_value
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const values = [
      userId,
      listingTitle,
      listingDescription,
      normalizedCategory,
      normalizedCondition,
      numPrice,
      validUrls,
      deviceType,
      estimatedVal,
    ];

    const result = await pool.query(query, values);
    const listing = result.rows[0];

    return res.status(201).json(listing);
  } catch (error: any) {
    console.error("[POST /listings] Error creating listing:", error);
    return res.status(500).json({ error: error.message || "Internal Server Error" });
  }
});

router.get("/", async (req: Request, res: Response) => {
  try {
    const { category, condition, minPrice, maxPrice, minTrustScore, sortBy, order, cursor, limit } = req.query;

    const whereConditions: string[] = ["deleted_at IS NULL"];
    const queryParams: any[] = [];

    if (category) {
      const catStr = category.toString().trim().toLowerCase();
      queryParams.push(catStr);
      whereConditions.push(`LOWER(category) = $${queryParams.length}`);
    }

    if (condition) {
      const condStr = condition.toString().trim().toLowerCase();
      queryParams.push(condStr);
      whereConditions.push(`LOWER(condition) = $${queryParams.length}`);
    }

    let parsedMinPrice: number | undefined;
    if (minPrice !== undefined) {
      const parsed = parseNonNegativeQueryNumber(minPrice);
      if (parsed === null) {
        return res.status(400).json({ error: "minPrice must be a valid non-negative number" });
      }
      parsedMinPrice = parsed;
      queryParams.push(parsedMinPrice);
      whereConditions.push(`price >= $${queryParams.length}`);
    }

    let parsedMaxPrice: number | undefined;
    if (maxPrice !== undefined) {
      const parsed = parseNonNegativeQueryNumber(maxPrice);
      if (parsed === null) {
        return res.status(400).json({ error: "maxPrice must be a valid non-negative number" });
      }
      parsedMaxPrice = parsed;
      queryParams.push(parsedMaxPrice);
      whereConditions.push(`price <= $${queryParams.length}`);
    }

    if (parsedMinPrice !== undefined && parsedMaxPrice !== undefined && parsedMinPrice > parsedMaxPrice) {
      return res.status(400).json({ error: "minPrice cannot be greater than maxPrice" });
    }

    if (minTrustScore !== undefined) {
      const parsedMinTrust = parseNonNegativeQueryNumber(minTrustScore);
      if (parsedMinTrust === null) {
        return res.status(400).json({ error: "minTrustScore must be a valid non-negative number" });
      }
      queryParams.push(parsedMinTrust);
      whereConditions.push(`COALESCE(trust_score, 100.0) >= $${queryParams.length}`);
    }

    let sortField: "created_at" | "price" = "created_at";
    let sortDirection: "ASC" | "DESC" = "DESC";

    if (sortBy) {
      const normalizedSort = sortBy.toString().trim().toLowerCase();
      if (normalizedSort === "price" || normalizedSort === "price_asc") {
        sortField = "price";
        sortDirection = "ASC";
      } else if (normalizedSort === "price_desc") {
        sortField = "price";
        sortDirection = "DESC";
      } else if (normalizedSort === "date" || normalizedSort === "date_desc" || normalizedSort === "created_at") {
        sortField = "created_at";
        sortDirection = "DESC";
      } else if (normalizedSort === "date_asc") {
        sortField = "created_at";
        sortDirection = "ASC";
      } else {
        return res.status(400).json({
          error: "Invalid sortBy parameter. Allowed values: 'price', 'date' (or 'price_asc', 'price_desc', 'date_asc', 'date_desc')",
        });
      }
    }

    if (order) {
      const normalizedOrder = order.toString().trim().toUpperCase();
      if (normalizedOrder === "ASC" || normalizedOrder === "DESC") {
        sortDirection = normalizedOrder;
      }
    }

    let limitNumber = 20;
    if (limit !== undefined) {
      const parsedLimit = parseInt(limit as string, 10);
      if (Number.isNaN(parsedLimit) || parsedLimit <= 0) {
        return res.status(400).json({ error: "limit must be a positive integer" });
      }
      limitNumber = Math.min(parsedLimit, 100);
    }

    if (cursor) {
      const cursorPayload = decodeCursor(cursor as string);
      if (!cursorPayload) {
        return res.status(400).json({ error: "Invalid cursor" });
      }

      if (sortField === "created_at") {
        if (typeof cursorPayload.val !== "string" || !Number.isFinite(Date.parse(cursorPayload.val))) {
          return res.status(400).json({ error: "Invalid cursor" });
        }

        queryParams.push(cursorPayload.val, cursorPayload.id);
        const valIdx = queryParams.length - 1;
        const idIdx = queryParams.length;
        if (sortDirection === "DESC") {
          whereConditions.push(`(created_at < $${valIdx}::timestamptz OR (created_at = $${valIdx}::timestamptz AND id < $${idIdx}))`);
        } else {
          whereConditions.push(`(created_at > $${valIdx}::timestamptz OR (created_at = $${valIdx}::timestamptz AND id > $${idIdx}))`);
        }
      } else if (sortField === "price") {
        const cursorPrice = Number(cursorPayload.val);
        if (!Number.isFinite(cursorPrice) || cursorPrice < 0) {
          return res.status(400).json({ error: "Invalid cursor" });
        }

        queryParams.push(cursorPrice, cursorPayload.id);
        const valIdx = queryParams.length - 1;
        const idIdx = queryParams.length;
        if (sortDirection === "ASC") {
          whereConditions.push(`(price > $${valIdx}::numeric OR (price = $${valIdx}::numeric AND id > $${idIdx}))`);
        } else {
          whereConditions.push(`(price < $${valIdx}::numeric OR (price = $${valIdx}::numeric AND id < $${idIdx}))`);
        }
      }
    }

    queryParams.push(limitNumber + 1);
    const limitPlaceholder = `$${queryParams.length}`;

    const sql = `
      SELECT * FROM listings
      WHERE ${whereConditions.join(" AND ")}
      ORDER BY ${sortField} ${sortDirection}, id ${sortDirection}
      LIMIT ${limitPlaceholder}
    `;

    const result = await pool.query(sql, queryParams);
    const hasMore = result.rows.length > limitNumber;
    const items = hasMore ? result.rows.slice(0, limitNumber) : result.rows;

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1];
      const sortVal =
        sortField === "created_at"
          ? lastItem.created_at instanceof Date
            ? lastItem.created_at.toISOString()
            : lastItem.created_at
          : Number(lastItem.price);
      nextCursor = encodeCursor(sortVal, lastItem.id);
    }

    return res.json({
      listings: items,
      items,
      next_cursor: nextCursor,
      has_more: hasMore,
      limit: limitNumber,
    });
  } catch (error: any) {
    console.error("[GET /listings] Error fetching listings:", error);
    return res.status(500).json({ error: error.message || "Internal Server Error" });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id || !id.trim()) {
      return res.status(400).json({ error: "Listing ID is required" });
    }

    const sql = `
      SELECT 
        l.*,
        (SELECT COUNT(*)::int FROM listings WHERE owner_id = l.owner_id AND deleted_at IS NULL) AS seller_total_listings,
        (SELECT COUNT(*)::int FROM listings WHERE owner_id = l.owner_id AND deleted_at IS NULL) AS seller_active_listings,
        (SELECT COALESCE(AVG(trust_score), 100.0)::numeric(5,2) FROM listings WHERE owner_id = l.owner_id AND deleted_at IS NULL) AS seller_avg_trust_score,
        (SELECT MIN(created_at) FROM listings WHERE owner_id = l.owner_id AND deleted_at IS NULL) AS seller_member_since
      FROM listings l
      WHERE l.id = $1 AND l.deleted_at IS NULL
    `;

    const result = await pool.query(sql, [id.trim()]);

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ error: "Listing not found" });
    }

    const row = result.rows[0];
    const trustScore =
      row.trust_score !== null && row.trust_score !== undefined
        ? Number(row.trust_score)
        : 100.0;

    const sellerProfile = {
      id: row.owner_id,
      owner_id: row.owner_id,
      email: row.owner_email || null,
      trust_score: trustScore,
      trustScore: trustScore,
      total_listings:
        row.seller_total_listings !== undefined && row.seller_total_listings !== null
          ? Number(row.seller_total_listings)
          : 1,
      active_listings:
        row.seller_active_listings !== undefined && row.seller_active_listings !== null
          ? Number(row.seller_active_listings)
          : 1,
      avg_trust_score:
        row.seller_avg_trust_score !== undefined && row.seller_avg_trust_score !== null
          ? Number(row.seller_avg_trust_score)
          : trustScore,
      member_since: row.seller_member_since || row.created_at || new Date().toISOString(),
    };

    const { seller_total_listings, seller_active_listings, seller_avg_trust_score, seller_member_since, ...cleanListing } = row;

    return res.status(200).json({
      ...cleanListing,
      trust_score: trustScore,
      trustScore: trustScore,
      seller: sellerProfile,
      seller_profile: sellerProfile,
      sellerProfile: sellerProfile,
    });
  } catch (error: any) {
    if (error && error.code === "22P02") {
      return res.status(404).json({ error: "Listing not found" });
    }
    console.error(`[GET /listings/:id] Error fetching listing ${req.params?.id}:`, error);
    return res.status(500).json({ error: error.message || "Internal Server Error" });
  }
});

router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const userId = extractUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;
    if (!id || !id.trim()) {
      return res.status(400).json({ error: "Listing ID is required" });
    }

    const parseResult = updateListingSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(422).json(formatZodError(parseResult.error));
    }

    const body = parseResult.data;

    const checkResult = await pool.query("SELECT * FROM listings WHERE id = $1 AND deleted_at IS NULL", [id.trim()]);
    if (!checkResult.rows || checkResult.rows.length === 0) {
      return res.status(404).json({ error: "Listing not found" });
    }

    const existing = checkResult.rows[0];
    if (existing.owner_id !== userId) {
      return res.status(403).json({ error: "Forbidden: You do not own this listing" });
    }

    const statusUpper = typeof existing.status === "string" ? existing.status.trim().toUpperCase() : "";
    const stateUpper = typeof existing.state === "string" ? existing.state.trim().toUpperCase() : "";

    if (
      statusUpper === "ACTIVE_ESCROW" ||
      stateUpper === "ACTIVE_ESCROW" ||
      statusUpper === "IN_ESCROW" ||
      statusUpper === "ESCROW" ||
      existing.escrow_funded === true
    ) {
      return res.status(409).json({
        error: "Cannot update listing: Listing is in an ACTIVE_ESCROW state",
      });
    }

    if (
      statusUpper === "SWAP_LOCKED" ||
      stateUpper === "SWAP_LOCKED" ||
      statusUpper === "LOCKED" ||
      existing.is_locked === true ||
      existing.current_swap_id
    ) {
      return res.status(409).json({
        error: "Cannot update listing: Listing is in a SWAP_LOCKED state (locked in an active swap)",
      });
    }

    const updates: string[] = [];
    const values: any[] = [];

    if (body.title !== undefined) {
      values.push(body.title.trim());
      updates.push(`title = $${values.length}`);
    }

    if (body.description !== undefined) {
      values.push(body.description.trim());
      updates.push(`description = $${values.length}`);
    }

    if (body.category !== undefined) {
      values.push(body.category.trim().toLowerCase());
      updates.push(`category = $${values.length}`);
    }

    if (body.condition !== undefined) {
      values.push(body.condition.trim().toLowerCase());
      updates.push(`condition = $${values.length}`);
    }

    if (body.price !== undefined) {
      values.push(body.price);
      updates.push(`price = $${values.length}`);
    }

    const rawImages = body.image_urls ?? body.imageUrls ?? body.images;
    if (rawImages !== undefined) {
      const validUrls = rawImages.map((u) => u.trim());
      values.push(validUrls);
      updates.push(`image_urls = $${values.length}`);
    }

    if (body.device_type !== undefined) {
      values.push(body.device_type.trim());
      updates.push(`device_type = $${values.length}`);
    }

    if (body.estimated_value !== undefined) {
      values.push(body.estimated_value);
      updates.push(`estimated_value = $${values.length}`);
    }

    if (updates.length === 0) {
      return res.status(422).json({
        error: "Unprocessable Entity",
        message: "No fields provided to update",
        errors: [{ field: "body", message: "No fields provided to update", code: "custom" }],
        details: [{ field: "body", message: "No fields provided to update", code: "custom" }],
      });
    }

    updates.push("updated_at = NOW()");
    values.push(id.trim());
    const idIdx = values.length;

    const updateSql = `
      UPDATE listings
      SET ${updates.join(", ")}
      WHERE id = $${idIdx} AND deleted_at IS NULL
      RETURNING *
    `;

    const result = await pool.query(updateSql, values);
    return res.status(200).json(result.rows[0]);
  } catch (error: any) {
    if (error && error.code === "22P02") {
      return res.status(404).json({ error: "Listing not found" });
    }
    console.error(`[PATCH /listings/:id] Error updating listing ${req.params?.id}:`, error);
    return res.status(500).json({ error: error.message || "Internal Server Error" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const userId = extractUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;
    if (!id || !id.trim()) {
      return res.status(400).json({ error: "Listing ID is required" });
    }

    const checkResult = await pool.query("SELECT * FROM listings WHERE id = $1 AND deleted_at IS NULL", [id.trim()]);
    if (!checkResult.rows || checkResult.rows.length === 0) {
      return res.status(404).json({ error: "Listing not found" });
    }

    const existing = checkResult.rows[0];
    if (existing.owner_id !== userId) {
      return res.status(403).json({ error: "Forbidden: You do not own this listing" });
    }

    const statusUpper = typeof existing.status === "string" ? existing.status.trim().toUpperCase() : "";
    const stateUpper = typeof existing.state === "string" ? existing.state.trim().toUpperCase() : "";

    if (
      statusUpper === "ACTIVE_ESCROW" ||
      stateUpper === "ACTIVE_ESCROW" ||
      statusUpper === "IN_ESCROW" ||
      statusUpper === "ESCROW" ||
      existing.escrow_funded === true
    ) {
      return res.status(409).json({
        error: "Cannot delete listing: Listing is in an ACTIVE_ESCROW state",
      });
    }

    if (
      statusUpper === "SWAP_LOCKED" ||
      stateUpper === "SWAP_LOCKED" ||
      statusUpper === "LOCKED" ||
      existing.is_locked === true ||
      existing.current_swap_id
    ) {
      return res.status(409).json({
        error: "Cannot delete listing: Listing is in a SWAP_LOCKED state (locked in an active swap)",
      });
    }

    const deleteSql = `
      UPDATE listings
      SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *
    `;

    const deleteResult = await pool.query(deleteSql, [id.trim()]);
    return res.status(200).json({
      message: "Listing deleted successfully",
      id: id.trim(),
      listing: deleteResult.rows[0],
    });
  } catch (error: any) {
    if (error && error.code === "22P02") {
      return res.status(404).json({ error: "Listing not found" });
    }
    console.error(`[DELETE /listings/:id] Error deleting listing ${req.params?.id}:`, error);
    return res.status(500).json({ error: error.message || "Internal Server Error" });
  }
});

export default router;
