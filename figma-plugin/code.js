figma.showUI(__html__, { width: 420, height: 620 });

async function loadFonts() {
  await figma.loadFontAsync({ family: "Inter", style: "Bold" });
  await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });
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

function createText(chars, size, weight) {
  const t = figma.createText();
  t.fontName = { family: "Inter", style: weight };
  t.fontSize = size;
  t.characters = chars;
  t.fills = [{ type: "SOLID", color: { r: 0.12, g: 0.14, b: 0.18 } }];
  return t;
}

function addCardSection(parent, section) {
  const card = figma.createFrame();
  card.layoutMode = "VERTICAL";
  card.counterAxisSizingMode = "AUTO";
  card.primaryAxisSizingMode = "AUTO";
  card.itemSpacing = 8;
  card.paddingTop = 14;
  card.paddingRight = 14;
  card.paddingBottom = 14;
  card.paddingLeft = 14;
  card.cornerRadius = 10;
  card.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  card.strokes = [{ type: "SOLID", color: { r: 0.86, g: 0.89, b: 0.95 } }];
  card.strokeWeight = 1;

  const title = createText(section.title || "Section", 16, "Semi Bold");
  card.appendChild(title);
  if (section.body) {
    const body = createText(section.body, 13, "Regular");
    body.resize(560, body.height);
    card.appendChild(body);
  }
  if (Array.isArray(section.items) && section.items.length > 0) {
    section.items.slice(0, 6).forEach((item) => {
      card.appendChild(createText("• " + item, 13, "Regular"));
    });
  }
  if (section.cta) {
    const btn = figma.createFrame();
    btn.layoutMode = "HORIZONTAL";
    btn.counterAxisSizingMode = "AUTO";
    btn.primaryAxisSizingMode = "AUTO";
    btn.paddingTop = 8;
    btn.paddingRight = 12;
    btn.paddingBottom = 8;
    btn.paddingLeft = 12;
    btn.cornerRadius = 8;
    btn.fills = [{ type: "SOLID", color: { r: 0.02, g: 0.41, b: 1 } }];
    const btnText = createText(section.cta, 12, "Semi Bold");
    btnText.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    btn.appendChild(btnText);
    card.appendChild(btn);
  }

  parent.appendChild(card);
}

async function createUiFromSpec(prompt, spec) {
  const page = figma.createFrame();
  page.name = spec && spec.title ? spec.title : "AI UI";
  page.layoutMode = "VERTICAL";
  page.counterAxisSizingMode = "AUTO";
  page.primaryAxisSizingMode = "AUTO";
  page.itemSpacing = 16;
  page.paddingTop = 24;
  page.paddingRight = 24;
  page.paddingBottom = 24;
  page.paddingLeft = 24;
  page.cornerRadius = 14;
  page.fills = [{ type: "SOLID", color: { r: 0.95, g: 0.97, b: 1 } }];
  page.resize(typeof spec?.width === "number" ? spec.width : 1200, page.height);

  page.appendChild(createText(spec?.title || "Miljobeslut UI", 24, "Bold"));
  page.appendChild(createText("Prompt: " + prompt, 12, "Regular"));

  const sections = Array.isArray(spec?.sections) ? spec.sections : [];
  sections.forEach((section) => addCardSection(page, section));
  if (sections.length === 0) {
    addCardSection(page, {
      title: "UI generation",
      body: "No valid sections in AI response. Add more context and retry."
    });
  }

  centerOnCanvas(page);
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
  frame.fills = [{ type: "SOLID", color: { r: 0.96, g: 0.97, b: 0.99 } }];

  const title = createText("Generated from prompt", 18, "Bold");
  const body = createText("Prompt:\n" + prompt + "\n\nResult:\n" + aiText, 14, "Regular");
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
      await createUiFromSpec(prompt, msg.uiSpec || {});
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
