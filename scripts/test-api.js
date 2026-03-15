async function main() {
  try {
    const res = await fetch('http://localhost:8787/api/v1/projects');
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('FAILED:', e.message);
  }
}

main();
