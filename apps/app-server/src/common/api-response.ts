export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export function apiResponse<T>(data: T): ApiSuccessResponse<T> {
  return {
    success: true,
    data
  };
}
