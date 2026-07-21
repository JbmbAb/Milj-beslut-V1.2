import { Client } from 'pg';
const c = new Client('postgres://postgres:postgres@localhost:5432/miljobeslut');
c.connect()
  .then(() => c.query("SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'geo_komplett_%'"))
  .then(r => { console.log(r.rows); c.end() })
  .catch(e => { console.error(e); c.end() });
