const api = typeof browser !== "undefined" ? browser : chrome;

const state = {
  index: [],
  checklist: null,
  results: [],
  facts: null,
  report: null,
  filter: "all",
  activeChecklistFile: null
};

const DEFAULT_CHECKLIST = "fr/716-rgaa-4.1.2.json";

const els = {
  language: document.getElementById("language"),
  checklist: document.getElementById("checklist"),
  run: document.getElementById("run"),
  report: document.getElementById("report"),
  export: document.getElementById("export"),
  message: document.getElementById("message"),
  currentUrl: document.getElementById("current-url"),
  summary: document.getElementById("summary"),
  filters: document.getElementById("filters"),
  results: document.getElementById("results"),
  pass: document.getElementById("count-pass"),
  fail: document.getElementById("count-fail"),
  manual: document.getElementById("count-manual"),
  na: document.getElementById("count-na"),
  axe: document.getElementById("count-axe")
};

const STATUS_LABELS = {
  pass: "OK",
  fail: "A corriger",
  manual: "A verifier",
  na: "N/A"
};

function setMessage(text) {
  els.message.textContent = text;
}

function text(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeSearch(value) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function hasAny(haystack, needles) {
  return needles.some((needle) => haystack.includes(needle));
}

function normalizeRules(raw) {
  return Object.entries(raw).map(([uid, payload]) => ({
    uid,
    checklistId: payload.checklist?.id || 0,
    checklistName: payload.checklist?.name || "",
    name: payload.name || uid,
    description: payload.description || "",
    goal: payload.goal || "",
    solution: payload.solution || "",
    thema: payload.thema || "",
    criterion: payload.criterion || "",
    tests: Array.isArray(payload.tests) ? payload.tests : [],
    references: payload.references || [],
    sourceUrl: payload.source_url || "",
    sourceLabel: payload.source || ""
  }));
}

async function loadIndex() {
  const response = await fetch(api.runtime.getURL("checklists/index.json"));
  state.index = await response.json();
}

async function loadChecklist(file) {
  const response = await fetch(api.runtime.getURL(`checklists/${file}`));
  const raw = await response.json();
  state.checklist = normalizeRules(raw);
  state.activeChecklistFile = file;
}

function populateLanguages() {
  const languages = Array.from(new Set(state.index.map((entry) => entry.language))).sort();
  els.language.replaceChildren(...languages.map((language) => {
    const option = document.createElement("option");
    option.value = language;
    option.textContent = language.toUpperCase();
    return option;
  }));
}

function populateChecklists() {
  const selectedLanguage = els.language.value;
  const options = state.index
    .filter((entry) => entry.language === selectedLanguage)
    .sort((a, b) => `${a.id}-${a.name}`.localeCompare(`${b.id}-${b.name}`))
    .map((entry) => {
      const option = document.createElement("option");
      option.value = entry.file;
      const tests = entry.tests ? `, ${entry.tests} tests` : "";
      option.textContent = `${entry.id} - ${entry.name} (${entry.rules} regles${tests})`;
      return option;
    });
  els.checklist.replaceChildren(...options);
}

async function getActiveTab() {
  const tabs = await api.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function collectFacts(tab) {
  try {
    return await api.tabs.sendMessage(tab.id, { type: "opquast:collect-page-facts" });
  } catch (firstError) {
    await api.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["vendor/axe.min.js", "content/analyzer.js"]
    });
    return api.tabs.sendMessage(tab.id, { type: "opquast:collect-page-facts" });
  }
}

function passIf(condition, ok, ko, evidence = []) {
  return {
    status: condition ? "pass" : "fail",
    message: condition ? ok : ko,
    automated: true,
    evidence: condition ? [] : evidence
  };
}

function failIfCount(count, ok, ko, evidence = []) {
  return {
    status: count > 0 ? "fail" : "pass",
    message: count > 0 ? `${ko} (${count})` : ok,
    automated: true,
    evidence: count > 0 ? evidence : []
  };
}

function deprecatedAttributeResult(facts, attribute) {
  const count = facts.deprecatedAttributes?.[attribute] || 0;
  return failIfCount(count, `Aucun attribut ${attribute}.`, `Attribut ${attribute} detecte`);
}

