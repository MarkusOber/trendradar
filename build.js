#!/usr/bin/env node
/* Erzeugt aus trendradar.html eine statische Datei ohne script und ohne style,
   oder eine eigenstaendige SVG-Datei. Ohne Abhaengigkeiten.

     node build.js trendradar.html -o radar.html
     node build.js trendradar.html --svg -o radar.svg */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ENGINE_RE = /<script id="trendradar-engine">([\s\S]*?)<\/script>/;
const DATA_RES = [
  /<textarea[^>]*\bid="trendradar-data"[^>]*>([\s\S]*?)<\/textarea>/i,
  /<script[^>]*type="application\/json"[^>]*\bid="trendradar-data"[^>]*>([\s\S]*?)<\/script>/i,
  /<template[^>]*\bid="trendradar-data"[^>]*>([\s\S]*?)<\/template>/i
];
const DATA_HINT = 'Kein Datenträger mit id "trendradar-data" in ' + "{FROM}" +
  " gefunden. Erwartet wird <textarea id=\"trendradar-data\">…</textarea>, " +
  "<script type=\"application/json\" id=\"trendradar-data\">…</script> oder " +
  "<template id=\"trendradar-data\">…</template>.";

/* ---------------------------------------------------------------- Argumente */

function usage(code) {
  process.stdout.write(fs.readFileSync(__filename, "utf8").split("*/")[0].replace(/^#!.*\n/, "").replace(/^\/\*/, "/*").trim() + "\n");
  process.exit(code);
}

function parseArgs(argv) {
  const opts = { input: null, out: null, svg: false, legend: true, mode: null, width: null,
                 quiet: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o" || a === "--out") opts.out = argv[++i];
    else if (a === "--svg") opts.svg = true;
    else if (a === "--no-legend") opts.legend = false;
    else if (a === "--mode") opts.mode = argv[++i];
    else if (a === "--width") opts.width = Number(argv[++i]);
    else if (a === "--quiet") opts.quiet = true;
    else if (a === "-h" || a === "--help") usage(0);
    else if (a.charAt(0) === "-") fail("Unbekannte Option: " + a);
    else rest.push(a);
  }
  if (rest.length > 1) fail("Nur eine Eingabedatei erwartet, es wurden " + rest.length + " angegeben.");
  opts.input = rest[0] || null;
  if (!opts.out) {
    if (!opts.input) usage(1);
    const dir = path.dirname(opts.input);
    const base = path.basename(opts.input).replace(/\.html?$/i, "");
    opts.out = path.join(dir, base + (opts.svg ? ".svg" : ".static.html"));
  }
  if (opts.mode && opts.mode !== "grouped" && opts.mode !== "flat") fail("--mode muss grouped oder flat sein.");
  if (opts.width !== null && !(opts.width > 0)) fail("--width muss eine positive Zahl sein.");
  return opts;
}

function fail(msg) {
  process.stderr.write("build.js: " + msg + "\n");
  process.exit(1);
}

function log(opts, msg) { if (!opts.quiet) process.stdout.write(msg + "\n"); }

/* ------------------------------------------------- Engine + Daten aus HTML */

function loadEngine(src, from) {
  const m = ENGINE_RE.exec(src);
  if (!m) fail('Kein <script id="trendradar-engine"> in ' + from + " gefunden.");
  const ctx = vm.createContext({});
  try {
    vm.runInContext(m[1], ctx, { filename: "trendradar-engine.js" });
  } catch (err) {
    fail("Engine lässt sich nicht ausführen: " + err.message);
  }
  if (!ctx.TrendRadar) fail("Die Engine hat globalThis.TrendRadar nicht gesetzt.");
  return ctx.TrendRadar;
}

function loadData(src, from) {
  let raw = null;
  for (const re of DATA_RES) {
    const m = re.exec(src);
    if (m) { raw = m[1]; break; }
  }
  if (raw === null) fail(DATA_HINT.replace("{FROM}", from));
  if (/<\/textarea/i.test(raw)) {
    fail('Der JSON-Block in ' + from + ' enthaelt ein </textarea und wuerde vorzeitig enden. ' +
      "Schreibe stattdessen \\u003c/textarea.");
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail("Der JSON-Block in " + from + " ist ungültig: " + err.message);
  }
}

/* ---------------------------------------------------------------- Ausgabe */

function escHtml(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function headBlock(layout, extra) {
  return '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>' + escHtml(layout.meta.title) + '</title>\n' +
    (extra || "");
}

function buildHtml(TR, layout, mode) {
  const S = TR.STYLE;

  return '<!doctype html>\n' +
'<!-- Statisch erzeugt von build.js aus trendradar.html.\n' +
'     Bewusst ohne JavaScript und ohne Stylesheet: alle Stile stehen als\n' +
'     Inline-Attribute direkt an den Elementen. Deshalb funktioniert die Datei\n' +
'     auch dort, wo ein CMS Skripte oder Stylesheets entfernt. -->\n' +
'<head>\n' + headBlock(layout) + '</head>\n' +
'<body style="margin:0;height:100%;background:' + layout.theme.background + '">\n' +
'<div class="tr-root" id="tr-root" style="' + S.root + TR.themeVarText(layout.theme) + 'border-radius:' + layout.theme.radius + 'px">' +
  '<header class="tr-head" id="tr-head" style="' + S.head + '">' + TR.renderHeadHTML(layout) + '</header>' +
  '<div class="tr-stage" id="tr-stage" style="' + S.stage + '">' + TR.renderSVG(layout) + '</div>' +
  (mode
    ? '<div class="tr-legend-wrap" id="tr-legend-wrap" style="' + S.wrap + '">' +
        TR.renderLegendHTML(layout, mode) + '</div>'
    : "") +
'</div>\n' +
'</body>\n' +
'</html>\n';
}

function buildSvg(TR, layout, width) {
  const svg = TR.renderSVG(layout);
  /* Bei der SVG-Datei sind width/height massgeblich. */
  const vb = layout.viewBox.split(" ");
  const w = width || Math.round(2 * (layout.radius + 10));
  const h = Math.round((w * parseFloat(vb[3])) / parseFloat(vb[2]));
  const fit = ' style="' + TR.STYLE.svgFit + '"';
  if (svg.indexOf(fit) < 0) fail("Das Füll-Stylesheet des Radars wurde nicht gefunden – build.js anpassen.");
  return svg.replace(fit,
    ' xmlns:xlink="http://www.w3.org/1999/xlink" width="' + w + '" height="' + h + '"');
}

/* ------------------------------------------------------- Selbstkontrolle */

function selfCheck(html, opts) {
  const problems = [];
  if (/<\s*script/i.test(html)) problems.push("enthält noch ein <script>");
  if (/<\s*style/i.test(html)) problems.push("enthält noch ein <style>");
  if (/\son[a-z]+\s*=/i.test(html)) problems.push("enthält ein Inline-Event-Attribut (onclick o. Ä.)");
  if (/javascript:/i.test(html)) problems.push("enthält ein javascript:-Protokoll");
  if (/<link\b/i.test(html)) problems.push("enthält ein <link>, also eine externe Abhängigkeit");
  if (/var\(--tr-/.test(html) === false && opts.legend) problems.push("verwendet keine CSS-Variablen");
  if (problems.length) fail("Selbstkontrolle fehlgeschlagen: " + problems.join("; "));
}

/* -------------------------------------------------------------------- Lauf */

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.input) usage(1);
  if (!fs.existsSync(opts.input)) fail("Datei nicht gefunden: " + opts.input);

  const src = fs.readFileSync(opts.input, "utf8");
  const TR = loadEngine(src, opts.input);
  const data = loadData(src, opts.input);

  const norm = TR.validate(data);
  norm.warnings.forEach((w) => process.stderr.write("Hinweis: " + w + "\n"));
  if (norm.errors.length) {
    process.stderr.write("\nbuild.js abbruch – die Daten sind nicht darstellbar:\n");
    norm.errors.forEach((e) => process.stderr.write("  · " + e + "\n"));
    process.exit(1);
  }

  const layout = TR.computeLayout(norm);
  const mode = opts.mode || layout.layout.legend.mode;

  if (layout.overflow) {
    process.stderr.write("Achtung: " + layout.warnings[layout.warnings.length - 1] + "\n");
  }

  const out = opts.svg
    ? buildSvg(TR, layout, opts.width)
    : buildHtml(TR, layout, opts.legend ? mode : null);

  if (!opts.svg) selfCheck(out, opts);

  fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
  fs.writeFileSync(opts.out, out, "utf8");

  const kb = (Buffer.byteLength(out, "utf8") / 1024).toFixed(1);
  log(opts, "  Eingabe   " + opts.input);
  log(opts, "  Ausgabe   " + opts.out + "  (" + kb + " kB)");
  log(opts, "  Trends    " + layout.blips.length +
    " in " + layout.bands.length + " Ringen" +
    (layout.wedges[0] && layout.wedges[0].sector ? " und " + layout.wedges.length + " Sektoren" : ""));
  log(opts, "  Radius    " + layout.radius.toFixed(1) +
    (opts.svg ? "" : "  ·  Legende: " + (opts.legend ? mode + ", unter dem Radar" : "keine")));
  log(opts, "  Enthält   " + (opts.svg ? "nur SVG" : "kein <script>, kein <style>") + (layout.overflow ? "  ·  ÜBERFÜLLT" : ""));
  if (!opts.svg && opts.legend) {
    log(opts, "  Hinweis   Die Legende steht unter dem Radar und scrollt intern.");
    log(opts, "            Der Rahmen braucht etwas Hoehe: unter ca. 420 px wird");
    log(opts, "            der Radar klein. Fuer ein standfestes Bild --svg nutzen.");
  }
}

main();
