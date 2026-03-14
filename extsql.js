#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const OUTPUT_FILE = "insert_extsql.sql";
const TARGET_TABLE = "SQL_APPEND_EXTRACT";

function main() {
  const rootArg = process.argv[2];
  if (!rootArg) {
    console.error("Usage: node extract-sql-oracle-insert.js <rootDir>");
    process.exit(1);
  }

  const rootDir = path.resolve(rootArg);
  if (!fs.existsSync(rootDir)) {
    console.error("Root directory does not exist: " + rootDir);
    process.exit(1);
  }

  const stat = fs.statSync(rootDir);
  if (!stat.isDirectory()) {
    console.error("Root path is not a directory: " + rootDir);
    process.exit(1);
  }

  const javaFiles = [];
  walkJavaFiles(rootDir, javaFiles);

  const out = [];

  let totalFiles = 0;
  let matchedFiles = 0;
  let totalBlocks = 0;

  for (const filePath of javaFiles) {
    totalFiles++;

    let content;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch (e) {
      console.error("[WARN] Failed to read file: " + filePath);
      console.error("       " + String(e && e.message ? e.message : e));
      continue;
    }

    const result = extractBlocksFromJava(content);
    if (!result.hasPrepareStatement) {
      continue;
    }

    matchedFiles++;
    if (result.blocks.length === 0) {
      continue;
    }

    const relPath = toPosixPath(path.relative(rootDir, filePath));
    let blockNo = 0;

    for (const blockLines of result.blocks) {
      blockNo++;
      totalBlocks++;

      const sqlText = blockLines.join("\n");
      const q = makeOracleQQuote(sqlText);

      out.push(
        "INSERT INTO " +
          TARGET_TABLE +
          " (FILE_PATH, BLOCK_NO, SQL_TEXT) VALUES (",
      );
      out.push("  '" + escapeOracleString(relPath) + "',");
      out.push("  " + blockNo + ",");
      out.push("  " + q);
      out.push(");");
      out.push("");
    }
  }

  out.push("COMMIT;");
  out.push("");

  fs.writeFileSync(OUTPUT_FILE, out.join("\n"), "utf8");

  console.log("Done.");
  console.log("Root       : " + rootDir);
  console.log("Java files  : " + totalFiles);
  console.log("Matched files (has prepareStatement): " + matchedFiles);
  console.log("Blocks      : " + totalBlocks);
  console.log("Output      : " + path.resolve(OUTPUT_FILE));
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
  let appendBuffer = [];
  let hasPrepareStatement = false;

  for (const rawLine of lines) {
    const codeLine = stripCommentsAndStrings(rawLine, state);

    const hasPrepare = containsPrepareStatement(codeLine);
    if (hasPrepare) {
      hasPrepareStatement = true;
      if (appendBuffer.length > 0) {
        blocks.push(appendBuffer.slice());
        appendBuffer = [];
      }
      continue;
    }

    if (containsAppendCall(codeLine)) {
      if (isLikelySqlAppendLine(rawLine, codeLine)) {
        appendBuffer.push(rawLine);
      }
    }
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
  const rawLower = rawLine.toLowerCase();
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

function toPosixPath(p) {
  return p.split(path.sep).join("/");
}

function escapeOracleString(s) {
  return s.replace(/'/g, "''");
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

main();
