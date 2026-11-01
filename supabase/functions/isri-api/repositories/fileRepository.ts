import type { DatabaseClient } from "../_shared/types.ts";

export const incidentAttachmentBucket = "incident-attachments";
export const workOrderAttachmentBucket = "work-order-attachments";
export const rewardImageBucket = "reward-images";
export const maxAttachmentBytes = 3 * 1024 * 1024;
const allowedMimeTypes = new Set(["image/jpeg", "image/png"]);

export interface IncidentAttachment {
  objectPath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface WorkOrderAttachment extends IncidentAttachment {}

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

  async createWorkOrderUpload(input: {
    userId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }) {
    this.assertImage(input);
    const extension = input.mimeType === "image/png" ? "png" : "jpg";
    const objectPath = `work-orders/${input.userId}/${crypto.randomUUID()}.${extension}`;
    const { data, error } = await this.db.storage
      .from(workOrderAttachmentBucket)
      .createSignedUploadUrl(objectPath);
    if (error) throw error;
    return { objectPath, token: data.token, bucket: workOrderAttachmentBucket };
  }

  async createRewardImageUpload(input: {
    userId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }) {
    this.assertImage(input);
    const extension = input.mimeType === "image/png" ? "png" : "jpg";
    const objectPath = `rewards/${input.userId}/${crypto.randomUUID()}.${extension}`;
    const { data, error } = await this.db.storage
      .from(rewardImageBucket)
      .createSignedUploadUrl(objectPath);
    if (error) throw error;
    return { objectPath, token: data.token, bucket: rewardImageBucket };
  }

  async createRewardImageRecord(input: {
    userId: string;
    objectPath: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }) {
    if (!FileRepository.validateRewardImage(input, input.userId))
      throw new Error("Reward image is invalid.");
    const { data, error } = await this.db
      .from("files")
      .insert({
        bucket: rewardImageBucket,
        object_path: input.objectPath,
        file_name: input.fileName,
        mime_type: input.mimeType,
        size_bytes: input.sizeBytes,
        uploaded_by: input.userId,
      })
      .select("id, bucket, object_path, file_name, mime_type, size_bytes")
      .single();
    if (error) throw error;
    return data;
  }

  async linkWorkOrderAttachments(input: {
    workOrderId: string;
    historyId: string;
    userId: string;
    attachments: WorkOrderAttachment[];
  }) {
    if (!input.attachments.length) return [];
    const payload = input.attachments.map((file) => ({
      bucket: workOrderAttachmentBucket,
      object_path: file.objectPath,
      file_name: file.fileName,
      mime_type: file.mimeType,
      size_bytes: file.sizeBytes,
      uploaded_by: input.userId,
    }));
    const { data, error } = await this.db
      .from("files")
      .insert(payload)
      .select("id, bucket, object_path, file_name, mime_type, size_bytes");
    if (error) throw error;
    const fileIds = (data ?? []).map((file) => file.id);
    const { error: workOrderError } = await this.db
      .from("work_order_files")
      .insert(
        fileIds.map((fileId) => ({
          work_order_id: input.workOrderId,
          file_id: fileId,
        })),
      );
    if (workOrderError) throw workOrderError;
    const { error: historyError } = await this.db
      .from("work_order_history_files")
      .insert(
        fileIds.map((fileId) => ({
          work_order_history_id: input.historyId,
          file_id: fileId,
        })),
      );
    if (historyError) throw historyError;
    return data ?? [];
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

  static validateWorkOrderAttachment(
    attachment: unknown,
    userId: string,
  ): attachment is WorkOrderAttachment {
    if (!attachment || typeof attachment !== "object") return false;
    const value = attachment as Record<string, unknown>;
    return (
      typeof value.objectPath === "string" &&
      value.objectPath.startsWith(`work-orders/${userId}/`) &&
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

  static validateRewardImage(
    attachment: unknown,
    userId: string,
  ): attachment is IncidentAttachment {
    if (!attachment || typeof attachment !== "object") return false;
    const value = attachment as Record<string, unknown>;
    return (
      typeof value.objectPath === "string" &&
      value.objectPath.startsWith(`rewards/${userId}/`) &&
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

  private assertImage(input: { mimeType: string; sizeBytes: number }) {
    if (!allowedMimeTypes.has(input.mimeType))
      throw new Error("Only JPEG and PNG images are allowed.");
    if (
      !Number.isInteger(input.sizeBytes) ||
      input.sizeBytes < 1 ||
      input.sizeBytes > maxAttachmentBytes
    )
      throw new Error("The image size must not exceed 3 MB.");
  }
}
