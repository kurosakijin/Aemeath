import {Pool} from '@neondatabase/serverless';
const connectionString=process.env.DATABASE_URL;
const pool=connectionString?new Pool({connectionString}):null;
let schemaPromise:Promise<void>|null=null;
async function ensureSchema(){
  if(!pool) throw new Error('Database is not configured');
  if(!schemaPromise) schemaPromise=pool.query(`
    CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,username TEXT NOT NULL,username_key TEXT NOT NULL UNIQUE,email TEXT NOT NULL,email_key TEXT NOT NULL UNIQUE,salt TEXT NOT NULL,password_hash TEXT NOT NULL,created BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_sessions(hash TEXT PRIMARY KEY,"user" TEXT NOT NULL REFERENCES accounts(id),expires BIGINT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions("user");
    CREATE TABLE IF NOT EXISTS auth_limits("key" TEXT PRIMARY KEY,hits INTEGER NOT NULL,expires BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,first TEXT NOT NULL REFERENCES accounts(id),second TEXT NOT NULL REFERENCES accounts(id),created BIGINT NOT NULL,updated BIGINT NOT NULL,pair TEXT NOT NULL UNIQUE);
    CREATE INDEX IF NOT EXISTS idx_conversations_first ON conversations(first);
    CREATE INDEX IF NOT EXISTS idx_conversations_second ON conversations(second);
    CREATE TABLE IF NOT EXISTS direct_messages(id TEXT PRIMARY KEY,conversation TEXT NOT NULL REFERENCES conversations(id),sender TEXT NOT NULL REFERENCES accounts(id),body TEXT NOT NULL,created BIGINT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_dm_conversation_created ON direct_messages(conversation,created);
    CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,conversation TEXT NOT NULL REFERENCES conversations(id),caller TEXT NOT NULL,callee TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,offer TEXT,answer TEXT,created BIGINT NOT NULL,updated BIGINT NOT NULL,caller_seen INTEGER NOT NULL,callee_seen INTEGER NOT NULL,reason TEXT);
    CREATE INDEX IF NOT EXISTS idx_calls_callee_status ON calls(callee,status);
    CREATE TABLE IF NOT EXISTS call_locks("user" TEXT PRIMARY KEY,"call" TEXT NOT NULL,expires BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY,name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS servers(id TEXT PRIMARY KEY,name TEXT NOT NULL,owner TEXT NOT NULL,created BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS members(server TEXT NOT NULL,"user" TEXT NOT NULL,joined BIGINT NOT NULL,PRIMARY KEY(server,"user"));
    CREATE TABLE IF NOT EXISTS channels(id TEXT PRIMARY KEY,server TEXT NOT NULL,name TEXT NOT NULL,created BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,channel TEXT NOT NULL,"user" TEXT NOT NULL,body TEXT NOT NULL,created BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS invites(code TEXT PRIMARY KEY,server TEXT NOT NULL,expires BIGINT NOT NULL);
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='members' AND column_name='user_id') THEN ALTER TABLE members RENAME COLUMN user_id TO "user"; END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='user_id') THEN ALTER TABLE messages RENAME COLUMN user_id TO "user"; END IF;
    END $$;
  `).then(()=>undefined);
  return schemaPromise;
}
function numbered(sql:string){let i=0;return sql.replace(/(?<!["'])\buser\b(?!["'])/gi,'"user"').replace(/\?/g,()=>`$${++i}`)}
class Statement{constructor(private sql:string,private args:unknown[]){ } async first<T=any>():Promise<T|null>{await ensureSchema();const r=await pool!.query(numbered(this.sql),this.args);return (r.rows[0] as T)||null} async all<T=any>():Promise<{results:T[]}>{await ensureSchema();const r=await pool!.query(numbered(this.sql),this.args);return {results:r.rows as T[]}} async run(){await ensureSchema();const r=await pool!.query(numbered(this.sql),this.args);return {success:true,meta:{changes:r.rowCount??0}}}}
class Database{prepare(sql:string){return {bind:(...args:unknown[])=>new Statement(sql,args)}} async batch(statements:Statement[]){return Promise.all(statements.map(s=>s.run()))}}
export function database(){return new Database()}

