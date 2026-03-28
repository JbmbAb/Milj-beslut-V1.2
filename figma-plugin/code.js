figma.showUI(__html__, { width: 420, height: 620 });

const C = {
  pageBg: { r: 0.09, g: 0.1, b: 0.12 },
  shellBg: { r: 0.94, g: 0.96, b: 0.99 },
  topbarBg: { r: 0.08, g: 0.1, b: 0.14 },
  sidebarBg: { r: 0.11, g: 0.13, b: 0.18 },
  cardBg: { r: 1, g: 1, b: 1 },
  cardBorder: { r: 0.84, g: 0.88, b: 0.95 },
  textDark: { r: 0.13, g: 0.16, b: 0.2 },
  textMid: { r: 0.34, g: 0.39, b: 0.48 },
  textLight: { r: 0.88, g: 0.92, b: 0.97 },
  brandBlue: { r: 0.02, g: 0.41, b: 1 },
  okGreen: { r: 0.14, g: 0.64, b: 0.31 },
  warnOrange: { r: 0.95, g: 0.61, b: 0.1 },
  riskRed: { r: 0.89, g: 0.25, b: 0.24 }
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
  pill.appendChild(createText(label, 11, "Semi Bold", fg));
  return pill;
}

function createCard(width) {
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
  return card;
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
  left.appendChild(createText(truncate(title || "Platform for environment and construction", 78), 12, "Regular", { r: 0.67, g: 0.75, b: 0.9 }));

  const right = figma.createFrame();
  right.layoutMode = "HORIZONTAL";
  right.primaryAxisSizingMode = "AUTO";
  right.counterAxisSizingMode = "AUTO";
  right.itemSpacing = 8;
  emptyFrameFill(right);
  right.appendChild(createPill("Verified flow", { r: 0.13, g: 0.24, b: 0.17 }, { r: 0.76, g: 0.95, b: 0.81 }));
  right.appendChild(createPill("Human in the loop", { r: 0.14, g: 0.18, b: 0.24 }, { r: 0.8, g: 0.87, b: 0.99 }));
  right.appendChild(createPill("Draft controls", { r: 0.25, g: 0.22, b: 0.11 }, { r: 0.98, g: 0.86, b: 0.53 }));

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

  ["Ansokningsportal", "Logistik Schaktmassor", "Projektledning", "Gronkoll for banker"].forEach((item, index) => {
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
    row.appendChild(dot);
    row.appendChild(createText(item, 12, "Semi Bold", C.textLight));
    side.appendChild(row);
  });

  side.appendChild(createPill("API: Connected", { r: 0.1, g: 0.22, b: 0.18 }, { r: 0.75, g: 0.95, b: 0.84 }));
  return side;
}

function createHero(section, width) {
  const hero = createCard(width);
  hero.itemSpacing = 10;
  hero.appendChild(createText(section.title || "Miljobeslut.se", 20, "Bold", C.textDark));
  if (section.body) {
    const body = createText(truncate(section.body, 180), 13, "Regular", C.textMid);
    body.resize(width - 28, body.height);
    hero.appendChild(body);
  }

  const row = figma.createFrame();
  row.layoutMode = "HORIZONTAL";
  row.primaryAxisSizingMode = "AUTO";
  row.counterAxisSizingMode = "AUTO";
  row.itemSpacing = 8;
  emptyFrameFill(row);
  row.appendChild(createPill("UTKAST", { r: 0.98, g: 0.93, b: 0.77 }, { r: 0.59, g: 0.39, b: 0.02 }));
  row.appendChild(createPill("Verifiering kravs", { r: 0.95, g: 0.97, b: 1 }, { r: 0.18, g: 0.36, b: 0.75 }));
  row.appendChild(createPill("Spårbar", { r: 0.88, g: 0.97, b: 0.91 }, { r: 0.11, g: 0.45, b: 0.24 }));
  hero.appendChild(row);
  return hero;
}

function createMetricCard(width, title, value, tone) {
  const card = createCard(width);
  card.itemSpacing = 6;
  card.appendChild(createText(title, 12, "Semi Bold", C.textMid));
  card.appendChild(createText(value, 24, "Bold", C.textDark));
  card.appendChild(createPill(tone.label, tone.bg, tone.fg));
  return card;
}

