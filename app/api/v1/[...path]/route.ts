import { ApiError, errorResponse } from "@/lib/api/errors";

/** Any path under /api/v1 that no endpoint serves answers in the API's error shape, not with the website's 404 page. */
function notFound(): Response {
  return errorResponse(new ApiError(404, "not_found", "No endpoint at this path. See the API reference for the endpoints."));
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
