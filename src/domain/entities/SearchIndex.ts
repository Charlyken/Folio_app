/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface BookPageTextEntry {
  readonly pageNumber: number;
  readonly text: string;
  readonly normalizedText: string;
}

export interface BookSearchIndex {
  readonly bookId: string;
  readonly indexedAt: number;
  readonly pages: readonly BookPageTextEntry[];
  /**
   * Inverted index mapping normalized token (>= 2 chars) to sorted array of 1-based page numbers.
   */
  readonly invertedTokens: Readonly<Record<string, readonly number[]>>;
}

export interface SearchMatchSnippet {
  readonly pageNumber: number;
  readonly matchCountOnPage: number;
  readonly snippetBefore: string;
  readonly matchedText: string;
  readonly snippetAfter: string;
}
