/* Entfernt Kommentare aus trendradar.html und schreibt das Ergebnis
   als kommentarbereinigte Fassung.

   Kein Regex-Ersatz auf den ganzen Text: der Code enthaelt Regex-Literale
   (replace(/["'\\;<>{}]/g ...)), Zeilenkommentare in Strings mit "https://"
   und ein JSON-Datenblock mit Kommentaren. Ein blinder /\/\*.*?\*\// lauefe
   mitten in ein Regex hinein. Deshalb ein echter Zustandsautomat, der
   Zeichen fuer Zeichen laeuft und weiss, ob er in einem String, einem
   Regex-Literal, einem CSS-Block oder einem Skript steht.

   Leere Zeilen und Einrueckung entfernt nur --kompakt. Zeilenumbrueche
   bleiben dabei erhalten: in JavaScript kann das Weglassen eines Umbruchs
   die Bedeutung aendern, weil der Parser an neuen Zeilen Trennstellen
   erkennt ("return" am Zeilenende, automatische Semikolons). Nur die
   Leerzeichen am Zeilenanfang sind gefahrlos.

   Aufruf:  node strip-kommentare.js <quelle> <ziel> [--kompakt]
*/
"use strict";

const fs = require("fs");

const src = process.argv[2] || "trendradar.html";
const dst = process.argv[3] || "trendradar-lean.html";
const kompakt = process.argv.includes("--kompakt");

const s = fs.readFileSync(src, "utf8");

const stat = {
  html: 0, css: 0, jsLine: 0, jsBlock: 0,
  bytesHtml: 0, bytesCss: 0, bytesJsLine: 0, bytesJsBlock: 0,
  regexLiterals: 0, strings: 0, unterminated: []
};

/* Nach welchem Zeichen darf ein / einen Regex eroeffnen? Nach einer
   Zahl, einem Bezeichner, ) oder ] waere es eine Division. */
const REGEX_AFTER_KEYWORD = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
  "throw", "case", "do", "else", "yield", "await"
]);

function lastSignificant(out) {
  for (let i = out.length - 1; i >= 0; i--) {
    const ch = out[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") continue;
    return ch;
  }
  return "";
}

function lastWord(out) {
  let i = out.length - 1;
  while (i >= 0 && /[A-Za-z0-9_$]/.test(out[i])) i--;
  return out.slice(i + 1);
}

/* Blendet /* aus. */
function isStarSlashComment(src, i) {
  return src[i] === "/" && src[i + 1] === "*";
}

/* Sammelt CSS-Kommentare in Strings. Sollte es im Dokument nicht
   geben - dann stimmt die Annahme, dass Strings keine Kommentare
   enthalten, und das Skript meldet es. */
function scanStringForComment(text, kind) {
  if (text.indexOf("/*") >= 0) {
    stat.unterminated.push(kind + " mit /* im String: " +
      text.slice(0, 60).replace(/\n/g, "\\n"));
  }
}

/* --- CSS-Block: nur Kommentare und Strings kennt --- */
function stripCss(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (isStarSlashComment(text, i)) {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      stat.css++; stat.bytesCss += stop - i;
      out += "\n".repeat(text.slice(i, stop).split("\n").length - 1);
      i = stop;
      continue;
    }
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) {
        if (text[j] === "\\") j++;
        j++;
      }
      scanStringForComment(text.slice(i, j + 1), "CSS-String");
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/* --- JavaScript: Kommentare, Strings, Regex-Literale --- */
function stripJs(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (isStarSlashComment(text, i)) {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      stat.jsBlock++; stat.bytesJsBlock += stop - i;
      /* Zeilenumbrueche erhalten, sonst rutscht alles in eine Zeile. */
      const body = text.slice(i, stop);
      const nl = body.split("\n").length - 1;
      out += "\n".repeat(nl);
      i = stop;
      continue;
    }

    if (ch === "/" && text[i + 1] === "/") {
      let end = text.indexOf("\n", i);
      if (end < 0) end = text.length;
      stat.jsLine++; stat.bytesJsLine += end - i;
      i = end;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "\\") { j += 2; continue; }
        if (text[j] === ch) break;
        if (text[j] === "\n" && ch !== "`") break;
        j++;
      }
      const raw = text.slice(i, j + 1);
      scanStringForComment(raw, "JS-String");
      stat.strings++;
      out += raw;
      i = j + 1;
      continue;
    }

    if (ch === "/") {
      const prev = lastSignificant(out);
      const word = lastWord(out);
      const isRegex = prev === "" || "(,=:[!&|?{};+-*%~^".includes(prev) ||
        REGEX_AFTER_KEYWORD.has(word);
      if (isRegex) {
        let j = i + 1;
        let inClass = false;
        while (j < text.length) {
          const c = text[j];
          if (c === "\\") { j += 2; continue; }
          if (c === "\n") break;
          if (c === "[") inClass = true;
          else if (c === "]") inClass = false;
          else if (c === "/" && !inClass) break;
          j++;
        }
        stat.regexLiterals++;
        out += text.slice(i, j + 1);
        i = j + 1;
        /* Flags a laufe. */
        while (i < text.length && /[a-z]/.test(text[i])) { out += text[i]; i++; }
        continue;
      }
      out += ch;
      i++;
      continue;
    }

    out += ch;
    i++;
  }
  return out;
}

