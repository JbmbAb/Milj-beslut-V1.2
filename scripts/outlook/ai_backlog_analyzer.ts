import fs from 'node:fs';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');
import dotenv from 'dotenv';

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
// Using the model name that was confirmed to work via curl
const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

// Helper for delay to avoid rate limits
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

interface TriageRow {
    EntryID: string;
    OperationalBucket: string;
    SenderEmail: string;
    Subject: string;
    ResolvedMunicipality: string;
    HasAttachments: string;
    OperationalReason: string;
    DraftResponse: string;
}

interface ManifestRow {
    message_id: string;
    stored_path: string;
    filename: string;
    body_preview: string;
}

function parseSemicolonCSV(content: string): any[] {
    if (!content) return [];
    const lines = content.split(/\r?\n/).filter(l => l.trim());
    if (lines.length === 0) return [];

    let headerLine = lines[0];
    if (headerLine.charCodeAt(0) === 0xFEFF) headerLine = headerLine.slice(1);

    const parseLine = (line: string) => {
        const result = [];
        let current = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const next = line[i + 1];
            if (char === '"') {
                if (inQuotes && next === '"') { // escaped quote
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ';' && !inQuotes) {
                result.push(current);
                current = "";
            } else {
                current += char;
            }
        }
        result.push(current);
        return result;
    };

    const headers = parseLine(headerLine).map(h => h.trim());
    return lines.slice(1).map(line => {
        const values = parseLine(line);
        const obj: any = {};
        headers.forEach((h, i) => { if (h) obj[h] = values[i] || ""; });
        return obj;
    });
}

function toSemicolonCSV(rows: any[]): string {
    if (rows.length === 0) return "";
    const headers = Object.keys(rows[0]);
    const headerLine = headers.map(h => `"${h}"`).join(';');
    const dataLines = rows.map(row =>
        headers.map(h => `"${String(row[h] || '').replace(/"/g, '""')}"`).join(';')
    );
    return [headerLine, ...dataLines].join('\n');
}

async function extractPdfText(filePath: string): Promise<string> {
    if (!fs.existsSync(filePath) || !filePath.toLowerCase().endsWith('.pdf')) return "";
    try {
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdf(dataBuffer);
        return data.text.slice(0, 5000); // Limit context
    } catch {
        return "";
    }
}

async function analyzeWithAI(context: string): Promise<{ bucket: string, draft: string, reasoning: string }> {
    if (!GEMINI_API_KEY) {
        return { bucket: "ERROR", draft: "", reasoning: "Missing API Key" };
    }

    const prompt = `You are an automated environmental permit coordinator. Your task is to analyze a backlog item and decide if it's junk or relevant material, and then generate a high-quality human-like reply in Swedish.

CONTEXT:
${context}

TASK:
1. Re-classify into one of these EXACT buckets: P1-Akut, P2-Handlaggardialog, P3-MaterialMottaget, P4-HanvisningEllerIngaArenden, P5-Avvikande.
2. Write a professional 1-2 sentence response in Swedish. If it's a handläggare, be polite and helpful. If it's a "no cases" response, thank them and acknowledge.
3. Provide reasoning in English.

OUTPUT VALID JSON ONLY:
{
  "bucket": "P1-P5",
  "draft": "Swedish text here",
  "reasoning": "Why you chose this"
}`;

    try {
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        return { bucket: "Unknown", draft: "", reasoning: "Failed to parse JSON" };
    } catch (e: any) {
        console.error("AI API ERROR:", e?.message || String(e));
        return { bucket: "ERROR", draft: "", reasoning: String(e?.message || e) };
    }
}

async function main() {
    const triagePath = 'C:\\Users\\jimmy\\Desktop\\OutlookExport\\outlook_backlog_operativ_sortering.csv';
    const manifestPath = 'C:\\Users\\jimmy\\Desktop\\OutlookExport\\manifest.csv';
    const outputPath = 'C:\\Users\\jimmy\\Desktop\\OutlookExport\\outlook_backlog_ai_deep_analysis.csv';

    if (!fs.existsSync(triagePath)) {
        console.error("Triage file not found:", triagePath);
        return;
    }

    console.log("Loading files...");
    const triageRows = parseSemicolonCSV(fs.readFileSync(triagePath, 'utf8')) as TriageRow[];
    const manifestRows = fs.existsSync(manifestPath)
        ? parseSemicolonCSV(fs.readFileSync(manifestPath, 'utf8')) as ManifestRow[]
        : [];

    const manifestMap = new Map<string, ManifestRow[]>();
    manifestRows.forEach(m => {
        const existing = manifestMap.get(m.message_id) || [];
        existing.push(m);
        manifestMap.set(m.message_id, existing);
    });

    const targetRows = triageRows.filter(r => {
        const b = (r.OperationalBucket || "").toUpperCase();
        return b.startsWith('P5') || b.startsWith('P2') || b === 'ERROR';
    });

    console.log(`Analyzing ${targetRows.length} rows with Gemini (gemini-flash-latest)...`);

    const processedRows = [];
    let count = 0;

    for (const row of targetRows) {
        count++;
        if (count % 20 === 0) console.log(`Processed ${count}/${targetRows.length}...`);

        const attachments = manifestMap.get(row.EntryID) || [];
        let ocrText = "";

        for (const attach of attachments) {
            ocrText += `\n[ATTACHMENT: ${attach.filename}]\n` + await extractPdfText(attach.stored_path);
        }

        const bodyPreview = attachments.length > 0 ? attachments[0].body_preview : "";

        const context = `
SENDER: ${row.SenderEmail}
SUBJECT: ${row.Subject}
MUNICIPALITY: ${row.ResolvedMunicipality}
BODY PREVIEW: ${bodyPreview}
OCR TEXT FROM ATTACHMENTS: ${ocrText.slice(0, 3000)}
        `;

        const aiResult = await analyzeWithAI(context);

        processedRows.push({
            ...row,
            AiBucket: aiResult.bucket,
            AiDraft: aiResult.draft,
            AiReasoning: aiResult.reasoning
        });

        // Small delay to avoid rate limits
        await delay(200);
    }

    console.log(`Writing results to ${outputPath}...`);
    fs.writeFileSync(outputPath, '\ufeff' + toSemicolonCSV(processedRows), 'utf8');
    console.log("Done!");
}

main().catch(console.error);
