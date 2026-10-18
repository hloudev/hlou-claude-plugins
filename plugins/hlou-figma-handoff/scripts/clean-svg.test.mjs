import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cleanSvg } from './clean-svg.mjs';

const exported = `<svg width="160" height="60" viewBox="0 0 160 60" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="160" height="60" fill="#1E1E1E"/>
<g id="Accueil">
<rect width="1440" height="2400" transform="translate(-80 -32)" fill="#F7F3EE"/>
<g id="Logo">
<rect x="10" y="10" width="20" height="20" fill="white"/>
<path d="M0 0H10V10H0Z" fill="white"/>
<rect width="160" height="60" fill="red"/>
</g>
</g>
<defs>
<clipPath id="c"><rect width="160" height="60" fill="white"/></clipPath>
</defs>
</svg>
`;

describe('cleanSvg', () => {
  it('removes the ancestor backgrounds drawn before the art, and nothing else', () => {
    const { text, removed } = cleanSvg(exported);
    assert.equal(removed, 2);
    assert.ok(!text.includes('#1E1E1E') && !text.includes('#F7F3EE'));
    assert.ok(text.includes('<rect x="10" y="10" width="20" height="20" fill="white"/>'));
    assert.ok(text.includes('fill="red"'));
    assert.ok(
      text.includes('<clipPath id="c"><rect width="160" height="60" fill="white"/></clipPath>')
    );
  });

  it('leaves a clean SVG alone', () => {
    const clean = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>';
    assert.deepEqual(cleanSvg(clean), { text: clean, removed: 0 });
  });
});