function createMetricsRow(width) {
  const row = figma.createFrame();
  row.layoutMode = "HORIZONTAL";
  row.primaryAxisSizingMode = "FIXED";
  row.counterAxisSizingMode = "AUTO";
  row.itemSpacing = 10;
  emptyFrameFill(row);
  row.resize(width, row.height);

  const cardWidth = Math.floor((width - 30) / 4);
  row.appendChild(createMetricCard(cardWidth, "Compliance score", "85%", { label: "Needs review", bg: { r: 1, g: 0.94, b: 0.86 }, fg: { r: 0.55, g: 0.32, b: 0.02 } }));
  row.appendChild(createMetricCard(cardWidth, "Ongoing cases", "3", { label: "Active", bg: { r: 0.9, g: 0.95, b: 1 }, fg: { r: 0.08, g: 0.34, b: 0.82 } }));
  row.appendChild(createMetricCard(cardWidth, "Critical warnings", "1", { label: "Blocked", bg: { r: 1, g: 0.9, b: 0.9 }, fg: { r: 0.62, g: 0.15, b: 0.15 } }));
  row.appendChild(createMetricCard(cardWidth, "Latest signatures", "2", { label: "Verified", bg: { r: 0.89, g: 0.98, b: 0.91 }, fg: { r: 0.08, g: 0.44, b: 0.22 } }));
  return row;
}

function createProgressBar(width, progress) {
  const bar = figma.createFrame();
  bar.layoutMode = "HORIZONTAL";
  bar.primaryAxisSizingMode = "FIXED";
  bar.counterAxisSizingMode = "FIXED";
  bar.cornerRadius = 999;
  setBg(bar, { r: 0.9, g: 0.93, b: 0.97 });
  bar.resize(width, 10);

  const fill = figma.createFrame();
  fill.layoutMode = "HORIZONTAL";
  fill.primaryAxisSizingMode = "FIXED";
  fill.counterAxisSizingMode = "FIXED";
  fill.cornerRadius = 999;
  setBg(fill, C.brandBlue);
  fill.resize(Math.max(8, Math.floor(width * progress)), 10);
  bar.appendChild(fill);
  return bar;
}

function createStageGatePanel(width) {
  const panel = createCard(width);
  panel.itemSpacing = 10;
  panel.appendChild(createText("Next steps (Stage-Gate)", 16, "Bold", C.textDark));
  panel.appendChild(createText("Locked transitions require sign-off and source check.", 12, "Regular", C.textMid));

  const gates = [
    { name: "Provtagning", pill: createPill("Verified", { r: 0.89, g: 0.98, b: 0.91 }, { r: 0.08, g: 0.44, b: 0.22 }) },
    { name: "Materialflode", pill: createPill("Ongoing", { r: 0.9, g: 0.95, b: 1 }, { r: 0.08, g: 0.34, b: 0.82 }) },
    { name: "Tillstand", pill: createPill("Blocked", { r: 1, g: 0.9, b: 0.9 }, { r: 0.62, g: 0.15, b: 0.15 }) },
    { name: "Uppfoljning", pill: createPill("Todo", { r: 0.94, g: 0.95, b: 0.97 }, { r: 0.32, g: 0.37, b: 0.46 }) }
  ];

  gates.forEach((g) => {
    const row = figma.createFrame();
    row.layoutMode = "HORIZONTAL";
    row.primaryAxisSizingMode = "FIXED";
    row.counterAxisSizingMode = "AUTO";
    row.primaryAxisAlignItems = "SPACE_BETWEEN";
    row.counterAxisAlignItems = "CENTER";
    emptyFrameFill(row);
    row.resize(width - 28, row.height);
    row.appendChild(createText(g.name, 12, "Semi Bold", C.textDark));
    row.appendChild(g.pill);
    panel.appendChild(row);
  });

  panel.appendChild(createProgressBar(width - 28, 0.58));
  return panel;
}

