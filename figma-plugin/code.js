figma.showUI(__html__, { width: 420, height: 520 });

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

  const title = figma.createText();
  const body = figma.createText();

  await figma.loadFontAsync({ family: "Inter", style: "Bold" });
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });

  title.fontName = { family: "Inter", style: "Bold" };
  title.fontSize = 18;
  title.characters = "Generated from prompt";

  body.fontName = { family: "Inter", style: "Regular" };
  body.fontSize = 14;
  body.characters = "Prompt:\n" + prompt + "\n\nResult:\n" + aiText;
  body.resize(480, body.height);

  frame.appendChild(title);
  frame.appendChild(body);
  frame.resize(520, frame.height);
  figma.currentPage.appendChild(frame);

  const vp = figma.viewport.center;
  frame.x = vp.x - frame.width / 2;
  frame.y = vp.y - frame.height / 2;
  figma.viewport.scrollAndZoomIntoView([frame]);
  figma.currentPage.selection = [frame];
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
    figma.notify("Skriv en prompt först.");
    return;
  }

  try {
    const aiText = (msg.aiText || "").trim() || "[Mock AI] " + prompt;
    await createResultFrame(prompt, aiText);
    figma.notify("AI-resultat skapad i canvas.");
  } catch (error) {
    figma.notify("Kunde inte skapa AI-resultat.");
    console.error(error);
  }
};