function manual(message = "Cette regle demande une verification humaine: le navigateur ne peut pas valider le contexte, la pertinence ou l'intention editoriale.") {
  return { status: "manual", message, automated: false, evidence: [] };
}

function notApplicable(message) {
  return { status: "na", message, automated: true, evidence: [] };
}

function axeRuleResult(facts, ids, ok, ko) {
  const idSet = new Set(ids);
  const axe = facts.axe || {};
  const violation = (axe.violations || []).find((item) => idSet.has(item.id));
  if (violation) {
    return failIfCount(
      violation.nodeCount || 1,
      ok,
      `${ko}: ${violation.help || violation.id}`,
      (violation.nodes || []).map((node) => [node.target, node.failureSummary || node.html].filter(Boolean).join(" - "))
    );
  }
  const incomplete = (axe.incomplete || []).find((item) => idSet.has(item.id));
  if (incomplete) {
    return manual(`axe-core demande une verification humaine pour ${incomplete.help || incomplete.id}.`);
  }
  const pass = (axe.passes || []).find((item) => idSet.has(item.id));
  if (pass) {
    return passIf(true, ok, ko);
  }
  return null;
}

function examples(facts, key) {
  return facts.examples?.[key] || [];
}

function detectDeprecatedAttribute(description, facts) {
  const attributes = [
    "align",
    "alink",
    "background",
    "bgcolor",
    "border",
    "cellpadding",
    "cellspacing",
    "clear",
    "color",
    "compact",
    "face",
    "frameborder",
    "hspace",
    "link",
    "marginheight",
    "marginwidth",
    "text",
    "valign",
    "vlink",
    "vspace"
  ];
  for (const attribute of attributes) {
    if (description.includes(`attribut ${attribute}`) || description.includes(`${attribute} attribute`)) {
      return deprecatedAttributeResult(facts, attribute);
    }
  }
  return null;
}

