(() => {
  if (globalThis.__opquastAnalyzerInstalled) {
    return;
  }
  globalThis.__opquastAnalyzerInstalled = true;

  const api = typeof browser !== "undefined" ? browser : chrome;

  function compactText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function labelledByText(element) {
    const ids = compactText(element.getAttribute("aria-labelledby")).split(" ").filter(Boolean);
    return ids.map((id) => compactText(document.getElementById(id)?.textContent)).filter(Boolean).join(" ");
  }

  function accessibleName(element) {
    const aria = compactText(element.getAttribute("aria-label"));
    const labelled = labelledByText(element);
    const title = compactText(element.getAttribute("title"));
    const value = compactText(element.value);
    const text = compactText(element.textContent);
    const childAlt = Array.from(element.querySelectorAll("img[alt], area[alt]"))
      .map((node) => compactText(node.getAttribute("alt")))
      .filter(Boolean)
      .join(" ");
    return compactText([aria, labelled, text, childAlt, value, title].find(Boolean));
  }

  function describeElement(element) {
    const tag = element.tagName.toLowerCase();
    const id = element.id ? `#${element.id}` : "";
    const cls = typeof element.className === "string" && element.className.trim()
      ? `.${element.className.trim().split(/\s+/).slice(0, 2).join(".")}`
      : "";
    const attr = element.getAttribute("href") || element.getAttribute("src") || element.getAttribute("name") || "";
    return compactText(`${tag}${id}${cls}${attr ? ` (${attr})` : ""}`);
  }

  function countDeprecatedAttributes(names) {
    const counts = {};
    for (const name of names) {
      counts[name] = document.querySelectorAll(`[${CSS.escape(name)}]`).length;
    }
    return counts;
  }

  function getLabelText(control) {
    const id = control.id ? CSS.escape(control.id) : "";
    const explicit = id ? Array.from(document.querySelectorAll(`label[for="${id}"]`)) : [];
    const implicit = control.closest("label") ? [control.closest("label")] : [];
    return textList([...explicit, ...implicit].map((label) => label.textContent));
  }

  function textList(values) {
    return values.map(compactText).filter(Boolean).join(" ");
  }

  function controlName(control) {
    return compactText([
      getLabelText(control),
      control.getAttribute("aria-label"),
      labelledByText(control),
      control.getAttribute("title"),
      control.getAttribute("placeholder")
    ].find(Boolean));
  }

  function findDuplicateIds() {
    const ids = new Map();
    for (const element of document.querySelectorAll("[id]")) {
      const id = element.id;
      if (!id) continue;
      ids.set(id, (ids.get(id) || 0) + 1);
    }
    return Array.from(ids.entries())
      .filter(([, count]) => count > 1)
      .map(([id, count]) => ({ id, count }));
  }

  function hasAccessibleMediaAlternative(media) {
    return Boolean(compactText(media.getAttribute("title") || media.getAttribute("aria-label") || labelledByText(media)));
  }

  function isImageObject(element) {
    return compactText(element.getAttribute("type")).toLowerCase().startsWith("image/");
  }

  function hasInlineEventHandler(element) {
    return Array.from(element.attributes).some((attribute) => attribute.name.toLowerCase().startsWith("on"));
  }

  function hasCssMotion(element) {
    const style = getComputedStyle(element);
    return style.animationName !== "none" ||
      parseFloat(style.animationDuration) > 0 ||
      style.transitionProperty !== "none" ||
      parseFloat(style.transitionDuration) > 0;
  }

  function isValidLanguageCode(value) {
    return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(compactText(value));
  }

  function summarizeAxeNode(node) {
    return {
      target: Array.isArray(node.target) ? node.target.join(", ") : String(node.target || ""),
      html: compactText(node.html).slice(0, 240),
      failureSummary: compactText(node.failureSummary).slice(0, 500)
    };
  }

  async function runAxe() {
    if (!globalThis.axe || typeof globalThis.axe.run !== "function") {
      return {
        available: false,
        error: "axe-core n'est pas charge dans cette page.",
        violations: [],
        incomplete: [],
        passes: []
      };
    }

    try {
      const results = await globalThis.axe.run(document, {
        resultTypes: ["violations", "incomplete", "passes"],
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa", "best-practice"]
        }
      });
      return {
        available: true,
        testEngine: results.testEngine,
        testRunner: results.testRunner,
        testEnvironment: results.testEnvironment,
        testTimestamp: results.timestamp,
        violations: results.violations.map((item) => ({
          id: item.id,
          impact: item.impact || "minor",
          tags: item.tags || [],
          help: item.help,
          description: item.description,
          helpUrl: item.helpUrl,
          nodes: item.nodes.slice(0, 8).map(summarizeAxeNode),
          nodeCount: item.nodes.length
        })),
        incomplete: results.incomplete.map((item) => ({
          id: item.id,
          impact: item.impact || "moderate",
          tags: item.tags || [],
          help: item.help,
          description: item.description,
          helpUrl: item.helpUrl,
          nodes: item.nodes.slice(0, 8).map(summarizeAxeNode),
          nodeCount: item.nodes.length
        })),
        passes: results.passes.map((item) => ({
          id: item.id,
          impact: item.impact || null,
          tags: item.tags || [],
          help: item.help,
          description: item.description,
          helpUrl: item.helpUrl,
          nodeCount: item.nodes.length
        }))
      };
    } catch (error) {
      return {
        available: false,
        error: error.message || String(error),
        violations: [],
        incomplete: [],
        passes: []
      };
    }
  }

  async function collectFacts() {
    const titleElement = document.querySelector("head > title");
    const titleText = compactText(titleElement?.textContent);
    const html = document.documentElement;
    const h1 = Array.from(document.querySelectorAll("body h1"));
    const images = Array.from(document.images);
    const areas = Array.from(document.querySelectorAll("area[href]"));
    const forms = Array.from(document.forms);
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    const buttons = Array.from(document.querySelectorAll("button"));
    const inputButtons = Array.from(document.querySelectorAll("input[type='button'], input[type='submit'], input[type='image']"));
    const formControls = Array.from(document.querySelectorAll("input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='reset']):not([type='image']), select, textarea"));
    const tables = Array.from(document.querySelectorAll("table"));
    const videos = Array.from(document.querySelectorAll("video"));
    const audios = Array.from(document.querySelectorAll("audio"));
    const iframes = Array.from(document.querySelectorAll("iframe, frame"));
    const objects = Array.from(document.querySelectorAll("object"));
    const embeds = Array.from(document.querySelectorAll("embed"));
    const svgs = Array.from(document.querySelectorAll("svg"));
    const canvases = Array.from(document.querySelectorAll("canvas"));
    const imageInputs = Array.from(document.querySelectorAll("input[type='image']"));
    const imageMaps = Array.from(document.querySelectorAll("img[usemap], img[ismap], object[usemap], object[ismap]"));
    const figuresWithMedia = Array.from(document.querySelectorAll("figure")).filter((figure) => figure.querySelector("img, input[type='image'], object[type^='image/'], embed[type^='image/'], svg, canvas"));
    const lists = Array.from(document.querySelectorAll("ul, ol, dl"));
    const quotes = Array.from(document.querySelectorAll("blockquote, q"));
    const scripts = Array.from(document.querySelectorAll("script"));
    const allElements = Array.from(document.querySelectorAll("*"));
    const langElements = Array.from(document.querySelectorAll("[lang], [xml\\:lang]"));
    const obsoleteElements = Array.from(document.querySelectorAll("acronym, applet, basefont, big, center, dir, font, frame, frameset, noframes, strike, tt, marquee"));
    const mainLandmarks = Array.from(document.querySelectorAll("main, [role='main']"));
    const bannerLandmarks = Array.from(document.querySelectorAll("header, [role='banner']"));
    const navLandmarks = Array.from(document.querySelectorAll("nav, [role='navigation']"));
    const footerLandmarks = Array.from(document.querySelectorAll("footer, [role='contentinfo']"));
    const searchLandmarks = Array.from(document.querySelectorAll("[role='search'], form[role='search'], input[type='search']"));
    const inlineEventHandlerCount = allElements.filter(hasInlineEventHandler).length;
    const cssMotionCount = allElements.slice(0, 2000).filter(hasCssMotion).length;
    const animatedImageCount = images.filter((img) => /\.(gif|apng)(?:[?#].*)?$/i.test(img.currentSrc || img.src || "")).length;
    const captchaCandidates = allElements.filter((element) => {
      const haystack = compactText([
        element.id,
        element.className,
        element.getAttribute("name"),
        element.getAttribute("alt"),
        element.getAttribute("title"),
        element.getAttribute("aria-label"),
        element.getAttribute("src")
      ].join(" ")).toLowerCase();
      return haystack.includes("captcha") || haystack.includes("challenge");
    });
    const downloadLinks = anchors.filter((anchor) => {
      const href = compactText(anchor.getAttribute("href"));
      return anchor.hasAttribute("download") || /\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|zip|rar|7z)(?:[?#].*)?$/i.test(href);
    });
    const dirElements = Array.from(document.querySelectorAll("[dir]"));
    const metaRefresh = document.querySelectorAll("meta[http-equiv]").length
      ? Array.from(document.querySelectorAll("meta[http-equiv]")).filter((node) => compactText(node.getAttribute("http-equiv")).toLowerCase() === "refresh")
      : [];
    const areaAltByHref = new Map();
    let duplicateAreaAltDifferentHref = 0;

    for (const area of areas) {
      const alt = compactText(area.getAttribute("alt"));
      const href = compactText(area.getAttribute("href"));
      if (!alt || !href) continue;
      const previous = areaAltByHref.get(alt);
      if (previous && previous !== href) {
        duplicateAreaAltDifferentHref += 1;
      } else {
        areaAltByHref.set(alt, href);
      }
    }

    const emptyLinks = anchors.filter((anchor) => {
      const href = compactText(anchor.getAttribute("href"));
      if (!href || href.startsWith("#")) return false;
      return !accessibleName(anchor);
    });
    const linkKinds = anchors.map((anchor) => {
      const hasText = Boolean(compactText(Array.from(anchor.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join(" ")));
      const hasRasterImage = Boolean(anchor.querySelector("img, input[type='image'], canvas, object[type^='image/'], embed[type^='image/']"));
      const hasVectorImage = Boolean(anchor.querySelector("svg"));
      return { anchor, hasText, hasRasterImage, hasVectorImage };
    });
    const textLinks = linkKinds.filter((item) => item.hasText && !item.hasRasterImage && !item.hasVectorImage).map((item) => item.anchor);
    const imageLinks = linkKinds.filter((item) => item.hasRasterImage).map((item) => item.anchor);
    const vectorLinks = linkKinds.filter((item) => item.hasVectorImage).map((item) => item.anchor);
    const compositeLinks = linkKinds.filter((item) => item.hasText && (item.hasRasterImage || item.hasVectorImage)).map((item) => item.anchor);
    const titleLinks = anchors.filter((anchor) => anchor.hasAttribute("title"));
    const linkNames = new Map();
    let sameNameDifferentHrefCount = 0;
    for (const anchor of anchors) {
      const name = accessibleName(anchor).toLowerCase();
      const href = compactText(anchor.href || anchor.getAttribute("href"));
      if (!name || !href) continue;
      const previous = linkNames.get(name);
      if (previous && previous !== href) sameNameDifferentHrefCount += 1;
      else linkNames.set(name, href);
    }
    const unlabeledControls = formControls.filter((control) => !controlName(control));
    const duplicateIds = findDuplicateIds();
    const linksOpeningNewTabWithoutRel = anchors.filter((anchor) => {
      return compactText(anchor.getAttribute("target")).toLowerCase() === "_blank" &&
        !compactText(anchor.getAttribute("rel")).toLowerCase().split(/\s+/).includes("noopener");
    });
    const targetBlankLinks = anchors.filter((anchor) => compactText(anchor.getAttribute("target")).toLowerCase() === "_blank");
    const tablesWithoutHeaders = tables.filter((table) => {
      return !table.querySelector("caption, th, thead, [scope], [headers], [aria-label], [aria-labelledby]");
    });
    const headingLevels = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6")).map((heading) => Number(heading.tagName.slice(1)));
    let skippedHeadingLevelCount = 0;
    headingLevels.reduce((previous, current) => {
      if (previous && current > previous + 1) skippedHeadingLevelCount += 1;
      return current;
    }, 0);

    const facts = {
      url: location.href,
      pageTitle: document.title || "",
      hasTitleElement: Boolean(titleElement),
      titleText,
      hasDoctype: Boolean(document.doctype),
      doctypeName: document.doctype?.name || "",
      doctypeValid: Boolean(document.doctype && compactText(document.doctype.name).toLowerCase() === "html"),
      htmlLang: compactText(html?.getAttribute("lang") || html?.getAttribute("xml:lang")),
      invalidLangCount: langElements.filter((node) => {
        return !isValidLanguageCode(node.getAttribute("lang") || node.getAttribute("xml:lang"));
      }).length,
      h1Count: h1.length,
      emptyH1Count: h1.filter((node) => !compactText(node.textContent)).length,
      imageCount: images.length,
      imageLikeCount: images.length + areas.length + objects.filter(isImageObject).length + embeds.filter(isImageObject).length + svgs.length + canvases.length + imageInputs.length,
      imgMissingAltCount: images.filter((img) => !img.hasAttribute("alt")).length,
      imgEmptyAltCount: images.filter((img) => img.hasAttribute("alt") && !compactText(img.getAttribute("alt"))).length,
      areaCount: areas.length,
      areaMissingAltCount: areas.filter((area) => !area.hasAttribute("alt")).length,
      areaEmptyAltCount: areas.filter((area) => area.hasAttribute("alt") && !compactText(area.getAttribute("alt"))).length,
      duplicateAreaAltDifferentHref,
      emptyLinkCount: emptyLinks.length,
      emptyButtonCount: buttons.filter((button) => !accessibleName(button)).length,
      emptyInputButtonCount: inputButtons.filter((input) => !accessibleName(input)).length,
      unlabeledControlCount: unlabeledControls.length,
      imageInputCount: imageInputs.length,
      imageInputMissingAltCount: imageInputs.filter((input) => !input.hasAttribute("alt")).length,
      formWithoutSubmitCount: forms.filter((form) => !form.querySelector("button, input[type='submit'], input[type='button'], input[type='image']")).length,
      formCount: forms.length,
      formControlCount: formControls.length,
      tableCount: tables.length,
      iframeCount: iframes.length,
      objectCount: objects.length,
      objectImageCount: objects.filter(isImageObject).length,
      embedCount: embeds.length,
      embedImageCount: embeds.filter(isImageObject).length,
      svgCount: svgs.length,
      canvasCount: canvases.length,
      imageMapCount: imageMaps.length,
      figureWithMediaCount: figuresWithMedia.length,
      videoCount: videos.length,
      audioCount: audios.length,
      mediaCount: videos.length + audios.length + objects.length + embeds.length,
      listCount: lists.length,
      quoteCount: quotes.length,
      linkCount: anchors.length,
      textLinkCount: textLinks.length,
      imageLinkCount: imageLinks.length,
      vectorLinkCount: vectorLinks.length,
      compositeLinkCount: compositeLinks.length,
      titleLinkCount: titleLinks.length,
      sameNameDifferentHrefCount,
      scriptCount: scripts.length,
      inlineEventHandlerCount,
      scriptedElementCount: scripts.length + inlineEventHandlerCount,
      obsoleteElementCount: obsoleteElements.length,
      mainLandmarkCount: mainLandmarks.length,
      bannerLandmarkCount: bannerLandmarks.length,
      navLandmarkCount: navLandmarks.length,
      footerLandmarkCount: footerLandmarks.length,
      searchLandmarkCount: searchLandmarks.length,
      cssMotionCount,
      animatedImageCount,
      motionCandidateCount: cssMotionCount + animatedImageCount + document.querySelectorAll("marquee, blink").length,
      captchaCandidateCount: captchaCandidates.length,
      downloadLinkCount: downloadLinks.length,
      duplicateIdCount: duplicateIds.reduce((sum, item) => sum + item.count - 1, 0),
      duplicateIds: duplicateIds.slice(0, 10),
      linksOpeningNewTabWithoutRelCount: linksOpeningNewTabWithoutRel.length,
      targetBlankLinkCount: targetBlankLinks.length,
      tablesWithoutHeadersCount: tablesWithoutHeaders.length,
      headingCount: headingLevels.length,
      skippedHeadingLevelCount,
      videoWithoutTextAlternativeCount: videos.filter((video) => !video.querySelector("track[kind='captions'], track[kind='subtitles']") && !hasAccessibleMediaAlternative(video)).length,
      audioWithoutTextAlternativeCount: audios.filter((audio) => !audio.querySelector("track[kind='captions'], track[kind='subtitles']") && !hasAccessibleMediaAlternative(audio)).length,
      invalidDirCount: dirElements.filter((node) => {
        const value = compactText(node.getAttribute("dir")).toLowerCase();
        return value !== "" && value !== "ltr" && value !== "rtl" && value !== "auto";
      }).length,
      iframeMissingTitleCount: document.querySelectorAll("iframe:not([title]), frame:not([title])").length,
      metaRefreshCount: metaRefresh.length,
      deprecatedAttributes: countDeprecatedAttributes([
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
      ]),
      examples: {
        emptyLinks: emptyLinks.slice(0, 5).map(describeElement),
        missingAltImages: images.filter((img) => !img.hasAttribute("alt")).slice(0, 5).map(describeElement),
        emptyButtons: buttons.filter((button) => !accessibleName(button)).slice(0, 5).map(describeElement),
        unlabeledControls: unlabeledControls.slice(0, 5).map(describeElement),
        linksOpeningNewTabWithoutRel: linksOpeningNewTabWithoutRel.slice(0, 5).map(describeElement),
        tablesWithoutHeaders: tablesWithoutHeaders.slice(0, 5).map(describeElement),
        downloadLinks: downloadLinks.slice(0, 5).map(describeElement),
        obsoleteElements: obsoleteElements.slice(0, 5).map(describeElement),
        sameNameDifferentHrefLinks: anchors.filter((anchor) => linkNames.has(accessibleName(anchor).toLowerCase())).slice(0, 5).map(describeElement)
      },
      axe: await runAxe()
    };

    return facts;
  }

  api.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "opquast:collect-page-facts") {
      return undefined;
    }
    return collectFacts();
  });
})();
