import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const swiftShaderFiles = {
  'libEGL.so': '042b405bacc7fa05972709f675565d13a2eac14caa78b8409fa58b94a0122c96',
  'libGLESv2.so': 'a655f4f7e1b08b418e4e813de501b4515ad3e31423f90624b81e55c3cca419c4',
  'libvk_swiftshader.so': '779866fb404293ef8c63dfb2c17e35e8fab3595fa7ac3b683ca07edbc87880af',
  'libvulkan.so.1': 'beef9973938212d21be702c985f34f6efa4119e6075b89d26f3a77ef278becff',
  'vk_swiftshader_icd.json': 'c9eef28b6b984fec220ef0abfecc40b502d46946706e47bfe97707027cb818bd',
};

export function verifySwiftShaderFiles(browserExecutable) {
  const browserDirectory = dirname(browserExecutable);
  for (const [name, expected] of Object.entries(swiftShaderFiles)) {
    const actual = createHash('sha256').update(readFileSync(join(browserDirectory, name))).digest('hex');
    assert.equal(actual, expected, `Unexpected browser file: ${name}`);
  }
  return swiftShaderFiles;
}

export function verifyGraphicsLaunch(launchFlags) {
  const flags = launchFlags.filter(flag => /^--(?:use-gl|use-angle|disable-gpu)(?:=|$)/u.test(flag));
  assert.deepEqual(flags, ['--use-gl=angle', '--use-angle=swiftshader'],
    'The actual Remotion browser launch did not exclusively request SwiftShader');
}

export function verifiedSwiftShader(backend) {
  const { displayType, glImplementationParts, glRenderer, glVendor, glVersion, skiaBackendType } = backend;
  assert.equal(displayType, 'ANGLE_SWIFTSHADER');
  assert.equal(glImplementationParts, '(gl=egl-angle,angle=swiftshader)');
  assert.match(glRenderer ?? '', /SwiftShader Device \(Subzero\)/u);
  assert.match(glVendor ?? '', /\bGoogle\b/u);
  assert.ok(glVersion, 'The observed graphics version is missing');
  assert.equal(skiaBackendType, 'GaneshGL');
  return { displayType, glImplementationParts, glRenderer, glVendor, glVersion, skiaBackendType };
}
