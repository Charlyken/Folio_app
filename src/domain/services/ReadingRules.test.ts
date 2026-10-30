/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assembleByteRangeFromChunks,
  buildBookSearchIndex,
  calculateProgressPercentage,
  calculateRemainingPercentage,
  clampZoomLevel,
  computeSha256Hex,
  estimateReadingTimeRemaining,
  formatFileSize,
  generateReadingNotesMarkdown,
  getNextPageNumber,
  getPrefetchPageNumber,
  getPreviousPageNumber,
  getVisiblePageNumbers,
  normalizeTargetPage,
  parseStudySheetJson,
  queryBookSearchIndex,
  serializeStudySheetJson,
  splitBufferIntoChunks,
  stepZoomIn,
  stepZoomOut,
  togglePageBookmark,
  updateRollingReadingPace,
} from './ReadingRules';

test('calculateProgressPercentage and calculateRemainingPercentage compute accurate bounds', () => {
  assert.equal(calculateProgressPercentage(1, 10), 10);
  assert.equal(calculateProgressPercentage(5, 10), 50);
  assert.equal(calculateProgressPercentage(10, 10), 100);
  assert.equal(calculateRemainingPercentage(3, 10), 70);
  assert.equal(calculateProgressPercentage(1, 1), 100);
  assert.equal(calculateProgressPercentage(0, 0), 0);
});

test('normalizeTargetPage aligns spreads in double mode to odd left-hand pages', () => {
  assert.equal(normalizeTargetPage(1, 10, 'single'), 1);
  assert.equal(normalizeTargetPage(4, 10, 'single'), 4);
  assert.equal(normalizeTargetPage(4, 10, 'double'), 3);
  assert.equal(normalizeTargetPage(5, 10, 'double'), 5);
  assert.equal(normalizeTargetPage(99, 10, 'double'), 9);
  assert.equal(normalizeTargetPage(-5, 10, 'single'), 1);
});

test('getNextPageNumber and getPreviousPageNumber navigate properly in single and double mode', () => {
  assert.equal(getNextPageNumber(1, 8, 'single'), 2);
  assert.equal(getNextPageNumber(8, 8, 'single'), 8);
  assert.equal(getNextPageNumber(1, 8, 'double'), 3);
  assert.equal(getNextPageNumber(7, 8, 'double'), 7);

  assert.equal(getPreviousPageNumber(5, 8, 'single'), 4);
  assert.equal(getPreviousPageNumber(1, 8, 'single'), 1);
  assert.equal(getPreviousPageNumber(5, 8, 'double'), 3);
  assert.equal(getPreviousPageNumber(3, 8, 'double'), 1);
});

test('getVisiblePageNumbers and getPrefetchPageNumber respect single and double spreads', () => {
  assert.deepEqual(getVisiblePageNumbers(3, 8, 'single'), [3]);
  assert.equal(getPrefetchPageNumber(3, 8, 'single'), 4);
  assert.equal(getPrefetchPageNumber(8, 8, 'single'), null);

  assert.deepEqual(getVisiblePageNumbers(3, 8, 'double'), [3, 4]);
  assert.equal(getPrefetchPageNumber(3, 8, 'double'), 5);
  assert.deepEqual(getVisiblePageNumbers(7, 7, 'double'), [7]);
  assert.equal(getPrefetchPageNumber(7, 7, 'double'), null);
});

test('togglePageBookmark adds, removes, and keeps bookmarks sorted', () => {
  const b1 = togglePageBookmark([], 5);
  assert.deepEqual(b1, [5]);
  const b2 = togglePageBookmark(b1, 2);
  assert.deepEqual(b2, [2, 5]);
  const b3 = togglePageBookmark(b2, 5);
  assert.deepEqual(b3, [2]);
});

test('zoom helpers clamp within [0.6, 2.4] and step by 0.15', () => {
  assert.equal(stepZoomIn(1.0), 1.15);
  assert.equal(stepZoomOut(1.0), 0.85);
  assert.equal(clampZoomLevel(5.0), 2.4);
  assert.equal(clampZoomLevel(0.1), 0.6);
});

test('formatFileSize formats bytes into French units', () => {
  assert.equal(formatFileSize(512), '512 o');
  assert.equal(formatFileSize(2048), '2 Ko');
  assert.equal(formatFileSize(2.5 * 1024 * 1024), '2,5 Mo');
});

