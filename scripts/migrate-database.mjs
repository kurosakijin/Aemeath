import {readFile} from "node:fs/promises";
import {Pool} from "pg";

const connectionString=process.env.DATABASE_URL;
if(!connectionString)throw new Error("Set DATABASE_URL to the target Supabase pooled connection string.");
const pool=new Pool({connectionString,max:1,connectionTimeoutMillis:15000,allowExitOnIdle:true});
try{
  const sql=await readFile(new URL("../db/schema.sql",import.meta.url),"utf8");
  await pool.query(sql);
  console.log("Database schema is ready.");
}finally{
  await pool.end();
}
