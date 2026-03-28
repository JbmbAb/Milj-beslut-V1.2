import "dotenv/config";

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
  const data = await res.json();
  const models = data.models.map(m => m.name);
  console.log('Available models:', models.filter(m => m.includes('flash')));
}
main();