function detectNotApplicable(rule, facts, description) {
  const theme = normalizeSearch(rule.thema);

  if (theme === "cadres" && facts.iframeCount === 0) {
    return notApplicable("Aucun cadre iframe/frame detecte dans le DOM rendu.");
  }

  if (theme === "tableaux" && facts.tableCount === 0) {
    return notApplicable("Aucun tableau detecte dans le DOM rendu.");
  }

  if (theme === "formulaires" && facts.formCount === 0 && facts.formControlCount === 0) {
    return notApplicable("Aucun formulaire ou champ de formulaire detecte dans le DOM rendu.");
  }

  if (theme === "multimedia" && facts.mediaCount === 0) {
    return notApplicable("Aucun media audio, video, object ou embed detecte.");
  }

  if (theme === "liens" && facts.linkCount === 0) {
    return notApplicable("Aucun lien detecte dans le DOM rendu.");
  }

  if (theme === "liens" && description.includes("lien image") && facts.imageLinkCount === 0) {
    return notApplicable("Aucun lien image detecte.");
  }

  if (theme === "liens" && description.includes("lien composite") && facts.compositeLinkCount === 0) {
    return notApplicable("Aucun lien composite detecte.");
  }

  if (theme === "liens" && description.includes("lien vectoriel") && facts.vectorLinkCount === 0) {
    return notApplicable("Aucun lien vectoriel detecte.");
  }

  if (theme === "liens" && description.includes("zone cliquable") && facts.areaCount === 0) {
    return notApplicable("Aucune zone cliquable area detectee.");
  }

  if (theme === "liens" && description.includes("titre de lien") && facts.titleLinkCount === 0) {
    return notApplicable("Aucun attribut title de lien detecte.");
  }

  if (theme === "scripts" && facts.scriptedElementCount === 0) {
    return notApplicable("Aucun script ni gestionnaire d'evenement inline detecte.");
  }

  if (description.includes("balise area") || description.includes("image reactive")) {
    if (facts.areaCount === 0 && facts.imageMapCount === 0) {
      return notApplicable("Aucune image reactive ou zone area detectee.");
    }
  }

  if (description.includes("type=\"image\"") || description.includes("type='image'") || description.includes("bouton associe a une image")) {
    if (facts.imageInputCount === 0) {
      return notApplicable("Aucun bouton de formulaire input type=image detecte.");
    }
  }

  if (description.includes("image objet") || description.includes("balise object")) {
    if (facts.objectImageCount === 0 && !theme.includes("consultation")) {
      return notApplicable("Aucune image object detectee.");
    }
  }

  if (description.includes("image embarquee") || description.includes("balise embed")) {
    if (facts.embedImageCount === 0 && !theme.includes("consultation")) {
      return notApplicable("Aucune image embed detectee.");
    }
  }

  if (description.includes("image vectorielle") || description.includes("balise svg")) {
    if (facts.svgCount === 0) {
      return notApplicable("Aucune image vectorielle SVG detectee.");
    }
  }

  if (description.includes("image bitmap") || description.includes("balise canvas")) {
    if (facts.canvasCount === 0) {
      return notApplicable("Aucun canvas detecte.");
    }
  }

  if (theme === "images") {
    if (facts.imageLikeCount === 0) {
      return notApplicable("Aucune image, zone area, object image, embed image, SVG, canvas ou input image detecte.");
    }
    if (hasAny(description, ["captcha", "image-test"]) && facts.captchaCandidateCount === 0) {
      return notApplicable("Aucun indice de CAPTCHA ou d'image-test detecte.");
    }
    if (description.includes("legendee") && facts.figureWithMediaCount === 0) {
      return notApplicable("Aucune image associee a une legende figure/figcaption detectee.");
    }
  }

  if (description.includes("balise video") || description.includes("video")) {
    if (facts.videoCount === 0) {
      return notApplicable("Aucune video detectee.");
    }
  }

  if (description.includes("balise audio") || description.includes("audio")) {
    if (facts.audioCount === 0) {
      return notApplicable("Aucun audio detecte.");
    }
  }

  if (description.includes("chaque liste") && facts.listCount === 0) {
    return notApplicable("Aucune liste ul/ol/dl detectee.");
  }

  if ((description.includes("chaque citation") || description.includes("balise blockquote") || description.includes("balise q")) && facts.quoteCount === 0) {
    return notApplicable("Aucune citation blockquote/q detectee.");
  }

  if (description.includes("chaque titre") && facts.headingCount === 0) {
    return notApplicable("Aucun titre h1-h6 detecte.");
  }

  if (description.includes("chaque fichier en telechargement") && facts.downloadLinkCount === 0) {
    return notApplicable("Aucun lien de telechargement detectable.");
  }

  if (description.includes("ouverture d'une nouvelle fenetre") && facts.targetBlankLinkCount === 0) {
    return notApplicable("Aucune ouverture de nouvelle fenetre detectee via target=_blank.");
  }

  if (hasAny(description, ["contenu en mouvement", "contenu clignotant", "effet de flash", "changement brusque de luminosite"]) && facts.motionCandidateCount === 0) {
    return notApplicable("Aucun contenu anime, clignotant ou candidat a effet de flash detecte.");
  }

  if (description.includes("procede de redirection effectue via une balise meta") && facts.metaRefreshCount === 0) {
    return notApplicable("Aucune redirection meta refresh detectee.");
  }

  return null;
}

