#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const OUTPUT_FILE = "insert_extsql.sql";
const TARGET_TABLE = "SQL_APPEND_EXTRACT";
const ORACLE_LITERAL_SAFE_BYTES = 3000;

function main() {
  const rootArg = process.argv[2];
  if (!rootArg) {
    console.error("Usage: node extsql.js <rootDir>");
    process.exit(1);
  }

  const rootDir = path.resolve(rootArg);
  validateRootDir(rootDir);

  const javaFiles = [];
  walkJavaFiles(rootDir, javaFiles);

  const out = [];
  const stats = {
    totalFiles: 0,
    matchedFiles: 0,
    totalBlocks: 0,
    totalSqlBytes: 0,
    maxSqlBytes: 0,
    chunkedBlocks: 0,
    skippedReadErrors: 0,
  };

  for (const filePath of javaFiles) {
    stats.totalFiles++;

    let content;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch (e) {
      stats.skippedReadErrors++;
      console.error("[WARN] Failed to read file: " + filePath);
      console.error("       " + String(e && e.message ? e.message : e));
      continue;
    }

    const result = extractBlocksFromJava(content);
    if (!result.hasPrepareStatement) {
      continue;
    }

    stats.matchedFiles++;

    if (result.blocks.length === 0) {
      continue;
    }

    const relPath = toPosixPath(path.relative(rootDir, filePath));

    for (let i = 0; i < result.blocks.length; i++) {
      const blockNo = i + 1;
      const block = result.blocks[i];

      const sqlText = normalizeRecoveredSql(block.fragments);
      if (!sqlText) {
        continue;
      }

      const sqlBytes = Buffer.byteLength(sqlText, "utf8");
      stats.totalBlocks++;
      stats.totalSqlBytes += sqlBytes;
      if (sqlBytes > stats.maxSqlBytes) {
        stats.maxSqlBytes = sqlBytes;
      }

      const clobInfo = makeOracleClobExpressionOneLine(sqlText);
      if (clobInfo.chunkCount > 1) {
        stats.chunkedBlocks++;
      }

      out.push(
        "INSERT INTO " +
          TARGET_TABLE +
          " (FILE_PATH, BLOCK_NO, SQL_TEXT) VALUES (",
      );
      out.push("  '" + escapeOracleString(relPath) + "',");
      out.push("  " + blockNo + ",");
      out.push(indentMultiline(clobInfo.expr, "  "));
      out.push(");");
      out.push("");
    }
  }

  out.push("COMMIT;");
  out.push("");

  fs.writeFileSync(OUTPUT_FILE, out.join("\n"), "utf8");

  console.log("Done.");
  console.log("Root                : " + rootDir);
  console.log("Java files          : " + stats.totalFiles);
  console.log("Matched files       : " + stats.matchedFiles);
  console.log("Blocks              : " + stats.totalBlocks);
  console.log("Chunked blocks      : " + stats.chunkedBlocks);
  console.log("Total SQL bytes     : " + stats.totalSqlBytes);
  console.log("Max SQL bytes       : " + stats.maxSqlBytes);
  console.log("Read errors         : " + stats.skippedReadErrors);
  console.log("Output              : " + path.resolve(OUTPUT_FILE));
}

function validateRootDir(rootDir) {
  if (!fs.existsSync(rootDir)) {
    console.error("Root directory does not exist: " + rootDir);
    process.exit(1);
  }

  const stat = fs.statSync(rootDir);
  if (!stat.isDirectory()) {
    console.error("Root path is not a directory: " + rootDir);
    process.exit(1);
  }
}

function walkJavaFiles(dir, result) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walkJavaFiles(fullPath, result);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (entry.name.toLowerCase().endsWith(".java")) {
      result.push(fullPath);
    }
  }
}

function extractBlocksFromJava(content) {
  const lines = splitLines(content);

  const state = {
    inBlockComment: false,
  };

  const blocks = [];
  let currentFragments = [];
  let hasPrepareStatement = false;

  for (const rawLine of lines) {
    const codeLine = stripCommentsAndStrings(rawLine, state);

    if (containsPrepareStatement(codeLine)) {
      hasPrepareStatement = true;

      if (currentFragments.length > 0) {
        blocks.push({ fragments: currentFragments.slice() });
        currentFragments = [];
      }
      continue;
    }

    if (!containsAppendCall(codeLine)) {
      continue;
    }

    if (!isLikelySqlAppendLine(rawLine, codeLine)) {
      continue;
    }

    const appendArg = extractAppendArgument(rawLine);
    if (appendArg == null) {
      continue;
    }

    const fragment = recoverAppendFragment(appendArg);
    if (fragment == null) {
      continue;
    }

    currentFragments.push(fragment);
  }

  if (currentFragments.length > 0) {
    blocks.push({ fragments: currentFragments.slice() });
  }

  return {
    hasPrepareStatement,
    blocks,
  };
}

