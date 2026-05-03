interface ExtractTextResponse {
  visibleText: string;
  selectedText?: string;
  titleHints?: string[];
}

const cleanText = (value: string): string => value.replace(/\s+/g, " ").trim();

const EMAIL_BODY_LABEL_PATTERN =
  /message body|email body|mail body|nachrichtentext|nachrichteninhalt|邮件正文|郵件正文|本文|message text|message content/i;

const elementVisibleInViewport = (el: Element): boolean => {
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) {
    return false;
  }
  return rect.bottom >= 0 && rect.top <= window.innerHeight && rect.right >= 0 && rect.left <= window.innerWidth;
};

const getHostKind = (): "outlook" | "gmail" | "generic-mail" | "default" => {
  const host = window.location.hostname.toLowerCase();
  if (host.includes("outlook.") || host.includes("office.com") || host.includes("microsoft.com")) {
    return "outlook";
  }
  if (host.includes("mail.google.com")) {
    return "gmail";
  }
  if (host.includes("mail.") || host.includes("webmail") || host.includes("inbox")) {
    return "generic-mail";
  }
  return "default";
};

const isElementUsableContainer = (element: Element): element is HTMLElement => {
  if (!(element instanceof HTMLElement)) {
    return false;
  }
  if (!elementVisibleInViewport(element)) {
    return false;
  }
  const style = window.getComputedStyle(element);
  if (style.visibility === "hidden" || style.display === "none") {
    return false;
  }
  return true;
};

const scoreReadingPaneCandidate = (element: HTMLElement): number => {
  const rect = element.getBoundingClientRect();
  const text = cleanText(element.innerText || "");
  if (text.length < 80) {
    return Number.NEGATIVE_INFINITY;
  }

  const centerX = rect.left + rect.width / 2;
  const rightHalfBoost = centerX >= window.innerWidth * 0.52 ? 20 : centerX >= window.innerWidth * 0.4 ? 8 : -20;
  const areaBoost = Math.min((rect.width * rect.height) / 25000, 18);
  const textBoost = Math.min(text.length / 250, 18);
  const dateSignalBoost =
    (text.match(/\b\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?\b/g)?.length ?? 0) * 4 +
    (text.match(/\b\d{1,2}[:.]\d{2}\b/g)?.length ?? 0) * 3;
  const headingBoost = element.querySelector("h1, h2, h3, [role='heading']") ? 8 : 0;
  const buttonPenalty = Math.min(element.querySelectorAll("button, [role='button'], nav, aside").length, 8) * 2;
  const listPenalty = Math.min(element.querySelectorAll("[role='listitem']").length, 12) * 1.5;

  return rightHalfBoost + areaBoost + textBoost + dateSignalBoost + headingBoost - buttonPenalty - listPenalty;
};

const findReadingPaneRoot = (): HTMLElement | null => {
  const hostKind = getHostKind();
  if (hostKind === "default") {
    return null;
  }

  const hostSpecificSelectors =
    hostKind === "outlook"
      ? [
          '[role="document"]',
          '[aria-label*="Message body"]',
          '[aria-label*="message body"]',
          '[aria-label*="Nachrichtentext"]',
          '[aria-label*="邮件正文"]',
          '[aria-label*="郵件正文"]',
          '[data-app-section="MailReadCompose"]'
        ]
      : hostKind === "gmail"
        ? ['div.a3s.aiL', 'div[role="listitem"] .a3s', 'div[data-message-id]']
        : ['[role="document"]', 'main article', 'article', '[aria-label*="message"]'];

  for (const selector of hostSpecificSelectors) {
    const matches = Array.from(document.querySelectorAll(selector)).filter(isElementUsableContainer);
    const best = matches
      .map((element) => ({ element, score: scoreReadingPaneCandidate(element) + 25 }))
      .sort((a, b) => b.score - a.score)[0];
    if (best && Number.isFinite(best.score)) {
      return best.element;
    }
  }

  const genericCandidates = Array.from(document.querySelectorAll("main, article, section, div"))
    .filter(isElementUsableContainer)
    .map((element) => ({ element, score: scoreReadingPaneCandidate(element) }))
    .filter((item) => item.score > 20)
    .sort((a, b) => b.score - a.score);

  return genericCandidates[0]?.element ?? null;
};

const extractVisibleText = (root: ParentNode = document.body): string => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const chunks: string[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const text = cleanText(node.textContent ?? "");
    if (!text) {
      continue;
    }
    const parent = node.parentElement;
    if (!parent || !elementVisibleInViewport(parent)) {
      continue;
    }
    const style = window.getComputedStyle(parent);
    if (style.visibility === "hidden" || style.display === "none") {
      continue;
    }
    chunks.push(text);
  }
  return chunks.join("\n").slice(0, 40000);
};