function evaluateKnownRule(rule, facts) {
  const testsText = (rule.tests || []).map((test) => {
    return `${test.description || ""} ${(test.conditions || []).join(" ")} ${test.methodology || ""}`;
  }).join(" ");
  const description = normalizeSearch(`${rule.description} ${rule.solution} ${testsText}`);

  const byUid = {
    "19257": () => passIf(facts.hasTitleElement, "Element title present.", "Element title manquant dans head."),
    "19310": () => passIf(Boolean(text(facts.titleText)), "Titre non vide.", "Element title vide."),
    "19229": () => passIf(facts.h1Count > 0, "Au moins un h1 present.", "Aucun h1 dans body."),
    "19246": () => passIf(facts.h1Count > 0 && facts.emptyH1Count === 0, "Aucun h1 vide.", "Un ou plusieurs h1 sont vides."),
    "19258": () => passIf(Boolean(text(facts.htmlLang)), "Attribut lang present sur html.", "Attribut lang manquant sur html."),
    "19259": () => passIf(facts.hasDoctype, "Doctype present.", "Doctype manquant avant html."),
    "19263": () => failIfCount(facts.imgMissingAltCount, "Toutes les images ont un attribut alt.", "Images sans attribut alt", examples(facts, "missingAltImages")),
    "19285": () => failIfCount(facts.metaRefreshCount, "Aucun meta refresh.", "Meta refresh detecte"),
    "19231": () => failIfCount(facts.emptyButtonCount, "Aucun bouton vide.", "Boutons vides", examples(facts, "emptyButtons")),
    "19216": () => failIfCount(facts.emptyLinkCount, "Aucun lien vide detecte.", "Liens vides hors ancres", examples(facts, "emptyLinks")),
    "19218": () => deprecatedAttributeResult(facts, "align"),
    "19219": () => deprecatedAttributeResult(facts, "alink"),
    "19221": () => failIfCount(facts.areaMissingAltCount, "Tous les elements area ont un alt.", "Elements area sans alt"),
    "19338": () => failIfCount(facts.areaEmptyAltCount, "Aucun alt vide sur area.", "Elements area avec alt vide"),
    "19222": () => failIfCount(facts.duplicateAreaAltDifferentHref, "Aucun alt area duplique vers des href differents.", "Alt area duplique vers des href differents"),
    "19353": () => failIfCount(facts.invalidDirCount, "Tous les attributs dir ont une valeur valide.", "Attributs dir invalides"),
    "19224": () => deprecatedAttributeResult(facts, "background"),
    "19348": () => failIfCount(facts.formWithoutSubmitCount, "Chaque formulaire a un controle d'envoi.", "Formulaires sans bouton ou input d'envoi")
  };

  const rgaaByUid = {
    "38634": () => passIf(facts.hasDoctype, "Doctype present.", "Doctype absent."),
    "38635": () => passIf(facts.doctypeValid, "Doctype HTML valide.", "Doctype absent ou non HTML."),
    "38636": () => passIf(facts.hasDoctype, "Doctype declare avant html dans le DOM.", "Doctype absent."),
    "38638": () => failIfCount(facts.obsoleteElementCount, "Aucun element HTML obsolete detecte.", "Elements obsoletes detectes", examples(facts, "obsoleteElements")),
    "38639": () => passIf(Boolean(text(facts.htmlLang)), "Langue par defaut declaree.", "Langue par defaut absente."),
    "38640": () => failIfCount(facts.invalidLangCount, "Codes langue detectes valides syntaxiquement.", "Codes langue invalides"),
    "38641": () => passIf(facts.hasTitleElement && Boolean(text(facts.titleText)), "Titre de page present.", "Titre de page absent ou vide."),
    "38644": () => failIfCount(facts.invalidLangCount, "Changements de langue syntaxiquement valides.", "Changements de langue invalides"),
    "38647": () => failIfCount(facts.invalidDirCount, "Attributs dir valides syntaxiquement.", "Attributs dir invalides"),
    "38648": () => passIf(facts.h1Count > 0, "Titre de niveau 1 present.", "Aucun h1 detecte."),
    "38649": () => failIfCount(facts.skippedHeadingLevelCount, "Aucun saut de niveau de titre detecte.", "Sauts de niveaux de titres detectes"),
    "38652": () => {
      const missing = [];
      if (facts.mainLandmarkCount !== 1) missing.push(`main=${facts.mainLandmarkCount}`);
      if (facts.bannerLandmarkCount < 1) missing.push("header/banner absent");
      if (facts.footerLandmarkCount < 1) missing.push("footer/contentinfo absent");
      return missing.length
        ? { status: "manual", message: `Structure landmark a confirmer (${missing.join(", ")}).`, automated: false, evidence: missing }
        : passIf(true, "Landmarks principaux detectes.", "Landmarks principaux incomplets.");
    },
    "38614": () => failIfCount(facts.sameNameDifferentHrefCount, "Aucun lien texte identique vers des destinations differentes.", "Liens texte identiques avec destinations differentes", examples(facts, "sameNameDifferentHrefLinks")),
    "38619": () => failIfCount(facts.emptyLinkCount, "Tous les liens ont un intitule detectable.", "Liens sans intitule detectable", examples(facts, "emptyLinks"))
  };

  const naResult = detectNotApplicable(rule, facts, description);
  if (naResult) return naResult;
  if (byUid[rule.uid]) return byUid[rule.uid]();
  if (rgaaByUid[rule.uid]) return rgaaByUid[rule.uid]();
  const deprecated = detectDeprecatedAttribute(description, facts);
  if (deprecated) return deprecated;
  if (description.includes("rapport de contraste")) {
    const axeContrast = axeRuleResult(facts, ["color-contrast", "color-contrast-enhanced"], "Contrastes valides selon axe-core.", "Probleme de contraste detecte");
    if (axeContrast) return axeContrast;
  }
  if (description.includes("titre de page") || description.includes("balise title")) {
    return passIf(facts.hasTitleElement && Boolean(text(facts.titleText)), "Titre de page present.", "Titre de page absent ou vide.");
  }
  if (description.includes("doctype") || description.includes("type de document")) {
    return passIf(facts.hasDoctype, "Doctype present.", "Doctype absent.");
  }
  if (description.includes("code de langue") || description.includes("changement de langue")) {
    return failIfCount(facts.invalidLangCount, "Codes langue valides syntaxiquement.", "Codes langue invalides");
  }
  if (description.includes("indication de langue par defaut")) {
    return passIf(Boolean(text(facts.htmlLang)), "Langue par defaut declaree.", "Langue par defaut absente.");
  }
  if (description.includes("hierarchie entre les titres")) {
    return failIfCount(facts.skippedHeadingLevelCount, "Aucun saut de niveau de titre detecte.", "Sauts de niveaux de titres detectes");
  }
  if (description.includes("meta") && description.includes("refresh")) {
    return failIfCount(facts.metaRefreshCount, "Aucun meta refresh.", "Meta refresh detecte");
  }
  if (description.includes("element iframe") && description.includes("title")) {
    return failIfCount(facts.iframeMissingTitleCount, "Tous les cadres ont un title.", "Cadres sans title");
  }
  if (description.includes("element img") && description.includes("alt")) {
    return failIfCount(facts.imgMissingAltCount, "Toutes les images ont un attribut alt.", "Images sans attribut alt", examples(facts, "missingAltImages"));
  }
  if (description.includes("element button") && description.includes("vide")) {
    return failIfCount(facts.emptyButtonCount, "Aucun bouton vide.", "Boutons vides", examples(facts, "emptyButtons"));
  }
  if ((description.includes("champ") || description.includes("input") || description.includes("form")) &&
      (description.includes("label") || description.includes("libelle"))) {
    return failIfCount(facts.unlabeledControlCount, "Tous les champs ont un libelle detectable.", "Champs de formulaire sans libelle detectable", examples(facts, "unlabeledControls"));
  }
  if (description.includes("id") && (description.includes("unique") || description.includes("identique") || description.includes("same"))) {
    return failIfCount(facts.duplicateIdCount, "Aucun identifiant id duplique.", "Identifiants id dupliques", (facts.duplicateIds || []).map((item) => `#${item.id} (${item.count} occurrences)`));
  }
  if (description.includes("table") && (description.includes("th") || description.includes("caption") || description.includes("header") || description.includes("entete"))) {
    return failIfCount(facts.tablesWithoutHeadersCount, "Les tableaux ont des entetes ou une legende detectable.", "Tableaux sans entetes ou legende detectable", examples(facts, "tablesWithoutHeaders"));
  }
  if ((description.includes("nouvelle fenetre") || description.includes("new window") || description.includes("target")) && description.includes("lien")) {
    return failIfCount(facts.linksOpeningNewTabWithoutRelCount, "Aucun lien target=_blank sans noopener.", "Liens target=_blank sans rel=noopener", examples(facts, "linksOpeningNewTabWithoutRel"));
  }
  if (description.includes("video") && (description.includes("sous-titre") || description.includes("caption") || description.includes("alternative"))) {
    return failIfCount(facts.videoWithoutTextAlternativeCount, "Les videos ont une alternative textuelle detectable.", "Videos sans piste ou alternative detectable");
  }
  if (description.includes("audio") && (description.includes("transcription") || description.includes("alternative"))) {
    return failIfCount(facts.audioWithoutTextAlternativeCount, "Les audios ont une alternative textuelle detectable.", "Audios sans piste ou alternative detectable");
  }
  return manual();
}

