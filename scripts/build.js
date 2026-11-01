// Tek dosyalık dağıtım: dist/plank-walker.html (CSS + JS gömülü)
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const html = read('index.html');
const body = html.slice(html.indexOf('<div class="app">'), html.indexOf('<script src'));
const css = read('src/style.css').replace('height: 100vh;', 'height: 100%;');
const out = `<title>Plank Walker</title>
<style>
${css}
</style>
${body}
<script>
${read('src/engine.js')}
</script>
<script>
${read('src/game.js')}
</script>
`;
fs.writeFileSync(path.join(root, 'dist/plank-walker.html'), out);
console.log('dist/plank-walker.html yazıldı,', out.length, 'bayt');
