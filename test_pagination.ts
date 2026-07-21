import fs from 'fs';

async function testParam(key: string, value: string | number) {
  const url = `https://rattspraxis.etjanst.domstol.se/api/v1/publiceringar?${key}=${value}`;
  const res = await fetch(url);
  if (!res.ok) return `${key}=${value} failed: ${res.status}`;
  const data = await res.json();
  const arr = data.value || data.content || data.items || data;
  if (!Array.isArray(arr)) return `${key}=${value} returned non-array`;
  if (arr.length === 0) return `${key}=${value} returned empty array`;
  const firstId = arr[0].id || arr[0].malNummerLista?.[0] || arr[0].referatNummerLista?.[0] || arr[0].sammanfattning?.substring(0,20);
  return `${key}=${value} returned ${arr.length} items. First item: ${firstId}`;
}

async function main() {
  const baseData = await fetch('https://rattspraxis.etjanst.domstol.se/api/v1/publiceringar').then(r=>r.json());
  const baseArr = baseData.value || baseData.content || baseData.items || baseData;
  const baseFirst = baseArr[0].id || baseArr[0].malNummerLista?.[0] || baseArr[0].referatNummerLista?.[0] || baseArr[0].sammanfattning?.substring(0,20);
  console.log(`Base: 10 items. First item: ${baseFirst}`);

  const paramsToTest = ['page', 'pageIndex', 'p', 'offset', 'start', 'skip', 'index', '$skip'];
  
  for (const param of paramsToTest) {
    const result = await testParam(param, 10); // test skipping 10 items or page 10
    console.log(result);
  }
  
  for (const param of ['page', 'pageIndex', 'p']) {
    const result = await testParam(param, 2); // test page 2
    console.log(result);
  }
  
  for (const param of ['limit', 'size', 'take', 'max', 'per_page', '$top']) {
    const result = await testParam(param, 20); // test increasing page size
    console.log(result);
  }
}

main().catch(console.error);
