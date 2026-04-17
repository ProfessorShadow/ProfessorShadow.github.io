import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(".");
const indexPath = resolve(root, "index.html");

const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

check(existsSync(indexPath), "index.html should exist at the portfolio root");
check(existsSync(resolve(root, ".nojekyll")), ".nojekyll should exist for GitHub Pages static asset publishing");

let html = "";
if (existsSync(indexPath)) {
  html = readFileSync(indexPath, "utf8");
}

const requiredText = [
  "Ghazi Abbas",
  "Data Analyst",
  "Melbourne",
  "Veolia Australia",
  "A8 Consulting",
  "SnP Infotech",
  "Monash University",
  "Superstore Dashboard",
  "Superstore Performance Dashboard",
  "Sales &amp; Onboarding Operational Dashboard",
  "Hospital Emergency Room Dashboard",
  "Azure PostgreSQL Pipeline",
  "Azure Data Factory Incremental Sync",
  "Parameter Actions",
  "Regional Profitability",
  "Case Aging",
  "Patient Flow",
  "Azure Data Factory",
  "Azure Database for PostgreSQL",
  "Blob Storage landing zone",
  "Incremental loads",
  "https://public.tableau.com/app/profile/ghazi.abbas/viz/SuperstoreDashboard__17758255831890/Dashboard1",
  "https://public.tableau.com/app/profile/ghazi.abbas/viz/SuperstorePerformanceDashboard_17705880947580/Dashboard1",
  "https://public.tableau.com/app/profile/ghazi.abbas/viz/SalesOnboardingOperationalDashboard/Dashboard1",
  "Open Tableau dashboard",
  "Dashboard delivery",
  "Automation impact",
  "Reporting foundation",
  "https://formsubmit.co/ghaziabbas832@gmail.com",
  "Thanks - your message is ready to send.",
  "Contact form",
  "Use the secure form on this page",
];

for (const text of requiredText) {
  check(html.includes(text), `index.html should include "${text}"`);
}

const forbiddenText = [
  "PRISM ANALYTICS",
  "Nexus Digital",
  "Vanguard Creative",
  "Stanford University",
  "GCP Professional Architect",
  "DeepLearning.AI",
  "Fortune 500",
  "hello@prism-analytica.io",
  "San Francisco, CA",
  "98.4%",
  "150+",
];

for (const text of forbiddenText) {
  check(!html.includes(text), `index.html should not include placeholder claim "${text}"`);
}

const requiredSelectors = [
  'id="work"',
  'id="insights"',
  'id="laboratory"',
  'id="about"',
  'id="contact"',
  'data-tilt',
  'data-parallax',
  'data-trace',
  'data-scroll-scene',
  'data-progress',
  'data-reveal-x',
  'data-counter',
  'data-depth-card',
  "azure-orbit",
  "pipeline-visual",
  "activeScenes",
  "will-change: transform",
  "prefers-reduced-motion",
  'name="_subject"',
  'name="_captcha"',
  'name="_template"',
];

for (const text of requiredSelectors) {
  check(html.includes(text), `index.html should include "${text}"`);
}

const imageCount = (html.match(/<img\b/g) || []).length;
check(imageCount >= 5, "index.html should include at least five images");

const projectSceneCount = (html.match(/class="project-dive/g) || []).length;
check(projectSceneCount >= 6, "index.html should include at least six immersive project scenes");

const projectLinkCount = (html.match(/datascienceportfol\.io\/ghaziabbas832\/projects\//g) || []).length;
check(projectLinkCount >= 1, "index.html should retain at least one source portfolio project page");

const tableauLinkCount = (html.match(/public\.tableau\.com\/app\/profile\/ghazi\.abbas\/viz\//g) || []).length;
check(tableauLinkCount >= 3, "index.html should link directly to the three Tableau dashboards");

const privateContactPatterns = [
  'href="mailto:ghaziabbas832@gmail.com"',
  'href="tel:0469303666"',
  "<strong>ghaziabbas832@gmail.com</strong>",
  "<strong>0469303666</strong>",
];

for (const text of privateContactPatterns) {
  check(!html.includes(text), `index.html should not expose private contact detail "${text}"`);
}

const requiredAssetPaths = [
  "assets/projects/superstore-dashboard-tableau.png",
  "assets/projects/superstore-performance-tableau.png",
  "assets/projects/sales-onboarding-tableau.png",
  "assets/projects/hospital-dashboard.png",
];

for (const assetPath of requiredAssetPaths) {
  check(existsSync(resolve(root, assetPath)), `${assetPath} should exist`);
  check(html.includes(assetPath), `index.html should reference ${assetPath}`);
}

const stitchAssetRoot = "Revision-1/stitch_immersive_data_analytics_portfolio";
for (const assetPath of requiredAssetPaths) {
  const mirroredAssetPath = `${stitchAssetRoot}/${assetPath}`;
  check(existsSync(resolve(root, mirroredAssetPath)), `${mirroredAssetPath} should exist for direct Stitch previews`);
}

if (failures.length) {
  console.error("Static site smoke test failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Static site smoke test passed.");
