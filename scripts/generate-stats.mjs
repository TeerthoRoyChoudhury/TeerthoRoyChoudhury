// Generates an isometric "contribution skyline" + activity radar + language donut
// as a single SVG, using real data pulled from the GitHub GraphQL API.
//
// Requires env vars:
//   GH_USERNAME  - GitHub username to report on
//   GH_TOKEN     - PAT with scopes: read:user, repo (or public_repo)

import fs from "fs";

const USERNAME = process.env.GH_USERNAME;
const TOKEN = process.env.GH_TOKEN;

if (!USERNAME || !TOKEN) {
  console.error("Missing GH_USERNAME or GH_TOKEN env vars.");
  process.exit(1);
}

const QUERY = `
query ($login: String!) {
  user(login: $login) {
    contributionsCollection {
      totalCommitContributions
      totalIssueContributions
      totalPullRequestContributions
      totalPullRequestReviewContributions
      contributionCalendar {
        weeks {
          contributionDays {
            contributionCount
            date
          }
        }
      }
    }
    repositoriesContributedTo(first: 1, contributionTypes: [COMMIT]) {
      totalCount
    }
    ownedRepos: repositories(ownerAffiliation: OWNER, isFork: false) {
      totalCount
    }
    repositories(first: 100, ownerAffiliation: OWNER, isFork: false, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
          edges {
            size
            node { name color }
          }
        }
      }
    }
  }
}`;

async function fetchStats() {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: QUERY, variables: { login: USERNAME } }),
  });
  const json = await res.json();
  if (json.errors) {
    console.error(JSON.stringify(json.errors, null, 2));
    process.exit(1);
  }
  return json.data.user;
}

function aggregateLanguages(repos) {
  const totals = {};
  for (const repo of repos) {
    for (const edge of repo.languages.edges) {
      const name = edge.node.name;
      totals[name] = (totals[name] || 0) + edge.size;
      totals[name + "__color"] = edge.node.color || "#888";
    }
  }
  const entries = Object.keys(totals)
    .filter((k) => !k.endsWith("__color"))
    .map((name) => ({
      name,
      size: totals[name],
      color: totals[name + "__color"],
    }))
    .sort((a, b) => b.size - a.size);

  const grandTotal = entries.reduce((sum, e) => sum + e.size, 0) || 1;
  const top = entries.slice(0, 5);
  const rest = entries.slice(5);
  const otherSize = rest.reduce((sum, e) => sum + e.size, 0);

  const slices = top.map((e) => ({
    name: e.name,
    color: e.color,
    pct: e.size / grandTotal,
  }));
  if (otherSize > 0) {
    slices.push({ name: "other", color: "#555b66", pct: otherSize / grandTotal });
  }
  return slices;
}

// ---------- Isometric contribution skyline ----------
function buildSkyline(weeks) {
  const cellW = 18;
  const cellH = 9;
  const originX = 480;
  const originY = 70;
  const maxLevel = 4; // 0..4 height steps
  const cubeUnit = 7; // px per height level

  const counts = weeks.flatMap((w) => w.contributionDays.map((d) => d.contributionCount));
  const max = Math.max(1, ...counts);

  function levelFor(count) {
    if (count === 0) return 0;
    const ratio = count / max;
    return Math.max(1, Math.ceil(ratio * maxLevel));
  }
  function colorFor(level) {
    const palette = ["#0d1a3d", "#1c3fa0", "#2f5fd6", "#4f8dff", "#8fc6ff"];
    return palette[level] || palette[palette.length - 1];
  }

  let svg = "";
  weeks.forEach((week, col) => {
    week.contributionDays.forEach((day, row) => {
      const level = levelFor(day.contributionCount);
      const h = level * cubeUnit;
      const x = originX + (col - row) * (cellW / 2);
      const yBase = originY + (col + row) * (cellH / 2);
      const yTop = yBase - h;
      const topColor = colorFor(level);
      const leftColor = shade(topColor, -18);
      const rightColor = shade(topColor, -32);

      // top face
      svg += `<polygon points="${x},${yTop - cellH / 2} ${x + cellW / 2},${yTop} ${x},${yTop + cellH / 2} ${x - cellW / 2},${yTop}" fill="${topColor}" stroke="#000814" stroke-width="0.4"/>`;
      // left face
      svg += `<polygon points="${x - cellW / 2},${yTop} ${x},${yTop + cellH / 2} ${x},${yBase + cellH / 2} ${x - cellW / 2},${yBase}" fill="${leftColor}" stroke="#000814" stroke-width="0.4"/>`;
      // right face
      svg += `<polygon points="${x + cellW / 2},${yTop} ${x},${yTop + cellH / 2} ${x},${yBase + cellH / 2} ${x + cellW / 2},${yBase}" fill="${rightColor}" stroke="#000814" stroke-width="0.4"/>`;
    });
  });
  return svg;
}

