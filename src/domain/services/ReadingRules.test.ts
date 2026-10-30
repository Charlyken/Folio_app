/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateProgressPercentage,
  calculateRemainingPercentage,
  clampZoomLevel,
  formatFileSize,
  getNextPageNumber,
  getPrefetchPageNumber,
  getPreviousPageNumber,
  getVisiblePageNumbers,
  normalizeTargetPage,
  stepZoomIn,
  stepZoomOut,
  togglePageBookmark,
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