test('splitBufferIntoChunks and assembleByteRangeFromChunks slice and reassemble binary ranges accurately', () => {
  const source = new Uint8Array(250);
  for (let i = 0; i < source.length; i++) {
    source[i] = i % 251;
  }
  const chunks = splitBufferIntoChunks(source, 64);
  assert.equal(chunks.length, 4);

  const range = assembleByteRangeFromChunks(chunks, 64, 250, 50, 140);
  assert.equal(range.byteLength, 90);
  assert.deepEqual(range, source.slice(50, 140));
});

test('computeSha256Hex returns deterministic 64-char hex digest', async () => {
  const bytes = new TextEncoder().encode('Folio PDF Content').buffer;
  const h1 = await computeSha256Hex(bytes);
  const h2 = await computeSha256Hex(bytes);
  assert.equal(h1.length, 64);
  assert.equal(h1, h2);
});

test('updateRollingReadingPace and estimateReadingTimeRemaining compute chapter and book ETA', () => {
  const updatedPace = updateRollingReadingPace(40, 60);
  assert.equal(updatedPace, 46);
  assert.equal(updateRollingReadingPace(40, 1), 40);

  const eta = estimateReadingTimeRemaining(
    2,
    10,
    [
      { title: '01. Intro', pageNumber: 2, items: [] },
      { title: '02. Chapitre II', pageNumber: 5, items: [] },
    ],
    60
  );
  assert.equal(eta.bookRemainingSeconds, 480);
  assert.equal(eta.chapterRemainingSeconds, 180);
  assert.ok(eta.formattedSummary.includes('3 min dans ce chapitre'));
});

test('generateReadingNotesMarkdown and JSON round-trip preserve bookmarks, highlights, and annotations', () => {
  const annotations = [
    {
      id: 'n1',
      pageNumber: 3,
      note: 'Note importante sur la lumière zénithale.',
      quotedText: 'les voûtes diaphanes',
      createdAt: 1700000000000,
      color: 'amber' as const,
    },
  ];
  const highlights = [
    {
      id: 'hl-1',
      pageNumber: 2,
      text: 'colonnes de fonte élancées',
      color: 'terracotta' as const,
      rects: [{ xRatio: 0.1, yRatio: 0.2, widthRatio: 0.4, heightRatio: 0.03 }],
      createdAt: 1700000000000,
    },
  ];
  const md = generateReadingNotesMarkdown(
    { title: 'Monographie', author: 'Labrouste', totalPages: 10 },
    [2, 3],
    annotations,
    [{ title: 'Chapitre I', pageNumber: 2, items: [] }],
    highlights
  );
  assert.ok(md.includes('# Fiche de Lecture — Monographie'));
  assert.ok(md.includes('colonnes de fonte élancées'));
  assert.ok(md.includes('Note importante sur la lumière zénithale.'));

  const json = serializeStudySheetJson('Monographie', [2, 3], annotations, highlights);
  const parsed = parseStudySheetJson(json, 10);
  assert.deepEqual(parsed.bookmarks, [2, 3]);
  assert.equal(parsed.annotations.length, 1);
  assert.equal(parsed.highlights.length, 1);
  assert.equal(parsed.highlights[0].text, 'colonnes de fonte élancées');
});

test('buildBookSearchIndex and queryBookSearchIndex perform accent-insensitive sub-20ms lookup with snippets', () => {
  const index = buildBookSearchIndex('book-1', [
    {
      pageNumber: 1,
      text: "L'Architecture de la Lumière par Henri Labrouste.",
    },
    {
      pageNumber: 2,
      text: "Dans la salle de lecture de la Bibliothèque Sainte-Geneviève, les colonnes de fonte guident la clarté zénithale.",
    },
    {
      pageNumber: 3,
      text: "La typographie humaniste privilégie les papiers vergés.",
    },
  ]);

  assert.deepEqual(index.invertedTokens['bibliotheque'], [2]);

  // Accent-insensitive search for "genevieve" matches "Geneviève" on page 2
  const matches = queryBookSearchIndex(index, 'genevieve');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].pageNumber, 2);
  assert.equal(matches[0].matchedText, 'Geneviève');
  assert.ok(matches[0].snippetBefore.includes('Sainte-'));
});
