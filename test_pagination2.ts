import fs from 'fs';

async function testParam(key: string, value: string | number) {
  const url = `https://rattspraxis.etjanst.domstol.se/api/v1/publiceringar?page=1&${key}=${value}`;
  const res = await fetch(url);
  if (!res.ok) return `${key}=${value} failed: ${res.status}`;
  const data = await res.json();
  const arr = data.value || data.content || data.items || data;
  return `${key}=${value} returned ${arr?.length} items.`;
}

async function main() {
  const paramsToTest = ['pageSize', 'itemsPerPage', 'antal', 'antalPerSida', 'count', 'maxItems', 'limit'];
  
  for (const param of paramsToTest) {
    const result = await testParam(param, 100);
    console.log(result);
  }
}

main().catch(console.error);
