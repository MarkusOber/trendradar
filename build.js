#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════
   build.js — erzeugt die statische Variante eines Trendradars.

  (node build.js, kein npm, keine Abhängigkeiten, kein Netzwerk.)

   Die Quelle der Wahrheit bleibt trendradar.html samt JSON-Block. Dieses
   Skript führt den Engine-Block aus der HTML-Datei in einer Node-vm aus und
   rendert daraus eine fertige Datei, die KEIN JavaScript und KEIN <style>
   benötigt — nur noch Markup mit Inline-Styles.

   Deshalb können interaktive und statische Variante nicht auseinanderlaufen:
   beide benutzen exakt dieselben Funktionen.

   ───────────────────────────────────────────────────────────────────────
   AUFRUF
   ───────────────────────────────────────────────────────────────────────
     node build.js <trendradar.html> [-o <out.html>] [Optionen]

   Optionen
     -o, --out <datei>   Zieldatei (Standard: <eingabe> ohne .html + .static.html)
         --svg           Nur den Radar als eigenständige SVG-Datei
         --no-legend     Keine Legende (nur mit --svg sinnvoll)
      --mode <m>      Legendenform: grouped (Standard) | flat
      --width <px>    Feste Breite in px für --svg (Standard: 2 × Radius + 40)
         --quiet         Nur Fehler ausgeben
     -h, --help          Diese Hilfe

   ───────────────────────────────────────────────────────────────────────
   BEISPIELE
   ───────────────────────────────────────────────────────────────────────
     node build.js trendradar.html -o dist/trendradar-intranet.html
     node build.js trendradar.html --svg -o dist/radar.svg
     node build.js trendradar.html --svg --no-legend --width 1600 -o slides/radar.svg

   ───────────────────────────────────────────────────────────────────────
   WAS DIE STATISCHE VARIANTE ANDERS MACHT
   ───────────────────────────────────────────────────────────────────────
   Ohne Browser lässt sich das Seitenlayout nicht messen. Hier steht es
   deshalb fest: die Legende liegt immer unter dem Radar und nimmt höchstens
   38 % der Rahmenhöhe ein, darunter scrollt sie. Der Radar behält damit in
   jedem Rahmen den größeren Anteil – es gibt nichts zu konfigurieren.

      · Es gibt keine Druck-Formatierung. Die interaktive Variante druckt mit
        Seitenumbruch und ohne Hintergründe; für PDFs ist --svg die bessere
        Wahl, weil dort die Bemaßung feststeht.

   Der reine Radar ist davon nicht betroffen: --svg ist maßstabsgetreu.
   ═══════════════════════════════════════════════════════════════════════ */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ENGINE_RE = /<script id="trendradar-engine">([\s\S]*?)<\/script>/;
const DATA_RE = /<script type="application\/json" id="trendradar-data">([\s\S]*?)<\/script>/;

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
  const m = DATA_RE.exec(src);
  if (!m) fail('Kein <script type="application/json" id="trendradar-data"> in ' + from + " gefunden.");
  try {
    return JSON.parse(m[1]);
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
  /* Für die eigenständige SVG-Datei sind width/height maßgeblich. Das
     Füll-Stylesheet des eingebetteten Radars (position:absolute;inset:0)
     wird deshalb durch feste Pixelmaße ersetzt – andernfalls wäre die Datei
     unsichtbar. */
  const vb = layout.viewBox.split(" ");
  const w = width || Math.round(2 * (layout.radius + 10));
  const h = Math.round((w * parseFloat(vb[3])) / parseFloat(vb[2]));
  const fit = ' style="' + TR.STYLE.svgFit + '"';
  if (svg.indexOf(fit) < 0) fail("Das Füll-Stylesheet des Radars wurde nicht gefunden – build.js anpassen.");
  return svg.replace(fit,
    ' xmlns:xlink="http://www.w3.org/1999/xlink" width="' + w + '" height="' + h + '"');
}

/* ------------------------------------------------------- Selbstkontrolle */

/* Das ganze Versprechen der statischen Variante ist "kein JavaScript, kein
   <style>". Das wird nach dem Bau nachgeprüft, nicht angenommen. */
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
  /* Die Legende steht fest unter dem Radar und nimmt hoechstens 38 % der
     Rahmenhoehe ein; darunter scrollt sie. Der Radar behält damit immer den
     groesseren Anteil - unabhaengig davon, wie breit der Einbau ist. */
  if (!opts.svg && opts.legend) {
    log(opts, "  Hinweis   Die Legende steht unter dem Radar und scrollt intern.");
    log(opts, "            Der Rahmen braucht etwas Hoehe: unter ca. 420 px wird");
    log(opts, "            der Radar klein. Fuer ein standfestes Bild --svg nutzen.");
  }
}

main();