const isGoodTitleHint = (value: string): boolean => {
  const text = cleanText(value);
  if (!text || text.length < 3 || text.length > 120) {
    return false;
  }
  if (
    /^(?:tickets? kaufen|buy tickets?|download calendar entry|add to calendar|copy link|share|register|login|eventfrog|detail|details)$/i.test(
      text
    )
  ) {
    return false;
  }
  return true;
};

const isInteractiveElement = (element: Element): boolean =>
  Boolean(
    element.closest(
      "a, button, summary, input, select, textarea, [role='button'], [role='link'], [aria-haspopup], [onclick], [data-action]"
    )
  );

const collectJsonLdTitleHints = (): string[] => {
  const hints: string[] = [];
  const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));

  const visit = (value: unknown): void => {
    if (!value) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object") {
      return;
    }

    const record = value as Record<string, unknown>;
    const typeValue = record["@type"];
    const nameValue = record.name;
    const types = Array.isArray(typeValue) ? typeValue : [typeValue];
    const hasEventType = types.some((item) => typeof item === "string" && /event/i.test(item));

    if (hasEventType && typeof nameValue === "string" && isGoodTitleHint(nameValue)) {
      hints.push(cleanText(nameValue));
    }

    Object.values(record).forEach(visit);
  };

  scripts.forEach((script) => {
    try {
      visit(JSON.parse(script.textContent ?? ""));
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  });

  return hints;
};

const extractTitleHints = (root: ParentNode = document.body): string[] => {
  const candidates: Array<{ text: string; score: number }> = [];
  const seen = new Set<string>();

  const addCandidate = (text: string, score: number): void => {
    const cleaned = cleanText(text);
    const key = cleaned.toLowerCase();
    if (!isGoodTitleHint(cleaned) || seen.has(key)) {
      return;
    }
    seen.add(key);
    candidates.push({ text: cleaned, score });
  };

  const docTitle = document.title.split("|")[0]?.split(" - ")[0]?.trim();
  if (docTitle) {
    addCandidate(docTitle, 70);
  }

  const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute("content");
  if (ogTitle) {
    addCandidate(ogTitle.split("|")[0]?.trim() ?? ogTitle, 80);
  }

  collectJsonLdTitleHints().forEach((hint) => addCandidate(hint, 100));

  const selectorElements = Array.from((root as ParentNode).querySelectorAll?.("h1, h2, h3, [role='heading']") ?? []);
  selectorElements.forEach((element) => {
    if (!elementVisibleInViewport(element)) {
      return;
    }
    if (isInteractiveElement(element)) {
      return;
    }
    const style = window.getComputedStyle(element);
    const fontSize = Number.parseFloat(style.fontSize || "0");
    const fontWeight = Number.parseInt(style.fontWeight || "400", 10);
    addCandidate(element.textContent ?? "", 55 + Math.min(fontSize, 56) + Math.min(fontWeight / 100, 4));
  });

  const allElements =
    root instanceof HTMLElement || root instanceof Document
      ? Array.from(root.querySelectorAll("*"))
      : Array.from(document.querySelectorAll("body *"));
  allElements.forEach((element) => {
    if (!(element instanceof HTMLElement) || !elementVisibleInViewport(element)) {
      return;
    }
    if (element.children.length > 0) {
      return;
    }
    if (isInteractiveElement(element)) {
      return;
    }
    const style = window.getComputedStyle(element);
    const fontSize = Number.parseFloat(style.fontSize || "0");
    const fontWeight = Number.parseInt(style.fontWeight || "400", 10);
    if (fontSize < 26) {
      return;
    }
    let score = fontSize + Math.min(fontWeight / 100, 5);
    if (fontSize >= 36) {
      score += 12;
    } else if (fontSize >= 30) {
      score += 6;
    }
    addCandidate(element.innerText, score);
  });

  return candidates
    .sort((a, b) => b.score - a.score || a.text.length - b.text.length)
    .slice(0, 8)
    .map((item) => item.text);
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "PING_CONTENT_SCRIPT") {
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === "EXTRACT_TEXT_CONTEXT") {
    const selectedText = window.getSelection()?.toString().trim() || undefined;
    const scopedRoot = findReadingPaneRoot() ?? document.body;
    const response: ExtractTextResponse = {
      visibleText: extractVisibleText(scopedRoot),
      selectedText,
      titleHints: extractTitleHints(scopedRoot)
    };
    sendResponse(response);
    return true;
  }
  return undefined;
});