function shade(hex, amt) {
  const num = parseInt(hex.slice(1), 16);
  let r = (num >> 16) + amt;
  let g = ((num >> 8) & 0x00ff) + amt;
  let b = (num & 0x0000ff) + amt;
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// ---------- Radar chart ----------
function buildRadar(stats) {
  const cx = 1290;
  const cy = 330;
  const R = 130;
  const axes = [
    { label: "Commit", value: stats.commits },
    { label: "Issue", value: stats.issues },
    { label: "PullReq", value: stats.prs },
    { label: "Review", value: stats.reviews },
    { label: "Repo", value: stats.repos },
  ];
  const n = axes.length;
  const angleFor = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;

  // log scale: 1 -> 0, 10000 -> R
  function radiusFor(value) {
    const v = Math.max(1, value);
    const logMax = Math.log10(10000);
    return (Math.log10(v) / logMax) * R;
  }

  let svg = "";

  // grid rings at 1, 10, 100, 1K, 10K
  const rings = [1, 10, 100, 1000, 10000];
  rings.forEach((ringVal) => {
    const r = radiusFor(ringVal);
    let pts = [];
    for (let i = 0; i < n; i++) {
      const a = angleFor(i);
      pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`);
    }
    svg += `<polygon points="${pts.join(" ")}" fill="none" stroke="#3a3f55" stroke-dasharray="3,3" stroke-width="1"/>`;
  });

  // axis lines + labels
  axes.forEach((axis, i) => {
    const a = angleFor(i);
    const x2 = cx + R * Math.cos(a);
    const y2 = cy + R * Math.sin(a);
    svg += `<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" stroke="#3a3f55" stroke-dasharray="3,3" stroke-width="1"/>`;
    const lx = cx + (R + 30) * Math.cos(a);
    const ly = cy + (R + 30) * Math.sin(a);
    svg += `<text x="${lx}" y="${ly}" fill="#e8e8e8" font-size="15" font-family="Verdana, sans-serif" text-anchor="middle" dominant-baseline="middle">${axis.label}</text>`;
  });

  // data polygon
  let dataPts = axes.map((axis, i) => {
    const a = angleFor(i);
    const r = radiusFor(axis.value);
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  });
  svg += `<polygon points="${dataPts.join(" ")}" fill="#d9a441" fill-opacity="0.35" stroke="#e8b84b" stroke-width="2.5"/>`;

  return svg;
}

// ---------- Language donut ----------
function buildDonut(slices) {
  const cx = 150;
  const cy = 830;
  const rOuter = 100;
  const rInner = 55;
  let startAngle = -Math.PI / 2;
  let svg = "";

  slices.forEach((slice) => {
    const angle = slice.pct * 2 * Math.PI;
    const endAngle = startAngle + angle;
    const x1o = cx + rOuter * Math.cos(startAngle);
    const y1o = cy + rOuter * Math.sin(startAngle);
    const x2o = cx + rOuter * Math.cos(endAngle);
    const y2o = cy + rOuter * Math.sin(endAngle);
    const x1i = cx + rInner * Math.cos(endAngle);
    const y1i = cy + rInner * Math.sin(endAngle);
    const x2i = cx + rInner * Math.cos(startAngle);
    const y2i = cy + rInner * Math.sin(startAngle);
    const largeArc = angle > Math.PI ? 1 : 0;

    svg += `<path d="M ${x1o} ${y1o} A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2o} ${y2o} L ${x1i} ${y1i} A ${rInner} ${rInner} 0 ${largeArc} 0 ${x2i} ${y2i} Z" fill="${slice.color}" stroke="#0a0e1a" stroke-width="1.5"/>`;
    startAngle = endAngle;
  });

  // legend
  let legendY = cy - 90;
  slices.forEach((slice) => {
    svg += `<rect x="${cx + 130}" y="${legendY}" width="16" height="16" fill="${slice.color}"/>`;
    svg += `<text x="${cx + 155}" y="${legendY + 13}" fill="#e8e8e8" font-size="15" font-family="Verdana, sans-serif">${slice.name}</text>`;
    legendY += 26;
  });

  return svg;
}

function dateRangeLabel(weeks) {
  const first = weeks[0].contributionDays[0].date;
  const lastWeek = weeks[weeks.length - 1].contributionDays;
  const last = lastWeek[lastWeek.length - 1].date;
  return `${first} / ${last}`;
}

async function main() {
  const user = await fetchStats();
  const cc = user.contributionsCollection;

  const stats = {
    commits: cc.totalCommitContributions,
    issues: cc.totalIssueContributions,
    prs: cc.totalPullRequestContributions,
    reviews: cc.totalPullRequestReviewContributions,
    repos: user.ownedRepos.totalCount,
  };

  const langSlices = aggregateLanguages(user.repositories.nodes);
  const skylineSvg = buildSkyline(cc.contributionCalendar.weeks);
  const radarSvg = buildRadar(stats);
  const donutSvg = buildDonut(langSlices);
  const rangeLabel = dateRangeLabel(cc.contributionCalendar.weeks);

  const svg = `
<svg viewBox="0 0 1500 1000" xmlns="http://www.w3.org/2000/svg" font-family="Verdana, sans-serif">
  <rect x="0" y="0" width="1500" height="1000" fill="#05070f" stroke="#1a1f2e" stroke-width="2"/>
  <text x="1470" y="40" fill="#c9ccd6" font-size="16" text-anchor="end">${rangeLabel}</text>
  ${skylineSvg}
  ${radarSvg}
  ${donutSvg}
</svg>`.trim();

  fs.mkdirSync("dist", { recursive: true });
  fs.writeFileSync("dist/stats.svg", svg);
  console.log("Wrote dist/stats.svg");
}

main();
