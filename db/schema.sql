CREATE TABLE IF NOT EXISTS app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,username TEXT NOT NULL,username_key TEXT NOT NULL UNIQUE,email TEXT NOT NULL,email_key TEXT NOT NULL UNIQUE,salt TEXT NOT NULL,password_hash TEXT NOT NULL,created BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_sessions(hash TEXT PRIMARY KEY,"user" TEXT NOT NULL REFERENCES accounts(id),expires BIGINT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions("user");
    CREATE TABLE IF NOT EXISTS auth_limits("key" TEXT PRIMARY KEY,hits INTEGER NOT NULL,expires BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_challenges(id TEXT PRIMARY KEY,purpose TEXT NOT NULL,email TEXT NOT NULL,account_id TEXT,payload TEXT NOT NULL,code_hash TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,expires BIGINT NOT NULL,created BIGINT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_auth_challenges_email ON auth_challenges(email,purpose);
    CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,first TEXT NOT NULL REFERENCES accounts(id),second TEXT NOT NULL REFERENCES accounts(id),created BIGINT NOT NULL,updated BIGINT NOT NULL,pair TEXT NOT NULL UNIQUE);
    CREATE INDEX IF NOT EXISTS idx_conversations_first ON conversations(first);
    CREATE INDEX IF NOT EXISTS idx_conversations_second ON conversations(second);
    CREATE TABLE IF NOT EXISTS direct_messages(id TEXT PRIMARY KEY,conversation TEXT NOT NULL REFERENCES conversations(id),sender TEXT NOT NULL REFERENCES accounts(id),body TEXT NOT NULL,created BIGINT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_dm_conversation_created ON direct_messages(conversation,created);
    CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,conversation TEXT NOT NULL REFERENCES conversations(id),caller TEXT NOT NULL,callee TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,offer TEXT,answer TEXT,created BIGINT NOT NULL,updated BIGINT NOT NULL,caller_seen INTEGER NOT NULL,callee_seen INTEGER NOT NULL,reason TEXT);
    ALTER TABLE calls ALTER COLUMN caller_seen TYPE BIGINT;
    ALTER TABLE calls ALTER COLUMN callee_seen TYPE BIGINT;
    CREATE INDEX IF NOT EXISTS idx_calls_callee_status ON calls(callee,status);
    CREATE TABLE IF NOT EXISTS call_locks("user" TEXT PRIMARY KEY,"call" TEXT NOT NULL,expires BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY,name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS servers(id TEXT PRIMARY KEY,name TEXT NOT NULL,owner TEXT NOT NULL,created BIGINT NOT NULL);
    ALTER TABLE servers ADD COLUMN IF NOT EXISTS icon TEXT NOT NULL DEFAULT '';
    ALTER TABLE servers ADD COLUMN IF NOT EXISTS banner TEXT NOT NULL DEFAULT '#ff5ca8';
    ALTER TABLE servers ADD COLUMN IF NOT EXISTS traits TEXT NOT NULL DEFAULT '';
    ALTER TABLE servers ADD COLUMN IF NOT EXISTS access TEXT NOT NULL DEFAULT 'invite';
    CREATE TABLE IF NOT EXISTS members(server TEXT NOT NULL,"user" TEXT NOT NULL,joined BIGINT NOT NULL,PRIMARY KEY(server,"user"));
    ALTER TABLE members ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member';
    CREATE TABLE IF NOT EXISTS channels(id TEXT PRIMARY KEY,server TEXT NOT NULL,name TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'text',created BIGINT NOT NULL);
    ALTER TABLE channels ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'text';
    ALTER TABLE channels ADD COLUMN IF NOT EXISTS topic TEXT NOT NULL DEFAULT '';
    CREATE TABLE IF NOT EXISTS voice_presence(channel TEXT NOT NULL,"user" TEXT NOT NULL REFERENCES accounts(id),joined BIGINT NOT NULL,updated BIGINT NOT NULL,PRIMARY KEY(channel,"user"));
    ALTER TABLE voice_presence ADD COLUMN IF NOT EXISTS "left" BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE voice_presence ADD COLUMN IF NOT EXISTS session TEXT NOT NULL DEFAULT '';
    CREATE TABLE IF NOT EXISTS voice_signals(id TEXT PRIMARY KEY,channel TEXT NOT NULL,"from" TEXT NOT NULL,"to" TEXT NOT NULL,body TEXT NOT NULL,created BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS voice_invites(id TEXT PRIMARY KEY,server TEXT NOT NULL,channel TEXT NOT NULL,"from" TEXT NOT NULL,"to" TEXT NOT NULL,created BIGINT NOT NULL,expires BIGINT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_voice_invites_to ON voice_invites("to",expires);
    DROP TABLE IF EXISTS voice_history;
    CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,channel TEXT NOT NULL,"user" TEXT NOT NULL,body TEXT NOT NULL,created BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS message_reactions(message TEXT NOT NULL,"user" TEXT NOT NULL,emoji TEXT NOT NULL,created BIGINT NOT NULL,PRIMARY KEY(message,"user",emoji));
    CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions(message);
    CREATE TABLE IF NOT EXISTS invites(code TEXT PRIMARY KEY,server TEXT NOT NULL,expires BIGINT NOT NULL);
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='members' AND column_name='user_id') THEN ALTER TABLE members RENAME COLUMN user_id TO "user"; END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='user_id') THEN ALTER TABLE messages RENAME COLUMN user_id TO "user"; END IF;
    END $$;
  `,
      );
      await dbPool.query("INSERT INTO app_meta(key,value) VALUES('schema_version',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",[schemaVersion]);
    })();
  return schemaPromise;
}
function numbered(sql: string) {
  let i = 0;
  return sql
    .replace(/(?<!["'])\buser\b(?!["'])/gi, '"user"')
    .replace(/\?/g, () => `$${++i}
INSERT INTO app_meta(key,value) VALUES('schema_version','1') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value;
