import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('social shorts use the verified Jamm Immo lockup, never the retired wordmark', async () => {
  // Official approved asset already used by Estate Flow's property renderer.
  const image = await readFile(new URL('../public/jamm-immo-logo.png', import.meta.url));
  assert.equal(createHash('sha256').update(image).digest('hex'),
    '096afa1f73f3ff881f614d384970fa7f9b94ce620b9e5456bc856a9fc737bc75');
  for (const component of ['JammLogoMark', 'LogoWatermark']) {
    const source = await readFile(new URL(`../src/components/short/${component}.tsx`, import.meta.url), 'utf8');
    assert.match(source, /staticFile\('jamm-immo-logo\.png'\)/);
    assert.doesNotMatch(source, /jamm-logo-trim|jamm-logo\.jpeg/);
    assert.match(source, /alt="Jamm Immo"/);
  }
});

test('shorts keep the commercial site throughout and all five platform icons on the ending', async () => {
  const source = await readFile(new URL('../src/components/short/SocialBranding.tsx', import.meta.url), 'utf8');
  assert.match(source, /jammimmo\.com/);
  for (const name of ['Facebook', 'Instagram', 'YouTube', 'LinkedIn', 'TikTok']) assert.ok(source.includes(`name: '${name}'`));
  const ending = await readFile(new URL('../src/components/short/Ending.tsx', import.meta.url), 'utf8');
  assert.match(ending, /<SocialIcons \/>/);
  assert.match(ending, /jammimmo\.com/);
  const composition = await readFile(new URL('../src/compositions/JammShort.tsx', import.meta.url), 'utf8');
  assert.match(composition, /<CommercialWebsite \/>/);
});
