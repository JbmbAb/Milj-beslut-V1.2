import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { prisma } from "../../server/db/prisma";

export async function loader({ params }: LoaderFunctionArgs) {
  const caseId = params.caseId || "unknown";
  const notes = await prisma.caseNote.findMany({
    where: { caseId },
    orderBy: { createdAt: "desc" },
    select: { id: true, text: true, author: true, createdAt: true },
  });
  return json(
    notes.map((n) => ({
      id: n.id,
      text: n.text,
      author: n.author,
      timestamp: n.createdAt.toISOString(),
    })),
  );
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

  const authHeader = request.headers.get("Authorization");
  const author = authHeader ? "Handläggare (Admin)" : "Gäst (Utan nyckel)";

  const newNote = await prisma.caseNote.create({
    data: { caseId, text, author },
  });

  return json({
    id: newNote.id,
    text: newNote.text,
    author: newNote.author,
    timestamp: newNote.createdAt.toISOString(),
  });
}
