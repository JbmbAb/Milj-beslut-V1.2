import { Client } from 'pg';

async function checkCount() {
  const c = new Client('postgres://miljobeslut:miljobeslut@localhost:5432/miljobeslut');
  await c.connect();
  
  try {
    const res1 = await c.query("SELECT count(*) FROM topo_topo10_hojd_sverige");
    console.log(`First count: ${res1.rows[0].count}`);
    
    console.log("Waiting 5 seconds...");
    await new Promise(r => setTimeout(r, 5000));
    
    const res2 = await c.query("SELECT count(*) FROM topo_topo10_hojd_sverige");
    console.log(`Second count: ${res2.rows[0].count}`);
    
    const diff = Number(res2.rows[0].count) - Number(res1.rows[0].count);
    console.log(`Rows added in 5 seconds: ${diff}`);
  } catch (err) {
    console.error("Error querying:", err);
  } finally {
    await c.end();
  }
}

checkCount();
