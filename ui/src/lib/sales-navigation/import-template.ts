/** Public path served from ui/public/templates/ */
export const SALES_NAV_IMPORT_TEMPLATE_PATH = "/templates/sales-navigation-import-template.xlsx";

export const SALES_NAV_IMPORT_TEMPLATE_FILENAME = "sales-navigation-import-template.xlsx";

export type SalesNavImportColumn = {
  header: string;
  required: boolean;
  description: string;
  examples?: string;
};

export const SALES_NAV_IMPORT_COLUMNS: SalesNavImportColumn[] = [
  {
    header: "Account",
    required: false,
    description: "Target company name. Groups contacts on the strategic competitive layer.",
    examples: "Acme Corp",
  },
  {
    header: "Contact Name",
    required: true,
    description: "One row per person. Aliases: Name, Contact, Full Name, LinkedIn Name.",
    examples: "Jordan Lee",
  },
  {
    header: "Title",
    required: false,
    description: "Job title on graph nodes.",
    examples: "VP Engineering",
  },
  {
    header: "Buying Role / Level",
    required: false,
    description:
      "Buying-committee tier. Keywords: warm intro, champion, influencer, technical, decision, procurement.",
    examples: "Internal Champion",
  },
  {
    header: "Relationship Strength",
    required: false,
    description: "0–100 or strong / medium / weak. Sets edge weight on the relationship graph.",
    examples: "85 or strong",
  },
  {
    header: "Status",
    required: false,
    description:
      "Engagement state: unverified, verified, contacted, meeting_scheduled, warm_intro_complete, closed_won, closed_lost.",
    examples: "verified",
  },
  {
    header: "Reports To",
    required: false,
    description: "Manager contact name (must match another row) to draw hierarchy lines.",
    examples: "Sam Patel",
  },
  {
    header: "LinkedIn URL",
    required: false,
    description: "Profile link for your team’s reference.",
    examples: "https://linkedin.com/in/…",
  },
  {
    header: "Verified",
    required: false,
    description: "yes / true marks a verified connection.",
    examples: "yes",
  },
  {
    header: "Warm Intro Path",
    required: false,
    description: "How you got the introduction.",
    examples: "Via Sam Patel",
  },
  {
    header: "Owner",
    required: false,
    description: "Assigned rep or pod.",
    examples: "Alex Morgan",
  },
  {
    header: "Notes",
    required: false,
    description: "Outreach notes shown in intelligence panel.",
    examples: "Pilot scheduled Q2",
  },
];
