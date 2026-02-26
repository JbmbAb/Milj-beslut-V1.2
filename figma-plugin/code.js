figma.showUI(__html__, { width: 420, height: 620 });

const C = {
  pageBg: { r: 0.09, g: 0.1, b: 0.12 },
  shellBg: { r: 0.93, g: 0.95, b: 0.98 },
  topbarBg: { r: 0.08, g: 0.1, b: 0.13 },
  sidebarBg: { r: 0.11, g: 0.13, b: 0.17 },
  cardBg: { r: 1, g: 1, b: 1 },
  cardBorder: { r: 0.84, g: 0.88, b: 0.94 },
  textDark: { r: 0.14, g: 0.16, b: 0.2 },
  textMid: { r: 0.33, g: 0.38, b: 0.47 },
  textLight: { r: 0.88, g: 0.91, b: 0.96 },
  brandBlue: { r: 0.03, g: 0.39, b: 0.98 },
  okGreen: { r: 0.14, g: 0.64, b: 0.31 }
};

function setTextColor(node, color) {
  node.fills = [{ type: "SOLID", color }];
}

function setBg(frame, color) {
  frame.fills = [{ type: "SOLID", color }];
}

function emptyFrameFill(frame) {
  frame.fills = [];
  frame.strokes = [];
}

function truncate(input, max) {
  const text = String(input || "");
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}

async function loadFonts() {
  await figma.loadFontAsync({ family: "Inter", style: "Bold" });
  try {
    await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });
  } catch (_err) {
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  }
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
}

function centerOnCanvas(node) {
  figma.currentPage.appendChild(node);
  const vp = figma.viewport.center;
  node.x = vp.x - node.width / 2;
  node.y = vp.y - node.height / 2;
  figma.viewport.scrollAndZoomIntoView([node]);
  figma.currentPage.selection = [node];
}

function createText(chars, size, weight, color) {
  const t = figma.createText();
  t.fontName = { family: "Inter", style: weight };
  t.fontSize = size;
  t.characters = chars;
  setTextColor(t, color || C.textDark);
  return t;
}

function createPill(label, bg, fg) {
  const pill = figma.createFrame();
  pill.layoutMode = "HORIZONTAL";
  pill.primaryAxisSizingMode = "AUTO";
  pill.counterAxisSizingMode = "AUTO";
  pill.paddingTop = 6;
  pill.paddingRight = 10;
  pill.paddingBottom = 6;
  pill.paddingLeft = 10;
  pill.cornerRadius = 999;
  setBg(pill, bg);
  const text = createText(label, 11, "Semi Bold", fg);
  pill.appendChild(text);
  return pill;
}

function createTopbar(title, width) {
  const bar = figma.createFrame();
  bar.layoutMode = "HORIZONTAL";
  bar.primaryAxisSizingMode = "FIXED";
  bar.counterAxisSizingMode = "FIXED";
  bar.primaryAxisAlignItems = "SPACE_BETWEEN";
  bar.counterAxisAlignItems = "CENTER";
  bar.paddingTop = 16;
  bar.paddingRight = 20;
  bar.paddingBottom = 16;
  bar.paddingLeft = 20;
  bar.cornerRadius = 14;
  setBg(bar, C.topbarBg);
  bar.resize(width, 76);

  const left = figma.createFrame();
  left.layoutMode = "VERTICAL";
  left.primaryAxisSizingMode = "AUTO";
  left.counterAxisSizingMode = "AUTO";
  left.itemSpacing = 4;
  emptyFrameFill(left);
  left.appendChild(createText("Miljobeslut.se Dashboard", 17, "Bold", C.textLight));
  left.appendChild(createText(truncate(title || "Platform for environment and construction", 70), 12, "Regular", { r: 0.67, g: 0.75, b: 0.9 }));

  const right = figma.createFrame();
  right.layoutMode = "HORIZONTAL";
  right.primaryAxisSizingMode = "AUTO";
  right.counterAxisSizingMode = "AUTO";
  right.itemSpacing = 8;
  emptyFrameFill(right);
  right.appendChild(createPill("Verified flow", { r: 0.13, g: 0.24, b: 0.17 }, { r: 0.76, g: 0.95, b: 0.81 }));
  right.appendChild(createPill("Human in the loop", { r: 0.14, g: 0.18, b: 0.24 }, { r: 0.8, g: 0.87, b: 0.99 }));

  bar.appendChild(left);
  bar.appendChild(right);
  return bar;
}

