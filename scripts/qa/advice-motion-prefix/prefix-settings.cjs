const divergent = [1, 2, 22, 78, 124, 130];
const controls = [0, 3, 21, 23, 77, 79, 123, 125, 129, 131];
module.exports = {
  sourceSha: '33d46b8c8ff4862846c9ad92464172ede055a546',
  frameCount: 132,
  divergent,
  controls,
  pairedFrames: [...divergent, ...controls].sort((a, b) => a - b),
};