/* --- HTML auf oberster Ebene --- */
let out = "";
let i = 0;
let mode = "html";

while (i < s.length) {
  if (mode === "html") {
    if (s.startsWith("<!--", i)) {
      const end = s.indexOf("-->", i);
      const stop = end < 0 ? s.length : end + 3;
      stat.html++; stat.bytesHtml += stop - i;
      out += "\n".repeat(s.slice(i, stop).split("\n").length - 1);
      i = stop;
      continue;
    }
    if (s.startsWith("<style", i)) {
      const open = s.indexOf(">", i) + 1;
      const close = s.indexOf("</style>", open);
      out += s.slice(i, open);
      out += stripCss(s.slice(open, close));
      out += s.slice(close, close + 8);
      i = close + 8;
      continue;
    }
    if (s.startsWith("<script", i)) {
      const open = s.indexOf(">", i) + 1;
      const close = s.indexOf("</script>", open);
      out += s.slice(i, open);
      out += stripJs(s.slice(open, close));
      out += s.slice(close, close + 9);
      i = close + 9;
      continue;
    }
    out += s[i];
    i++;
    continue;
  }
}

/* Leerzeilen und Einrueckung. Beides nur am Zeilenanfang und nur fuer
   Zeilen, die nach dem Leerzeichenschnitt nichts mehr tragen. Der
   Umbruch selbst bleibt: in JavaScript aendert ein fehlender Umbruch
   die Bedeutung, weil der Parser dort Trennstellen erkennt - ein
   "return" am Zeilenende holt sich sonst sein Argument von der
   naechsten Zeile, und automatisch eingesetzte Semikolons fallen weg.
   CSS ist unkritisch, solange kein Selector und kein Wert am Umbruch
   zerschlagen wird; eine URL in content:() ist hier nicht vorhanden,
   sonst muesste sie geschuetzt werden. */
if (kompakt) {
  const zeilen = out.split("\n");
  const vorher = zeilen.length;
  let leer = 0, eingerueckt = 0;
  const neu = [];
  for (const z of zeilen) {
    if (z.trim() === "") { leer++; continue; }
    const ohne = z.replace(/^[ \t]+/, "");
    eingerueckt += z.length - ohne.length;
    neu.push(ohne);
  }
  out = neu.join("\n");
  stat.leerzeilen = leer;
  stat.einrueckung = eingerueckt;
  stat.zeilenVorher = vorher;
  stat.zeilenNachher = neu.length;
}

fs.writeFileSync(dst, out, "utf8");

const kb = (n) => (n / 1024).toFixed(1) + " KB";
console.log("== entfernt ==");
console.log("  HTML-Kommentare   " + stat.html + " Stueck  " + kb(stat.bytesHtml));
console.log("  CSS-Kommentare    " + stat.css + " Stueck  " + kb(stat.bytesCss));
console.log("  JS-Zeilenkommentare " + stat.jsLine + " Stueck  " + kb(stat.bytesJsLine));
console.log("  JS-Blockkommentare  " + stat.jsBlock + " Stueck  " + kb(stat.bytesJsBlock));
const total = stat.bytesHtml + stat.bytesCss + stat.bytesJsLine + stat.bytesJsBlock;
console.log("  Summe            " + (stat.html + stat.css + stat.jsLine + stat.jsBlock) +
  " Stueck  " + kb(total));
console.log();
console.log("== gelesen ==");
console.log("  Strings          " + stat.strings);
console.log("  Regex-Literale   " + stat.regexLiterals);
if (kompakt) {
  console.log();
  console.log("== kompakt ==");
  console.log("  Leerzeilen     " + stat.leerzeilen + " entfernt");
  console.log("  Einrueckung    " + kb(stat.einrueckung));
  console.log("  Zeilen         " + stat.zeilenVorher + " -> " + stat.zeilenNachher);
  console.log("  Zeilenumbrueche erhalten - sie sind in JavaScript bedeutungstragend");
}

console.log();
console.log("== Groesse ==");
console.log("  vorher  " + s.length + " Bytes");
console.log("  nachher " + out.length + " Bytes  (" +
  (100 - (out.length / s.length * 100)).toFixed(1) + " % kleiner)");
if (stat.unterminated.length) {
  console.log();
  console.log("!! AUFFAELLIG:");
  stat.unterminated.forEach(function (u) { console.log("   " + u); });
}
