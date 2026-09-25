import {sqliteTable,text,integer,index,primaryKey} from 'drizzle-orm/sqlite-core';
export const profiles=sqliteTable('profiles',{id:text('id').primaryKey(),name:text('name').notNull()});
export const servers=sqliteTable('servers',{id:text('id').primaryKey(),name:text('name').notNull(),owner:text('owner').notNull(),created:integer('created').notNull()});
export const members=sqliteTable('members',{server:text('server').notNull().references(()=>servers.id),user:text('user').notNull(),joined:integer('joined').notNull()},t=>[primaryKey({columns:[t.server,t.user]}),index('idx_members_user').on(t.user)]);
export const channels=sqliteTable('channels',{id:text('id').primaryKey(),server:text('server').notNull().references(()=>servers.id),name:text('name').notNull(),created:integer('created').notNull()},t=>[index('idx_channels_server').on(t.server)]);
export const messages=sqliteTable('messages',{id:text('id').primaryKey(),channel:text('channel').notNull().references(()=>channels.id),user:text('user').notNull(),body:text('body').notNull(),created:integer('created').notNull()},t=>[index('idx_messages_channel_created').on(t.channel,t.created)]);
export const invites=sqliteTable('invites',{code:text('code').primaryKey(),server:text('server').notNull().references(()=>servers.id),expires:integer('expires').notNull()});