function evaluateRules(rules, facts) {
  return rules.map((rule) => {
    const result = evaluateKnownRule(rule, facts);
    return {
      ...rule,
      status: result.status,
      message: result.message,
      evidence: result.evidence || [],
      automated: result.automated !== false,
      source: rule.checklistName === "RGAA 4.1.2" ? "RGAA 4.1.2 DOM" : "Opquast DOM",
      tests: rule.tests || [],
      criterion: rule.criterion || "",
      sourceUrl: rule.sourceUrl || "",
      sourceLabel: rule.sourceLabel || ""
    };
  });
}

function axeIssueToResult(issue, status) {
  return {
    uid: `axe:${issue.id}`,
    checklistId: 0,
    checklistName: "axe-core",
    name: issue.id,
    description: issue.help || issue.description || issue.id,
    goal: issue.description || "",
    solution: issue.helpUrl || "",
    thema: issue.tags?.filter((tag) => /^wcag|best-practice/.test(tag)).join(", ") || "Accessibility",
    status,
    kind: "axe",
    source: "axe-core",
    impact: issue.impact,
    message: `${issue.nodeCount} element(s) concerne(s). Impact: ${issue.impact || "non precise"}.`,
    evidence: (issue.nodes || []).map((node) => {
      return [node.target, node.failureSummary || node.html].filter(Boolean).join(" - ");
    }),
    helpUrl: issue.helpUrl,
    automated: status === "fail"
  };
}

