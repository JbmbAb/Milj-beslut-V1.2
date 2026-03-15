import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";

// In-memory "databas" för att API:et ska svara på riktigt under sessionen.
// I produktion: Byt ut mot `await prisma.note.findMany(...)`
const NOTES_STORE: Record<string, Array<{ id: string; text: string; author: string; timestamp: string }>> = {};

console.log("✅ BTFA.Anteckning API redo (Körs i minnet - inga nycklar krävs)");

export async function loader({ params }: LoaderFunctionArgs) {
  const caseId = params.caseId || "unknown";
  const notes = NOTES_STORE[caseId] || [];
  return json(notes);
}

export async function action({ request, params }: ActionFunctionArgs) {
  const caseId = params.caseId || "unknown";

  if (request.method !== "POST") {
    return json({ message: "Method not allowed" }, { status: 405 });
  }

  const body = await request.json();
  const text = body.text;

  if (!text) {
    return json({ message: "Text is required" }, { status: 400 });
  }

  // Identifiera användare baserat på om nyckel skickades eller ej
  const authHeader = request.headers.get("Authorization");
  const authorName = authHeader ? "Handläggare (Admin)" : "Gäst (Utan nyckel)";

  const newNote = {
    id: Date.now().toString(),
    text,
    author: authorName,
    timestamp: new Date().toISOString(),
  };

  if (!NOTES_STORE[caseId]) NOTES_STORE[caseId] = [];
  NOTES_STORE[caseId].unshift(newNote);

  return json(newNote);
}
