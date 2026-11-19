// PERF-02: index.html is a shell; its big <script>/<style> blocks live in app/ and load as /assets/app-*.<hash>.js|css.
// Source-text checks read the page through readAppHtml(): index.html with every split block inlined again
// (byte-identical to the old single-file page). Browser tests must keep loading the real split files over HTTP.
export { readAppHtml, joinHtml } from '../../tools/split-index.mjs';