function evaluateAxe(facts) {
  const axe = facts.axe || { violations: [], incomplete: [] };
  const violations = (axe.violations || []).map((issue) => axeIssueToResult(issue, "fail"));
  const incomplete = (axe.incomplete || []).map((issue) => axeIssueToResult(issue, "manual"));
  return [...violations, ...incomplete];
}

function countByStatus(results, status) {
  return results.filter((result) => result.status === status).length;
}

function renderSummary() {
  els.pass.textContent = countByStatus(state.results, "pass");
  els.fail.textContent = countByStatus(state.results, "fail");
  els.manual.textContent = countByStatus(state.results, "manual");
  els.na.textContent = countByStatus(state.results, "na");
  els.axe.textContent = state.results.filter((result) => result.kind === "axe").length;
  els.summary.hidden = false;
  els.filters.hidden = false;
}

function resultMatchesFilter(result) {
  return state.filter === "all" || result.status === state.filter;
}

function renderResults() {
  const fragment = document.createDocumentFragment();
  for (const result of state.results.filter(resultMatchesFilter)) {
    const item = document.createElement("li");
    item.className = `result ${result.status} ${result.kind || ""}`;

    const header = document.createElement("header");
    const title = document.createElement("h2");
    title.textContent = `${result.uid} - ${result.description || result.name}`;
    const badge = document.createElement("span");
    badge.className = `badge ${result.status}`;
    badge.textContent = STATUS_LABELS[result.status];
    header.append(title, badge);

    const meta = document.createElement("p");
    meta.className = "meta";
    meta.textContent = [result.source, result.thema, result.checklistName].filter(Boolean).join(" / ");

    const message = document.createElement("p");
    message.className = "message";
    message.textContent = result.message;

    item.append(header, meta, message);

    if (result.evidence?.length) {
      const evidence = document.createElement("ul");
      evidence.className = "evidence";
      for (const line of result.evidence.slice(0, 4)) {
        const entry = document.createElement("li");
        entry.textContent = line;
        evidence.append(entry);
      }
      item.append(evidence);
    }

    if (result.tests?.length) {
      const details = document.createElement("details");
      details.className = "tests";
      const summary = document.createElement("summary");
      summary.textContent = `${result.tests.length} test(s) RGAA`;
      details.append(summary);
      const list = document.createElement("ol");
      for (const test of result.tests.slice(0, 12)) {
        const entry = document.createElement("li");
        entry.textContent = `${test.id} - ${test.description}`;
        list.append(entry);
      }
      details.append(list);
      item.append(details);
    }

    if (result.helpUrl) {
      const link = document.createElement("a");
      link.className = "solution";
      link.href = result.helpUrl;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "Documentation de correction";
      item.append(link);
    } else if (result.solution) {
      const solution = document.createElement("p");
      solution.className = "solution";
      solution.textContent = result.solution;
      item.append(solution);
    }
    if (result.sourceUrl) {
      const source = document.createElement("a");
      source.className = "solution";
      source.href = result.sourceUrl;
      source.target = "_blank";
      source.rel = "noreferrer";
      source.textContent = "Source officielle du critere";
      item.append(source);
    }
    fragment.append(item);
  }
  els.results.replaceChildren(fragment);
}

