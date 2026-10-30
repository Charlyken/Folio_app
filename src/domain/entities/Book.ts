/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Book {
  readonly id: string;
  readonly title: string;
  readonly author: string;
  readonly totalPages: number;
  readonly coverDataUrl: string;
  readonly fileSizeBytes: number;
  readonly addedAt: number;
  readonly lastReadAt: number | null;
}

export interface BookWithProgress extends Book {
  readonly currentPage: number;
  readonly progressPercentage: number;
  readonly bookmarksCount: number;
}
