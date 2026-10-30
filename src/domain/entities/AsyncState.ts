/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type AsyncState<T, E = AppError> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly message?: string }
  | { readonly status: 'success'; readonly data: T }
  | { readonly status: 'error'; readonly error: E };

export type ErrorCode =
  | 'INVALID_MIME_TYPE'
  | 'FILE_TOO_LARGE'
  | 'CORRUPTED_PDF'
  | 'PASSWORD_PROTECTED_PDF'
  | 'STORAGE_QUOTA_EXCEEDED'
  | 'BOOK_NOT_FOUND'
  | 'RENDER_FAILED'
  | 'UNKNOWN_ERROR';

export interface AppError {
  readonly code: ErrorCode;
  readonly title: string;
  readonly message: string;
  readonly recoverable: boolean;
}

export function createAppError(
  code: ErrorCode,
  title: string,
  message: string,
  recoverable = true
): AppError {
  return { code, title, message, recoverable };
}