function renderAll() {
  renderSummary();
  renderResults();
}

function buildReport() {
  const counts = {
    pass: countByStatus(state.results, "pass"),
    fail: countByStatus(state.results, "fail"),
    manual: countByStatus(state.results, "manual"),
    na: countByStatus(state.results, "na"),
    axe: state.results.filter((result) => result.kind === "axe").length,
    axePasses: state.facts?.axe?.passes?.length || 0
  };
  return {
    generatedAt: new Date().toISOString(),
    url: state.facts?.url || "",
    pageTitle: state.facts?.pageTitle || "",
    checklist: state.activeChecklistFile,
    counts,
    facts: state.facts,
    results: state.results
  };
}

async function runAnalysis() {
  els.run.disabled = true;
  els.report.disabled = true;
  els.export.disabled = true;
  setMessage("Analyse en cours...");
  try {
    const file = els.checklist.value;
    if (!state.checklist || state.activeChecklistFile !== file) {
      await loadChecklist(file);
    }
    const tab = await getActiveTab();
    if (!tab?.id || !/^https?:|^file:/.test(tab.url || "")) {
      throw new Error("Cette page ne peut pas etre analysee par une WebExtension.");
    }
    els.currentUrl.textContent = tab.url;
    state.facts = await collectFacts(tab);
    state.results = [
      ...evaluateAxe(state.facts),
      ...evaluateRules(state.checklist, state.facts)
    ];
    state.report = buildReport();
    await api.storage.local.set({
      language: els.language.value,
      checklist: file,
      latestReport: state.report
    });
    state.filter = "fail";
    for (const button of els.filters.querySelectorAll("button")) {
      button.classList.toggle("active", button.dataset.filter === "fail");
    }
    const axeCount = state.results.filter((result) => result.kind === "axe" && result.status === "fail").length;
    setMessage(`${state.results.length} controles produits, dont ${axeCount} problemes axe-core. Affichage filtre sur les corrections.`);
    els.report.disabled = false;
    els.export.disabled = false;
    renderAll();
  } catch (error) {
    setMessage(error.message || String(error));
  } finally {
    els.run.disabled = false;
  }
}

function exportJson() {
  const payload = state.report || buildReport();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "opquast-results.json";
  link.click();
  URL.revokeObjectURL(url);
}

async function openReport() {
  state.report = state.report || buildReport();
  await api.storage.local.set({ latestReport: state.report });
  await api.tabs.create({ url: api.runtime.getURL("report/report.html") });
}

async function init() {
  await loadIndex();
  populateLanguages();

  const stored = await api.storage.local.get(["language", "checklist"]);
  const hasDefault = state.index.some((entry) => entry.file === DEFAULT_CHECKLIST);
  if (hasDefault) {
    els.language.value = "fr";
  } else if (stored.language && Array.from(els.language.options).some((option) => option.value === stored.language)) {
    els.language.value = stored.language;
  } else if (Array.from(els.language.options).some((option) => option.value === "fr")) {
    els.language.value = "fr";
  }

  populateChecklists();
  if (hasDefault && Array.from(els.checklist.options).some((option) => option.value === DEFAULT_CHECKLIST)) {
    els.checklist.value = DEFAULT_CHECKLIST;
  } else if (stored.checklist && Array.from(els.checklist.options).some((option) => option.value === stored.checklist)) {
    els.checklist.value = stored.checklist;
  }

  const tab = await getActiveTab();
  if (tab?.url) {
    els.currentUrl.textContent = tab.url;
  }
}

els.language.addEventListener("change", () => {
  populateChecklists();
  state.checklist = null;
});

els.checklist.addEventListener("change", () => {
  state.checklist = null;
});

els.run.addEventListener("click", runAnalysis);
els.export.addEventListener("click", exportJson);
els.report.addEventListener("click", openReport);

els.filters.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-filter]");
  if (!button) return;
  state.filter = button.dataset.filter;
  for (const other of els.filters.querySelectorAll("button")) {
    other.classList.toggle("active", other === button);
  }
  renderResults();
});

init().catch((error) => setMessage(error.message || String(error)));