function createMapPanel(width) {
  const panel = createCard(width);
  panel.itemSpacing = 10;
  panel.appendChild(createText("Logistics map", 16, "Bold", C.textDark));
  panel.appendChild(createText("Route + CO2 estimate + approved receiver", 12, "Regular", C.textMid));

  const map = figma.createFrame();
  map.layoutMode = "VERTICAL";
  map.primaryAxisSizingMode = "FIXED";
  map.counterAxisSizingMode = "FIXED";
  map.cornerRadius = 10;
  setBg(map, { r: 0.87, g: 0.92, b: 0.98 });
  map.resize(width - 28, 170);

  for (let i = 0; i < 5; i += 1) {
    const line = figma.createLine();
    line.strokes = [{ type: "SOLID", color: { r: 0.78, g: 0.84, b: 0.93 } }];
    line.strokeWeight = 1;
    line.resize(width - 48, 0);
    line.x = 10;
    line.y = 20 + i * 30;
    map.appendChild(line);
  }

  const route = figma.createLine();
  route.strokes = [{ type: "SOLID", color: C.brandBlue }];
  route.strokeWeight = 3;
  route.resize(width - 90, 0);
  route.x = 18;
  route.y = 120;
  map.appendChild(route);

  const pinA = figma.createEllipse();
  pinA.resize(12, 12);
  pinA.fills = [{ type: "SOLID", color: C.okGreen }];
  pinA.x = 16;
  pinA.y = 114;
  map.appendChild(pinA);

  const pinB = figma.createEllipse();
  pinB.resize(12, 12);
  pinB.fills = [{ type: "SOLID", color: C.riskRed }];
  pinB.x = width - 62;
  pinB.y = 114;
  map.appendChild(pinB);

  panel.appendChild(map);
  panel.appendChild(createPill("Route 25 km | CO2 1.2t", { r: 0.9, g: 0.95, b: 1 }, { r: 0.08, g: 0.34, b: 0.82 }));
  return panel;
}

function createTablePanel(width) {
  const panel = createCard(width);
  panel.itemSpacing = 8;
  panel.appendChild(createText("Latest projects", 16, "Bold", C.textDark));

  const header = figma.createFrame();
  header.layoutMode = "HORIZONTAL";
  header.primaryAxisSizingMode = "FIXED";
  header.counterAxisSizingMode = "AUTO";
  header.primaryAxisAlignItems = "SPACE_BETWEEN";
  emptyFrameFill(header);
  header.resize(width - 28, header.height);
  header.appendChild(createText("Project", 11, "Semi Bold", C.textMid));
  header.appendChild(createText("Risk", 11, "Semi Bold", C.textMid));
  panel.appendChild(header);

  const rows = [
    { name: "Project A", risk: "High" },
    { name: "Project B", risk: "Low" },
    { name: "Project C", risk: "Medium" },
    { name: "Project D", risk: "Low" }
  ];

  rows.forEach((r) => {
    const row = figma.createFrame();
    row.layoutMode = "HORIZONTAL";
    row.primaryAxisSizingMode = "FIXED";
    row.counterAxisSizingMode = "AUTO";
    row.primaryAxisAlignItems = "SPACE_BETWEEN";
    row.counterAxisAlignItems = "CENTER";
    row.paddingTop = 8;
    row.paddingRight = 10;
    row.paddingBottom = 8;
    row.paddingLeft = 10;
    row.cornerRadius = 8;
    setBg(row, { r: 0.98, g: 0.99, b: 1 });
    row.resize(width - 28, row.height);

    const riskPill =
      r.risk === "High"
        ? createPill("High", { r: 1, g: 0.9, b: 0.9 }, { r: 0.62, g: 0.15, b: 0.15 })
        : r.risk === "Medium"
        ? createPill("Medium", { r: 1, g: 0.95, b: 0.86 }, { r: 0.55, g: 0.32, b: 0.02 })
        : createPill("Low", { r: 0.89, g: 0.98, b: 0.91 }, { r: 0.08, g: 0.44, b: 0.22 });

    row.appendChild(createText(r.name, 12, "Semi Bold", C.textDark));
    row.appendChild(riskPill);
    panel.appendChild(row);
  });

  return panel;
}

