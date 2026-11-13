import type {
  IDeliveryPortalService,
  IRestaurantPortalService,
} from "@/services/contracts/interfaces";
import type { MediaCategory, PresignedMediaUploadResponse } from "@/services/contracts/types";

/**
 * Requests a presigned R2 PUT URL for the given category ("Menu" or "Verification")
 * scoped to the outlet/rider, uploads the file directly to Cloudflare R2, and returns
 * the presign metadata (including object `key` and `viewUrl`).
 */
export async function uploadMediaWithPresign(
  portal: Pick<IRestaurantPortalService | IDeliveryPortalService, "presignMediaUpload">,
  params: {
    category: MediaCategory;
    outletId?: string;
    file: File;
  }
): Promise<PresignedMediaUploadResponse> {
  if (!portal.presignMediaUpload) {
    throw new Error("Media upload is not supported in the current service mode.");
  }
  const presigned = await portal.presignMediaUpload({
    category: params.category,
    outletId: params.outletId,
    filename: params.file.name,
    contentType: params.file.type || "application/octet-stream",
    sizeBytes: params.file.size,
  });

  const putRes = await fetch(presigned.uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": params.file.type || "application/octet-stream",
    },
    body: params.file,
  });

  if (!putRes.ok) {
    throw new Error(`Direct upload to object storage failed (${putRes.status}).`);
  }
  return presigned;
}
