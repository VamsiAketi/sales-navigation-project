/**
 * Generates ui/public/templates/sales-navigation-import-template.xlsx
 * Run: node scripts/generate-sales-nav-template.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const require = createRequire(path.join(root, "ui", "package.json"));
const XLSX = require("xlsx");
const outDir = path.join(root, "ui", "public", "templates");
const outFile = path.join(outDir, "sales-navigation-import-template.xlsx");

const HEADERS = [
  "Account",
  "Contact Name",
  "Title",
  "Buying Role / Level",
  "Relationship Strength",
  "Status",
  "Reports To",
  "LinkedIn URL",
  "Verified",
  "Warm Intro Path",
  "Owner",
  "Notes",
];

const SAMPLE_ROWS = [
  [
    "Acme Corp",
    "Sam Patel",
    "Director of IT",
    "Warm Introduction",
    72,
    "verified",
    "",
    "https://www.linkedin.com/in/example-sam",
    "yes",
    "College alumni network",
    "Alex Morgan",
    "Introduced us to engineering",
  ],
  [
    "Acme Corp",
    "Jordan Lee",
    "VP Engineering",
    "Internal Champion",
    88,
    "meeting_scheduled",
    "Sam Patel",
    "https://www.linkedin.com/in/example-jordan",
    "yes",
    "Via Sam Patel",
    "Alex Morgan",
    "Strong technical ally; wants pilot in Q2",
  ],
  [
    "Acme Corp",
    "Riley Chen",
    "Staff Architect",
    "Technical Evaluator",
    65,
    "contacted",
    "Jordan Lee",
    "https://www.linkedin.com/in/example-riley",
    "no",
    "",
    "Alex Morgan",
    "Owns security review checklist",
  ],
  [
    "Acme Corp",
    "Morgan Blake",
    "CFO",
    "Decision Maker",
    45,
    "unverified",
    "",
    "https://www.linkedin.com/in/example-morgan",
    "no",
    "",
    "Priya Shah",
    "Economic buyer — needs ROI one-pager",
  ],
  [
    "Acme Corp",
    "Taylor Brooks",
    "Head of Procurement",
    "Procurement",
    38,
    "unverified",
    "Morgan Blake",
    "",
    "no",
    "",
    "Priya Shah",
    "Budget cycle closes in 6 weeks",
  ],
  [
    "Globex Industries",
    "Casey Nguyen",
    "Product Lead",
    "Influencer",
    58,
    "contacted",
    "",
    "https://www.linkedin.com/in/example-casey",
    "yes",
    "Partner referral",
    "Alex Morgan",
    "Second strategic account example",
  ],
];

const REFERENCE_ROWS = [
  ["Column", "Required", "Accepted values / notes"],
  ["Account", "Recommended", "Company or target account name. Groups contacts on the battle map."],
  ["Contact Name", "Yes", "Full name of the person (one row per contact)."],
  ["Title", "Optional", "Job title shown on graph nodes."],
  [
    "Buying Role / Level",
    "Recommended",
    "warm intro, internal champion, influencer, technical evaluator, decision maker, procurement (keywords match).",
  ],
  [
    "Relationship Strength",
    "Optional",
    "0–100 number, or strong / medium / weak. Drives edge strength on the graph.",
  ],
  [
    "Status",
    "Optional",
    "unverified, verified, contacted, meeting_scheduled, warm_intro_complete, closed_won, closed_lost",
  ],
  [
    "Reports To",
    "Optional",
    "Exact name of another contact in this sheet — creates hierarchy edges.",
  ],
  ["LinkedIn URL", "Optional", "Profile URL for reference."],
  ["Verified", "Optional", "yes / true or leave blank."],
  ["Warm Intro Path", "Optional", "How you reached this person (shown in intelligence panel)."],
  ["Owner", "Optional", "Rep or team owning this relationship."],
  ["Notes", "Optional", "Free-text outreach notes."],
];

const contactsSheet = XLSX.utils.aoa_to_sheet([
  ["Sales Navigation import template — fill Contacts sheet and upload via Sales Navigation → Upload Excel"],
  [],
  HEADERS,
  ...SAMPLE_ROWS,
]);

contactsSheet["!cols"] = [
  { wch: 18 },
  { wch: 16 },
  { wch: 22 },
  { wch: 22 },
  { wch: 20 },
  { wch: 18 },
  { wch: 14 },
  { wch: 36 },
  { wch: 10 },
  { wch: 22 },
  { wch: 14 },
  { wch: 32 },
];

const referenceSheet = XLSX.utils.aoa_to_sheet(REFERENCE_ROWS);
referenceSheet["!cols"] = [{ wch: 22 }, { wch: 12 }, { wch: 72 }];

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, contactsSheet, "Contacts");
XLSX.utils.book_append_sheet(workbook, referenceSheet, "Column reference");

fs.mkdirSync(outDir, { recursive: true });
XLSX.writeFile(workbook, outFile);
console.log(`Wrote ${outFile}`);
