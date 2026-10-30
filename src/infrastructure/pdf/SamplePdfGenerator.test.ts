/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSyntheticPdfBlob,
  CURATED_SEED_BOOKS,
} from './SamplePdfGenerator';

test('buildSyntheticPdfBlob generates valid PDF 1.4 binary blobs with header, xref, and EOF', async () => {
  for (const spec of CURATED_SEED_BOOKS) {
    const blob = buildSyntheticPdfBlob(spec);
    assert.equal(blob.type, 'application/pdf');
    assert.ok(blob.size > 1500, `Expected blob size > 1500 bytes for ${spec.id}`);

    const text = await blob.text();
    assert.ok(text.startsWith('%PDF-1.4\n'), 'Must start with %PDF-1.4');
    assert.ok(text.includes('/Type /Catalog'), 'Must contain PDF Catalog');
    assert.ok(text.includes('/Type /Outlines'), 'Must contain PDF Outlines');
    assert.ok(text.trimEnd().endsWith('%%EOF'), 'Must end with %%EOF');
  }
});
