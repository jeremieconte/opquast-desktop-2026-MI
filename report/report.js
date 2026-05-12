const api = typeof browser !== "undefined" ? browser : chrome;

const STATUS_LABELS = {
  fail: "A corriger",
  manual: "A verifier",
  pass: "OK",
  na: "Non applicable"
};

function text(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function appendText(parent, tag, value, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  parent.append(node);
  return node;
}

function metric(label, value) {
  const node = document.createElement("div");
  node.className = "metric";
  appendText(node, "strong", value);
  appendText(node, "span", label);
  return node;
}

function renderSummary(report) {
  const summary = document.getElementById("summary");
  const counts = report.counts || {};
  summary.replaceChildren(
    metric("Corrections", counts.fail || 0),
    metric("A verifier", counts.manual || 0),
    metric("Non applicable", counts.na || 0),
    metric("Conformes", counts.pass || 0),
    metric("Issues axe-core", counts.axe || 0),
    metric("Tests axe OK", counts.axePasses || 0)
  );
}

function panel(title, rows) {
  const node = document.createElement("article");
  node.className = "panel";
  appendText(node, "h2", title);
  const list = document.createElement("ul");
  for (const row of rows) {
    appendText(list, "li", row);
  }
  node.append(list);
  return node;
}

function renderInspection(report) {
  const facts = report.facts || {};
  const axe = facts.axe || {};
  const inspection = document.getElementById("inspection");
  inspection.replaceChildren(
    panel("Page inspectee", [
      `Titre: ${text(facts.pageTitle) || "-"}`,
      `Langue HTML: ${text(facts.htmlLang) || "-"}`,
      `Doctype: ${facts.hasDoctype ? "present" : "absent"}`,
      `Moteur axe: ${axe.available ? axe.testEngine?.version || "charge" : "indisponible"}`
    ]),
    panel("Structure DOM", [
      `Images: ${facts.imageCount || 0}`,
      `H1: ${facts.h1Count || 0}`,
      `Titres: ${facts.headingCount || 0}`,
      `IDs dupliques: ${facts.duplicateIdCount || 0}`,
      `Tableaux sans entete detectable: ${facts.tablesWithoutHeadersCount || 0}`
    ]),
    panel("Points d'attention", [
      `Images sans alt: ${facts.imgMissingAltCount || 0}`,
      `Champs sans libelle detectable: ${facts.unlabeledControlCount || 0}`,
      `Boutons vides: ${facts.emptyButtonCount || 0}`,
      `Liens vides: ${facts.emptyLinkCount || 0}`,
      `Meta refresh: ${facts.metaRefreshCount || 0}`
    ])
  );
}

function renderIssue(result) {
  const node = document.createElement("article");
  node.className = `issue ${result.status} ${result.kind || ""}`;

  const header = document.createElement("header");
  appendText(header, "h3", `${result.uid} - ${result.description || result.name}`);
  const badge = appendText(header, "span", STATUS_LABELS[result.status] || result.status, `badge ${result.status}`);
  badge.title = result.impact ? `Impact ${result.impact}` : "";
  node.append(header);

  appendText(node, "p", [result.source, result.thema, result.checklistName].filter(Boolean).join(" / "), "source");
  appendText(node, "p", result.message || "", "message");

  if (result.evidence?.length) {
    const evidence = document.createElement("ul");
    evidence.className = "evidence";
    for (const line of result.evidence.slice(0, 8)) {
      appendText(evidence, "li", line);
    }
    node.append(evidence);
  }

  if (result.tests?.length) {
    const details = document.createElement("details");
    details.open = result.status === "fail";
    const summary = appendText(details, "summary", `${result.tests.length} test(s) RGAA rattache(s)`);
    summary.className = "source";
    const list = document.createElement("ol");
    for (const test of result.tests) {
      const item = document.createElement("li");
      appendText(item, "strong", `${test.id} - ${test.description}`);
      if (test.conditions?.length) {
        const conditions = document.createElement("ul");
        for (const condition of test.conditions) appendText(conditions, "li", condition);
        item.append(conditions);
      }
      if (test.methodology) appendText(item, "p", test.methodology, "message");
      list.append(item);
    }
    details.append(list);
    node.append(details);
  }

  if (result.helpUrl) {
    const link = document.createElement("a");
    link.className = "solution";
    link.href = result.helpUrl;
    link.textContent = "Documentation de correction";
    node.append(link);
  } else if (result.solution) {
    appendText(node, "p", result.solution, "solution");
  }

  if (result.sourceUrl) {
    const source = document.createElement("a");
    source.className = "solution";
    source.href = result.sourceUrl;
    source.textContent = "Source officielle du critere";
    node.append(source);
  }

  return node;
}

function renderSection(id, title, results, limit) {
  const section = document.getElementById(id);
  section.replaceChildren();
  appendText(section, "h2", title);
  const visible = typeof limit === "number" ? results.slice(0, limit) : results;
  if (!visible.length) {
    appendText(section, "p", "Aucun element dans cette section.", "empty");
    return;
  }
  for (const result of visible) {
    section.append(renderIssue(result));
  }
}

async function init() {
  const { latestReport } = await api.storage.local.get("latestReport");
  if (!latestReport) {
    document.body.replaceChildren();
    appendText(document.body, "p", "Aucun rapport disponible. Lancez une analyse depuis le popup Opquast.", "empty");
    return;
  }

  document.getElementById("report-url").textContent = latestReport.url || "";
  renderSummary(latestReport);
  renderInspection(latestReport);

  const results = latestReport.results || [];
  renderSection("priority", "Corrections automatiques detectees", results.filter((item) => item.status === "fail"));
  renderSection("manual", "Verifications humaines restantes", results.filter((item) => item.status === "manual"));
  renderSection("passed", "Controles conformes et non applicables", results.filter((item) => item.status === "pass" || item.status === "na"), 120);
}

document.getElementById("print").addEventListener("click", () => window.print());
init();