function splitLines(content) {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function stripCommentsAndStrings(line, state) {
  let out = "";
  let i = 0;

  let inString = false;
  let inChar = false;
  let escape = false;

  while (i < line.length) {
    const ch = line[i];
    const next = i + 1 < line.length ? line[i + 1] : "";

    if (state.inBlockComment) {
      if (ch === "*" && next === "/") {
        state.inBlockComment = false;
        out += "  ";
        i += 2;
      } else {
        out += " ";
        i++;
      }
      continue;
    }

    if (inString) {
      if (escape) {
        out += " ";
        escape = false;
        i++;
        continue;
      }
      if (ch === "\\") {
        out += " ";
        escape = true;
        i++;
        continue;
      }
      if (ch === '"') {
        out += " ";
        inString = false;
        i++;
        continue;
      }
      out += " ";
      i++;
      continue;
    }

    if (inChar) {
      if (escape) {
        out += " ";
        escape = false;
        i++;
        continue;
      }
      if (ch === "\\") {
        out += " ";
        escape = true;
        i++;
        continue;
      }
      if (ch === "'") {
        out += " ";
        inChar = false;
        i++;
        continue;
      }
      out += " ";
      i++;
      continue;
    }

    if (ch === "/" && next === "*") {
      state.inBlockComment = true;
      out += "  ";
      i += 2;
      continue;
    }

    if (ch === "/" && next === "/") {
      out += " ".repeat(line.length - i);
      break;
    }

    if (ch === '"') {
      inString = true;
      out += " ";
      i++;
      continue;
    }

    if (ch === "'") {
      inChar = true;
      out += " ";
      i++;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

function containsPrepareStatement(codeLine) {
  return /\bprepareStatement\s*\(/.test(codeLine);
}

function containsAppendCall(codeLine) {
  return /\.\s*append\s*\(/.test(codeLine);
}

function isLikelySqlAppendLine(rawLine, codeLine) {
  const receiver = extractAppendReceiver(codeLine);
  const receiverLower = receiver.toLowerCase();

  if (
    /(logger|log|logs|debug|trace|warn|error|message|msg|print|println|printf)/.test(
      receiverLower,
    )
  ) {
    return false;
  }

  if (
    /"(?:[^"\\]|\\.)*\b(select|insert|update|delete|merge|with|from|where|join|left|right|inner|outer|group\s+by|order\s+by|having|union|into|values|set)\b(?:[^"\\]|\\.)*"/i.test(
      rawLine,
    )
  ) {
    return true;
  }

  if (
    /(sql|query|stmt|statement|select|insert|update|delete|where|from|join|union|order|group|having|sb|sqlsb|sqlbuf|builder|strbuf|stringbuilder)/.test(
      receiverLower,
    )
  ) {
    return true;
  }

  if (
    /\b(sql|query|stmt|statement|select|insert|update|delete|where|from|join|union|order|group|having)\b/i.test(
      codeLine,
    )
  ) {
    return true;
  }

  return false;
}

function extractAppendReceiver(codeLine) {
  const m = codeLine.match(/([A-Za-z_][A-Za-z0-9_\.]*)\s*\.\s*append\s*\(/);
  return m ? m[1] : "";
}

function extractAppendArgument(rawLine) {
  const appendIndex = rawLine.indexOf(".append(");
  if (appendIndex < 0) {
    return null;
  }

  const openParenIndex = rawLine.indexOf("(", appendIndex);
  if (openParenIndex < 0) {
    return null;
  }

  let i = openParenIndex + 1;
  let depth = 1;
  let inString = false;
  let inChar = false;
  let escape = false;

  while (i < rawLine.length) {
    const ch = rawLine[i];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      i++;
      continue;
    }

    if (inChar) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === "'") {
        inChar = false;
      }
      i++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      i++;
      continue;
    }

    if (ch === "'") {
      inChar = true;
      i++;
      continue;
    }

    if (ch === "(") {
      depth++;
      i++;
      continue;
    }

    if (ch === ")") {
      depth--;
      if (depth === 0) {
        return rawLine.substring(openParenIndex + 1, i).trim();
      }
      i++;
      continue;
    }

    i++;
  }

  return null;
}

function recoverAppendFragment(argText) {
  if (!argText) {
    return null;
  }

  const stringLiteral = recoverConcatenatedStringLiteral(argText);
  if (stringLiteral != null) {
    return stringLiteral;
  }

  return "/*dynamic*/";
}

function recoverConcatenatedStringLiteral(argText) {
  let i = 0;
  let result = "";
  let foundString = false;

  while (i < argText.length) {
    i = skipSpaces(argText, i);
    if (i >= argText.length) {
      break;
    }

    if (argText[i] !== '"') {
      return null;
    }

    const parsed = parseJavaStringLiteral(argText, i);
    if (!parsed) {
      return null;
    }

    result += parsed.value;
    foundString = true;
    i = skipSpaces(argText, parsed.nextIndex);

    if (i >= argText.length) {
      break;
    }

    if (argText[i] !== "+") {
      return null;
    }

    i++;
  }

  return foundString ? result : null;
}

function parseJavaStringLiteral(text, startIndex) {
  if (text[startIndex] !== '"') {
    return null;
  }

  let i = startIndex + 1;
  let out = "";

  while (i < text.length) {
    const ch = text[i];

    if (ch === '"') {
      return {
        value: out,
        nextIndex: i + 1,
      };
    }

    if (ch === "\\") {
      if (i + 1 >= text.length) {
        return null;
      }

      const next = text[i + 1];

      switch (next) {
        case "n":
          out += "\n";
          i += 2;
          break;
        case "r":
          out += "\r";
          i += 2;
          break;
        case "t":
          out += "\t";
          i += 2;
          break;
        case "b":
          out += "\b";
          i += 2;
          break;
        case "f":
          out += "\f";
          i += 2;
          break;
        case "\\":
          out += "\\";
          i += 2;
          break;
        case '"':
          out += '"';
          i += 2;
          break;
        case "'":
          out += "'";
          i += 2;
          break;
        case "u": {
          if (i + 5 >= text.length) {
            return null;
          }
          const hex = text.substring(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            return null;
          }
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          break;
        }
        default:
          if (/[0-7]/.test(next)) {
            let j = i + 1;
            let oct = "";
            let count = 0;
            while (j < text.length && /[0-7]/.test(text[j]) && count < 3) {
              oct += text[j];
              j++;
              count++;
            }
            out += String.fromCharCode(parseInt(oct, 8));
            i = j;
            break;
          }
          out += next;
          i += 2;
          break;
      }

      continue;
    }

    out += ch;
    i++;
  }

  return null;
}

function skipSpaces(text, i) {
  while (i < text.length && /\s/.test(text[i])) {
    i++;
  }
  return i;
}

function normalizeRecoveredSql(fragments) {
  if (!fragments || fragments.length === 0) {
    return "";
  }

  const normalized = [];
  let previousWasDynamic = false;

  for (const fragment of fragments) {
    let s = fragment;

    if (s == null) {
      continue;
    }

    s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    s = s.replace(/\s+/g, " ").trim();

    if (!s) {
      continue;
    }

    if (s === "/*dynamic*/") {
      if (previousWasDynamic) {
        continue;
      }
      normalized.push(s);
      previousWasDynamic = true;
      continue;
    }

    normalized.push(s);
    previousWasDynamic = false;
  }

  return normalized.join(" ").replace(/\s+/g, " ").trim();
}

function toPosixPath(p) {
  return p.split(path.sep).join("/");
}

function escapeOracleString(s) {
  return s.replace(/'/g, "''");
}

function makeOracleClobExpressionOneLine(text) {
  if (text.length === 0) {
    return {
      expr: "EMPTY_CLOB()",
      chunkCount: 0,
    };
  }

  const chunks = splitTextByUtf8Bytes(text, ORACLE_LITERAL_SAFE_BYTES);
  const parts = [];

  for (let i = 0; i < chunks.length; i++) {
    const q = makeOracleQQuote(chunks[i]);

    if (i === 0) {
      parts.push("TO_CLOB(" + q + ")");
    } else {
      parts.push("|| " + q);
    }
  }

  return {
    expr: parts.join("\n"),
    chunkCount: chunks.length,
  };
}

function splitTextByUtf8Bytes(text, maxBytes) {
  const result = [];
  let current = "";
  let currentBytes = 0;

  for (const ch of text) {
    const b = Buffer.byteLength(ch, "utf8");

    if (currentBytes > 0 && currentBytes + b > maxBytes) {
      result.push(current);
      current = ch;
      currentBytes = b;
      continue;
    }

    current += ch;
    currentBytes += b;
  }

  if (current.length > 0) {
    result.push(current);
  }

  return result;
}

function makeOracleQQuote(text) {
  const candidates = [
    ["[", "]"],
    ["{", "}"],
    ["(", ")"],
    ["<", ">"],
    ["!", "!"],
    ["#", "#"],
    ["~", "~"],
    ["|", "|"],
    ["^", "^"],
    ["%", "%"],
    ["/", "/"],
    ["@", "@"],
    ["$", "$"],
  ];

  for (const pair of candidates) {
    const open = pair[0];
    const close = pair[1];
    const endMarker = close + "'";
    if (text.indexOf(endMarker) === -1) {
      return "q'" + open + text + close + "'";
    }
  }

  for (let c = 33; c <= 126; c++) {
    const ch = String.fromCharCode(c);
    if (/\s/.test(ch)) {
      continue;
    }
    const endMarker = ch + "'";
    if (text.indexOf(endMarker) === -1) {
      return "q'" + ch + text + ch + "'";
    }
  }

  throw new Error("Failed to choose Oracle q-quote delimiter.");
}

function indentMultiline(text, indent) {
  return text
    .split("\n")
    .map((line) => indent + line)
    .join("\n");
}

main();