function createSidebar(height) {
  const side = figma.createFrame();
  side.layoutMode = "VERTICAL";
  side.primaryAxisSizingMode = "AUTO";
  side.counterAxisSizingMode = "FIXED";
  side.itemSpacing = 12;
  side.paddingTop = 16;
  side.paddingRight = 12;
  side.paddingBottom = 16;
  side.paddingLeft = 12;
  side.cornerRadius = 12;
  setBg(side, C.sidebarBg);
  side.resize(250, height);

  side.appendChild(createText("Modules", 12, "Semi Bold", { r: 0.57, g: 0.64, b: 0.77 }));

  [
    "Ansokningsportal",
    "Logistik Schaktmassor",
    "Projektledning",
    "Gronkoll for banker"
  ].forEach((item, index) => {
    const row = figma.createFrame();
    row.layoutMode = "HORIZONTAL";
    row.primaryAxisSizingMode = "FIXED";
    row.counterAxisSizingMode = "AUTO";
    row.counterAxisAlignItems = "CENTER";
    row.itemSpacing = 10;
    row.paddingTop = 10;
    row.paddingRight = 10;
    row.paddingBottom = 10;
    row.paddingLeft = 10;
    row.cornerRadius = 10;
    row.resize(226, row.height);
    setBg(row, index === 0 ? { r: 0.16, g: 0.2, b: 0.29 } : { r: 0.12, g: 0.15, b: 0.2 });

    const dot = figma.createEllipse();
    dot.resize(8, 8);
    dot.fills = [{ type: "SOLID", color: index === 0 ? C.brandBlue : { r: 0.46, g: 0.53, b: 0.64 } }];
    const label = createText(item, 12, "Semi Bold", C.textLight);
    row.appendChild(dot);
    row.appendChild(label);
    side.appendChild(row);
  });

  side.appendChild(createPill("API: Connected", { r: 0.1, g: 0.22, b: 0.18 }, { r: 0.75, g: 0.95, b: 0.84 }));
  return side;
}

function addCardContent(card, section, bodyWidth) {
  card.appendChild(createText(section.title || "Section", 16, "Semi Bold", C.textDark));
  if (section.body) {
    const body = createText(truncate(section.body, 220), 12, "Regular", C.textMid);
    body.resize(bodyWidth, body.height);
    card.appendChild(body);
  }
  if (Array.isArray(section.items) && section.items.length > 0) {
    section.items.slice(0, 4).forEach((item) => {
      const line = createText("- " + truncate(item, 90), 12, "Regular", C.textDark);
      line.resize(bodyWidth, line.height);
      card.appendChild(line);
    });
  }
  if (section.cta) {
    card.appendChild(createPill(truncate(section.cta, 28), C.brandBlue, { r: 1, g: 1, b: 1 }));
  }
}

function createHeroCard(section, width) {
  const card = figma.createFrame();
  card.layoutMode = "VERTICAL";
  card.primaryAxisSizingMode = "AUTO";
  card.counterAxisSizingMode = "FIXED";
  card.itemSpacing = 10;
  card.paddingTop = 18;
  card.paddingRight = 18;
  card.paddingBottom = 18;
  card.paddingLeft = 18;
  card.cornerRadius = 12;
  setBg(card, C.cardBg);
  card.strokes = [{ type: "SOLID", color: C.cardBorder }];
  card.strokeWeight = 1;
  card.resize(width, card.height);

  addCardContent(card, section, width - 36);
  return card;
}

function createStandardCard(section, width) {
  const card = figma.createFrame();
  card.layoutMode = "VERTICAL";
  card.primaryAxisSizingMode = "AUTO";
  card.counterAxisSizingMode = "FIXED";
  card.itemSpacing = 8;
  card.paddingTop = 14;
  card.paddingRight = 14;
  card.paddingBottom = 14;
  card.paddingLeft = 14;
  card.cornerRadius = 12;
  setBg(card, C.cardBg);
  card.strokes = [{ type: "SOLID", color: C.cardBorder }];
  card.strokeWeight = 1;
  card.resize(width, card.height);

  addCardContent(card, section, width - 28);
  return card;
}

