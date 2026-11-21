import assert from 'node:assert/strict';
import { sha256 as hash } from './prepare-smoke-input.mjs';

export async function snapshot(page) {
  const client = page._client();
  const response = await client.send('Runtime.evaluate', { expression: `JSON.stringify([document,...Array.from(document.querySelectorAll('iframe')).map(f=>f.contentDocument).filter(Boolean)].map(d=>({
    html:d.documentElement.outerHTML, status:d.fonts.status,
    faces:Array.from(d.fonts).map(f=>({family:f.family,style:f.style,weight:f.weight,status:f.status,stretch:f.stretch,unicodeRange:f.unicodeRange})),
    background:d.defaultView.getComputedStyle(d.body).backgroundColor,
    devicePixelRatio:d.defaultView.devicePixelRatio,
    usedText:Array.from(d.querySelectorAll('*')).flatMap(el=>{
      if(['STYLE','SCRIPT','NOSCRIPT'].includes(el.tagName))return [];
      const text=Array.from(el.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim();
      const c=d.defaultView.getComputedStyle(el),r=el.getBoundingClientRect();
      if(!text||r.width<=0||r.height<=0||c.display==='none'||c.visibility!=='visible'||Number(c.opacity)===0)return [];
      return [{text,font:c.font,family:c.fontFamily,style:c.fontStyle,weight:c.fontWeight,check:d.fonts.check(c.font,text)}];
    })
  })))`, returnByValue: true });
  assert.equal(response.value.exceptionDetails, undefined);
  const text = response.value.result.value;
  const documents = JSON.parse(text);
  assert.ok(documents.every((d) => d.status === 'loaded'));
  const faces = documents.flatMap((d) => d.faces);
  assert.ok([600, 700, 800].every((weight) => faces.some((f) => /Poppins/iu.test(f.family) && Number(f.weight) === weight && f.style === 'normal' && f.status === 'loaded')), 'Each required Poppins face must be loaded');
  assert.ok(faces.every((f) => f.status === 'loaded'), 'Unloaded/error FontFace is not a valid capture prerequisite');
  assert.ok(documents.flatMap((d) => d.usedText).every((r) => r.font && r.check), 'A used computed font fails FontFaceSet.check for its actual text');
  // FontFaceSet.check alone can accept fallbacks. Ask Chromium for the fonts
  // actually supplying glyphs for each rendered Poppins text parent as well.
  await client.send('DOM.enable'); await client.send('CSS.enable');
  const tree = (await client.send('DOM.getDocument', { depth: -1, pierce: true })).value.root;
  const platformText = [];
  const visit = async (node, path) => {
    const directText = (node.children ?? []).filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join('').trim();
    if (node.nodeType === 1 && directText && !['STYLE', 'SCRIPT', 'NOSCRIPT'].includes(node.nodeName)) {
      const style = Object.fromEntries((await client.send('CSS.getComputedStyleForNode', { nodeId: node.nodeId })).value.computedStyle.map((p) => [p.name, p.value]));
      if (style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) !== 0) {
        const fonts = (await client.send('CSS.getPlatformFontsForNode', { nodeId: node.nodeId })).value.fonts.filter((f) => f.glyphCount > 0);
        if (fonts.length) {
          if (/Poppins/iu.test(style['font-family'] ?? '')) assert.ok(fonts.every((f) => f.isCustomFont && /Poppins/iu.test(f.familyName)), 'Actual glyphs use a fallback instead of bundled Poppins');
          platformText.push({ path, text: directText,
            computedFont: Object.fromEntries(['font-family', 'font-style', 'font-weight', 'font-size', 'line-height'].map((key) => [key, style[key]])),
            fonts: fonts.map((f) => ({ family: f.familyName, postScriptName: f.postScriptName ?? null, isCustomFont: f.isCustomFont, glyphCount: f.glyphCount })) });
        }
      }
    }
    for (const [i, child] of (node.children ?? []).entries()) await visit(child, `${path}/${i}`);
    if (node.contentDocument) await visit(node.contentDocument, `${path}/document`);
  };
  await visit(tree, 'root');
  assert.ok(platformText.some((run) => run.fonts.some((f) => f.isCustomFont && /Poppins/iu.test(f.family))), 'No actually rendered bundled-font glyphs were measured');
  return { domSha256: hash(text), documents: documents.map(({ html, ...metadata }) => metadata), platformText };
}
