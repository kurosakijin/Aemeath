import Hearth from './hearth';
import { getChatGPTUser } from './chatgpt-auth';
export const dynamic = 'force-dynamic';
export default async function Page() {
 const user = await getChatGPTUser();
 return <Hearth user={user ? {id:user.userId,name:user.fullName || user.email.split('@')[0]} : null} />;
}
