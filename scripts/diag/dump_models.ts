import "dotenv/config";

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
  const data = await res.json();
  data.models.forEach(m => console.log(m.name));
}
main();