function createExtraCardsRow(width, sections) {
  if (!Array.isArray(sections) || sections.length === 0) return null;
  const remaining = sections.slice(0, 2);
  if (remaining.length === 0) return null;

  const row = figma.createFrame();
  row.layoutMode = "HORIZONTAL";
  row.primaryAxisSizingMode = "FIXED";
  row.counterAxisSizingMode = "AUTO";
  row.itemSpacing = 10;
  emptyFrameFill(row);
  row.resize(width, row.height);

  const colWidth = Math.floor((width - 10) / 2);
  remaining.forEach((section) => {
    const card = createCard(colWidth);
    card.appendChild(createText(section.title || "Section", 14, "Bold", C.textDark));
    if (section.body) {
      const body = createText(truncate(section.body, 120), 12, "Regular", C.textMid);
      body.resize(colWidth - 28, body.height);
      card.appendChild(body);
    }
    if (Array.isArray(section.items)) {
      section.items.slice(0, 3).forEach((item) => {
        const line = createText("- " + truncate(item, 60), 11, "Regular", C.textDark);
        line.resize(colWidth - 28, line.height);
        card.appendChild(line);
      });
    }
    row.appendChild(card);
  });

  return row;
}

async function createUiFromSpec(spec) {
  spec = spec || {};
  const totalWidth = Math.max(1320, Math.min(1680, Number(spec.width) || 1440));
  const margin = 14;
  const gap = 14;
  const sidebarWidth = 250;
  const topbarWidth = totalWidth - margin * 2;
  const mainWidth = totalWidth - margin * 2 - sidebarWidth - gap;

  const vp = figma.viewport.center;
  const originX = Math.floor(vp.x - totalWidth / 2);
  const originY = Math.floor(vp.y - 520);

  const createdNodes = [];
  const placeNode = (node, name, x, y) => {
    node.name = name;
    figma.currentPage.appendChild(node);
    node.x = x;
    node.y = y;
    createdNodes.push(node);
  };

  const backdrop = figma.createFrame();
  backdrop.resize(totalWidth, 1060);
  backdrop.cornerRadius = 12;
  setBg(backdrop, C.pageBg);
  placeNode(backdrop, spec.title || "Miljobeslut UI", originX, originY);

  const topbar = createTopbar(spec.title || "Miljobeslut App", topbarWidth);
  placeNode(topbar, "Topbar", originX + margin, originY + margin);

  const mainStartY = originY + margin + topbar.height + gap;
  const sidebar = createSidebar(900);
  placeNode(sidebar, "Sidebar", originX + margin, mainStartY);

  const mainX = originX + margin + sidebarWidth + gap;
  let mainY = mainStartY;

  const sections = Array.isArray(spec.sections) ? spec.sections.filter(Boolean) : [];
  const heroSection = sections.find((s) => s && s.type === "hero") || { title: spec.title || "Miljobeslut.se", body: "Design generated from AI spec." };

  const hero = createHero(heroSection, mainWidth);
  placeNode(hero, "Hero", mainX, mainY);
  mainY += hero.height + 12;

  const metrics = createMetricsRow(mainWidth);
  placeNode(metrics, "Metrics", mainX, mainY);
  mainY += metrics.height + 12;

  const leftWidth = Math.floor(mainWidth * 0.62);
  const rightWidth = mainWidth - leftWidth - 10;
  const stage = createStageGatePanel(leftWidth);
  const map = createMapPanel(rightWidth);
  placeNode(stage, "Stage-Gate", mainX, mainY);
  placeNode(map, "Logistics Map", mainX + leftWidth + 10, mainY);
  mainY += Math.max(stage.height, map.height) + 12;

  const table = createTablePanel(mainWidth);
  placeNode(table, "Latest Projects", mainX, mainY);
  mainY += table.height + 12;

  const extraRow = createExtraCardsRow(mainWidth, sections.filter((s) => s !== heroSection));
  if (extraRow) {
    placeNode(extraRow, "Extra Cards", mainX, mainY);
    mainY += extraRow.height + 12;
  }

  const contentHeight = Math.max(820, mainY - mainStartY);
  sidebar.resize(sidebarWidth, contentHeight);
  backdrop.resize(totalWidth, Math.max(1060, mainY - originY + margin));

  figma.viewport.scrollAndZoomIntoView(createdNodes);
  figma.currentPage.selection = createdNodes;
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
