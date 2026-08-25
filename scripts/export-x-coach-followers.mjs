#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const X_API = "https://api.x.com/2";
const USER_FIELDS = [
  "created_at",
  "description",
  "location",
  "public_metrics",
  "url",
  "username",
  "verified",
].join(",");

const STRONG_ROLE_PATTERNS = [
  ["Head Baseball Coach", /\bhead\s+(?:men['’]s\s+)?baseball\s+coach\b/i],
  ["Pitching Coach", /\bpitching\s+coach\b/i],
  ["Hitting Coach", /\bhitting\s+coach\b/i],
  ["Baseball Coach", /\bbaseball\s+coach\b/i],
  ["Assistant Baseball Coach", /\b(?:assistant|asst\.?)\s+(?:baseball\s+)?coach\b/i],
  ["Recruiting Coordinator", /\b(?:baseball\s+)?recruiting\s+coordinator\b/i],
  ["Player Development", /\b(?:director\s+of\s+)?player\s+development\b/i],
  ["Director of Baseball Operations", /\bdirector\s+of\s+baseball\s+operations\b/i],
  ["Bullpen Coach", /\bbullpen\s+coach\b/i],
  ["Bench Coach", /\bbench\s+coach\b/i],
];

const BASEBALL_TERMS = /\b(baseball|pitching|hitting|pitcher|hitter|bullpen|diamond|ncaa|naia|njcaa|juco|mlb)\b/i;
const GENERIC_COACH = /\b(head|assistant|asst\.?|associate|volunteer)?\s*coach\b/i;
const NON_BASEBALL_SPORTS = /\b(softball|football|basketball|soccer|lacrosse|volleyball|hockey|wrestling|golf|tennis|swimming|track(?:\s+and\s+field)?|cross\s+country)\b/i;
const NON_SPORT_COACHING = /\b(life|business|executive|fitness|health|career|leadership|dating|mindset)\s+coach\b/i;

function parseArgs(argv) {
  const result = { username: process.env.X_USERNAME || "", inputJson: "", outputDir: "private_exports/x-coaches" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--username") result.username = argv[++index] || "";
    else if (argument === "--input-json") result.inputJson = argv[++index] || "";
    else if (argument === "--output-dir") result.outputDir = argv[++index] || result.outputDir;
    else if (argument === "--help" || argument === "-h") result.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

function usage() {
  return `Usage:
  X_API_BEARER_TOKEN=... X_USERNAME=... node scripts/export-x-coach-followers.mjs
  node scripts/export-x-coach-followers.mjs --input-json followers.json

Options:
  --username <handle>       X username without @ (or set X_USERNAME)
  --input-json <path>       Classify an existing JSON array/API response without network access
  --output-dir <path>       Private output directory (default: private_exports/x-coaches)`;
}

async function xRequest(endpoint, token) {
  const response = await fetch(`${X_API}${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.detail || body?.title || body?.errors?.[0]?.detail || response.statusText;
    throw new Error(`X API ${response.status}: ${detail}`);
  }
  return body;
}

async function fetchFollowers(username, token) {
  const cleanUsername = username.replace(/^@/, "").trim();
  if (!cleanUsername) throw new Error("Set X_USERNAME or pass --username.");
  const lookup = await xRequest(`/users/by/username/${encodeURIComponent(cleanUsername)}?user.fields=id,name,username`, token);
  if (!lookup.data?.id) throw new Error(`Could not find X user @${cleanUsername}.`);

  const followers = [];
  let paginationToken = "";
  do {
    const params = new URLSearchParams({ max_results: "1000", "user.fields": USER_FIELDS });
    if (paginationToken) params.set("pagination_token", paginationToken);
    const page = await xRequest(`/users/${lookup.data.id}/followers?${params}`, token);
    followers.push(...(page.data || []));
    paginationToken = page.meta?.next_token || "";
    process.stderr.write(`Retrieved ${followers.length.toLocaleString()} followers\n`);
  } while (paginationToken);
  return { owner: lookup.data, followers };
}

function extractOrganization(bio) {
  const cleaned = bio.replace(/https?:\/\/\S+/gi, " ").replace(/\s+/g, " ").trim();
  const patterns = [
    /\b(?:head\s+baseball|pitching|hitting|assistant\s+baseball|baseball)\s+coach\s+(?:at|for|with)\s+([^|•·;,]{2,70})/i,
    /\b(?:head\s+coach|pitching\s+coach|hitting\s+coach|recruiting\s+coordinator|player\s+development)\s*[-–—|•·]\s*([^|•·;,]{2,70})/i,
    /\b(?:coach|coordinator|player\s+development)\s+@([A-Za-z0-9_]{2,30})\b/i,
  ];
  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match?.[1]) return match[1].trim().replace(/[.!]+$/, "");
  }
  return "";
}

export function classifyFollower(user) {
  const bio = String(user.description || "").trim();
  const roles = STRONG_ROLE_PATTERNS.filter(([, pattern]) => pattern.test(bio)).map(([role]) => role);
  const hasBaseball = BASEBALL_TERMS.test(bio);
  const hasGenericCoach = GENERIC_COACH.test(bio);
  const hasOtherSport = NON_BASEBALL_SPORTS.test(bio);
  const hasNonSportCoach = NON_SPORT_COACHING.test(bio);

  let confidence = "not_match";
  let reason = "No baseball coaching language detected";
  if (roles.length > 0 && !hasNonSportCoach) {
    confidence = "high";
    reason = `Matched explicit role: ${roles.join("; ")}`;
  } else if (hasBaseball && hasGenericCoach && !hasNonSportCoach) {
    confidence = hasOtherSport ? "review" : "medium";
    reason = "Matched baseball language and a generic coaching title";
  } else if (hasBaseball && !hasNonSportCoach) {
    confidence = "review";
    reason = "Baseball language detected without an explicit coaching title";
  } else if (hasOtherSport || hasNonSportCoach) {
    reason = "Excluded or flagged non-baseball coaching language";
  }

  const metrics = user.public_metrics || {};
  return {
    confidence,
    name: user.name || "",
    handle: user.username ? `@${user.username}` : "",
    profile_url: user.username ? `https://x.com/${user.username}` : "",
    role: roles.join("; "),
    school_or_organization_from_bio: extractOrganization(bio),
    location: user.location || "",
    bio,
    match_reason: reason,
    follower_count: metrics.followers_count ?? "",
    following_count: metrics.following_count ?? "",
    verified: user.verified === true ? "yes" : "no",
    x_user_id: user.id || "",
  };
}

function csvCell(value) {
  let text = String(value ?? "").replace(/\r?\n/g, " ");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(rows) {
  const columns = [
    "confidence", "name", "handle", "profile_url", "role",
    "school_or_organization_from_bio", "location", "bio", "match_reason",
    "follower_count", "following_count", "verified", "x_user_id",
  ];
  return [columns.join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n") + "\n";
}

async function readInputJson(inputPath) {
  const parsed = JSON.parse(await fs.readFile(inputPath, "utf8"));
  if (Array.isArray(parsed)) return { owner: null, followers: parsed };
  if (Array.isArray(parsed.followers)) return { owner: parsed.owner || null, followers: parsed.followers };
  if (Array.isArray(parsed.data)) return { owner: null, followers: parsed.data };
  throw new Error("Input JSON must be an array, an X API response with data[], or { followers: [] }.");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.inputJson && !process.env.X_API_BEARER_TOKEN) {
    throw new Error("Set X_API_BEARER_TOKEN. Do not paste the token into chat or commit it to Git.");
  }
  const source = options.inputJson
    ? await readInputJson(options.inputJson)
    : await fetchFollowers(options.username, process.env.X_API_BEARER_TOKEN || "");

  const rows = source.followers.map(classifyFollower);
  const priority = { high: 0, medium: 1, review: 2, not_match: 3 };
  rows.sort((left, right) => priority[left.confidence] - priority[right.confidence] || left.name.localeCompare(right.name));
  const coaches = rows.filter((row) => row.confidence !== "not_match");
  const date = new Date().toISOString().slice(0, 10);
  const outputDir = path.resolve(options.outputDir);
  await fs.mkdir(outputDir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(outputDir, `coach-followers-${date}.csv`), toCsv(coaches)),
    fs.writeFile(path.join(outputDir, `all-followers-classified-${date}.csv`), toCsv(rows)),
    fs.writeFile(path.join(outputDir, `source-followers-${date}.json`), JSON.stringify(source, null, 2) + "\n"),
  ]);
  const counts = Object.fromEntries(["high", "medium", "review", "not_match"].map((key) => [key, rows.filter((row) => row.confidence === key).length]));
  console.log(JSON.stringify({ output_directory: outputDir, total_followers: rows.length, coach_candidates: coaches.length, counts }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