function buildMainContent(main, sections, mainWidth) {
  const hero = sections.find((s) => s && s.type === "hero") || sections[0];
  const rest = sections.filter((s) => s && s !== hero);

  if (hero) {
    main.appendChild(createHeroCard(hero, mainWidth));
  }

  if (rest.length === 0) {
    main.appendChild(
      createStandardCard(
        {
          title: "No UI sections returned",
          body: "Try Response style: Detailed and keep prompt short and concrete.",
          items: ["Use module names", "Request a card grid", "Request clear status badges"],
          cta: "Generate again"
        },
        mainWidth
      )
    );
    return;
  }

  const gap = 14;
  const colWidth = Math.floor((mainWidth - gap) / 2);

  for (let i = 0; i < rest.length; i += 2) {
    const row = figma.createFrame();
    row.layoutMode = "HORIZONTAL";
    row.primaryAxisSizingMode = "FIXED";
    row.counterAxisSizingMode = "AUTO";
    row.itemSpacing = gap;
    emptyFrameFill(row);
    row.resize(mainWidth, row.height);

    const left = rest[i];
    const right = rest[i + 1];
    row.appendChild(createStandardCard(left, colWidth));
    if (right) {
      row.appendChild(createStandardCard(right, colWidth));
    }
    main.appendChild(row);
  }
}

async function createUiFromSpec(spec) {
  spec = spec || {};
  const totalWidth = Math.max(1240, Math.min(1600, Number(spec.width) || 1440));
  const root = figma.createFrame();
  root.name = spec.title || "Miljobeslut UI";
  root.layoutMode = "VERTICAL";
  root.primaryAxisSizingMode = "AUTO";
  root.counterAxisSizingMode = "FIXED";
  root.itemSpacing = 14;
  root.paddingTop = 14;
  root.paddingRight = 14;
  root.paddingBottom = 14;
  root.paddingLeft = 14;
  root.cornerRadius = 12;
  setBg(root, C.pageBg);
  root.resize(totalWidth, root.height);

  root.appendChild(createTopbar(spec.title || "Miljobeslut App", totalWidth - 28));

  const shell = figma.createFrame();
  shell.layoutMode = "HORIZONTAL";
  shell.primaryAxisSizingMode = "FIXED";
  shell.counterAxisSizingMode = "AUTO";
  shell.itemSpacing = 14;
  emptyFrameFill(shell);
  shell.resize(totalWidth - 28, shell.height);

  const sidebar = createSidebar(860);
  shell.appendChild(sidebar);

  const mainWidth = totalWidth - 28 - 250 - 14;
  const main = figma.createFrame();
  main.layoutMode = "VERTICAL";
  main.primaryAxisSizingMode = "AUTO";
  main.counterAxisSizingMode = "FIXED";
  main.itemSpacing = 14;
  setBg(main, C.shellBg);
  main.cornerRadius = 12;
  main.paddingTop = 14;
  main.paddingRight = 14;
  main.paddingBottom = 14;
  main.paddingLeft = 14;
  main.resize(mainWidth, main.height);

  const sections = Array.isArray(spec.sections) ? spec.sections.filter(Boolean) : [];
  buildMainContent(main, sections, mainWidth - 28);

  shell.appendChild(main);
  root.appendChild(shell);
  centerOnCanvas(root);
}

async function createResultFrame(prompt, aiText) {
  const frame = figma.createFrame();
  frame.name = "AI Result";
  frame.layoutMode = "VERTICAL";
  frame.counterAxisSizingMode = "AUTO";
  frame.primaryAxisSizingMode = "AUTO";
  frame.itemSpacing = 12;
  frame.paddingTop = 16;
  frame.paddingRight = 16;
  frame.paddingBottom = 16;
  frame.paddingLeft = 16;
  frame.cornerRadius = 12;
  setBg(frame, { r: 0.96, g: 0.97, b: 0.99 });

  const title = createText("Generated text answer", 18, "Bold", C.textDark);
  const body = createText("Prompt:\n" + prompt + "\n\nResult:\n" + aiText, 14, "Regular", C.textDark);
  body.resize(520, body.height);
  frame.appendChild(title);
  frame.appendChild(body);
  frame.resize(560, frame.height);
  centerOnCanvas(frame);
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === "cancel") {
    figma.closePlugin();
    return;
  }
  if (msg.type !== "generate") {
    return;
  }

  const prompt = (msg.prompt || "").trim();
  if (!prompt) {
    figma.notify("Skriv en prompt forst.");
    return;
  }

  try {
    await loadFonts();
    if (msg.mode === "ui") {
      await createUiFromSpec(msg.uiSpec || {});
      figma.notify("AI-byggt granssnitt skapat i canvas.");
    } else {
      const aiText = (msg.aiText || "").trim() || "[Mock AI] " + prompt;
      await createResultFrame(prompt, aiText);
      figma.notify("AI-resultat skapat i canvas.");
    }
  } catch (error) {
    figma.notify("Kunde inte skapa resultat i Figma.");
    console.error(error);
  }
};
