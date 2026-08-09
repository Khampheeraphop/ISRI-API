import type { DatabaseClient } from "../_shared/types.ts";

export const incidentAttachmentBucket = "incident-attachments";
export const maxAttachmentBytes = 3 * 1024 * 1024;
const allowedMimeTypes = new Set(["image/jpeg", "image/png"]);

export interface IncidentAttachment {
  objectPath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export class FileRepository {
  constructor(private readonly db: DatabaseClient) {}

  async createIncidentUpload(input: {
    userId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }) {
    if (!allowedMimeTypes.has(input.mimeType))
      throw new Error("Only JPEG and PNG images are allowed.");
    if (
      !Number.isInteger(input.sizeBytes) ||
      input.sizeBytes < 1 ||
      input.sizeBytes > maxAttachmentBytes
    )
      throw new Error("The image size must not exceed 3 MB.");
    const extension = input.mimeType === "image/png" ? "png" : "jpg";
    const objectPath = `incidents/${input.userId}/${crypto.randomUUID()}.${extension}`;
    const { data, error } = await this.db.storage
      .from(incidentAttachmentBucket)
      .createSignedUploadUrl(objectPath);
    if (error) throw error;
    return { objectPath, token: data.token, bucket: incidentAttachmentBucket };
  }

  async createSignedReadUrl(bucket: string, objectPath: string) {
    const { data, error } = await this.db.storage
      .from(bucket)
      .createSignedUrl(objectPath, 300);
    if (error) throw error;
    return data.signedUrl;
  }

  static validateIncidentAttachment(
    attachment: unknown,
    userId: string,
  ): attachment is IncidentAttachment {
    if (!attachment || typeof attachment !== "object") return false;
    const value = attachment as Record<string, unknown>;
    return (
      typeof value.objectPath === "string" &&
      value.objectPath.startsWith(`incidents/${userId}/`) &&
      typeof value.fileName === "string" &&
      value.fileName.length > 0 &&
      value.fileName.length <= 255 &&
      typeof value.mimeType === "string" &&
      allowedMimeTypes.has(value.mimeType) &&
      typeof value.sizeBytes === "number" &&
      Number.isInteger(value.sizeBytes) &&
      value.sizeBytes > 0 &&
      value.sizeBytes <= maxAttachmentBytes
    );
  }
}
