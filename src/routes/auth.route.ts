import { Elysia, t } from 'elysia';
import * as Auth from '../controllers/auth.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const connectedClients = new Map<string, WebSocket>();


interface WebSocketData {
  username: string;
}


interface MessageData {
  type?: 'call' | 'call-response' | 'call-reject' | 'call-end' | 'message';
  from?: string;
  to?: string;
  text?: string;
  callType?: 'voice' | 'video';
  sdp?: string;
  candidate?: RTCIceCandidateInit; 
  createdAt?: Date;
}


interface Context {
  body: any;
  cookie: { auth: { value: string; httpOnly?: boolean; secure?: boolean; sameSite?: 'strict' | 'lax' | 'none'; path?: string; maxAge?: number } };
  set: { status: number };
  user: Auth.UserResponse | null;
  query: { [key: string]: string | undefined };
}


export const authRouter = new Elysia({ prefix: '/auth' })
  .use(authMiddleware)


  .post(
    '/register',
    async ({ body, cookie, set }: Context) => {
      const { username, password } = body as { username: string; password: string };
      const user = await Auth.register(username, password);
      const { token } = await Auth.login(username, password);
      cookie.auth = { value: token, httpOnly: true, sameSite: 'strict', maxAge: 3600 };
      set.status = 201;
      return { user, token };
    },
    { body: t.Object({ username: t.String({ minLength: 3 }), password: t.String({ minLength: 6 }) }) }
  )


  .post(
    '/login',
    async ({ body, cookie, set }: Context) => {
      const { username, password } = body as { username: string; password: string };
      const { user, token } = await Auth.login(username, password);
      cookie.auth = { value: token, httpOnly: true, sameSite: 'strict', maxAge: 3600 };
      set.status = 200;
      return { user, token };
    },
    { body: t.Object({ username: t.String({ minLength: 3 }), password: t.String({ minLength: 6 }) }) }
  )

  .get('/me', ({ user, set }: Context) => {
    if (!user) {
      set.status = 401;
      return { error: 'Oturum kimliği bulunamadı' };
    }
    set.status = 200;
    return user;
  })


  .get('/logout', ({ cookie, set }: Context) => {
    cookie.auth = { value: '', maxAge: 0 };
    set.status = 200;
    return { ok: true };
  })


  .get(
    '/users',
    async ({ query, user, set }: Context) => {
      if (!user) {
        set.status = 401;
        return { error: 'Oturum kimliği bulunamadı' };
      }
      const page = parseInt(query.page || '1');
      const limit = parseInt(query.limit || '10');
      const search = query.search || '';
      const { users, total } = await Auth.getUsers(user.id, page, limit, search);
      return { users: users.filter(u => u.id !== user.id), total: Math.max(0, total - 1) };
    },
    { query: t.Object({ page: t.Optional(t.String()), limit: t.Optional(t.String()), search: t.Optional(t.String()) }) }
  )

 
  .get(
    '/messages',
    async ({ query, user, set }: Context) => {
      if (!user) {
        set.status = 401;
        return { error: 'Oturum kimliği bulunamadı' };
      }
      const to = query.to;
      if (!to) {
        set.status = 400;
        return { error: 'Alıcı belirtilmedi' };
      }
      const messages = await Auth.getMessages(user.id, to);
      set.status = 200;
      return {
        messages: messages.map(m => ({
          id: m.id,
          from: m.sender.username,
          to: m.receiver.username,
          text: m.text,
          createdAt: m.createdAt,
        })),
      };
    },
    { query: t.Object({ to: t.String() }) }
  )

  .post(
    '/message',
    async ({ body, user, set }: Context) => {
      if (!user) {
        set.status = 401;
        return { error: 'Oturum kimliği bulunamadı' };
      }
      const { to, text } = body as { to: string; text: string };
      const receiver = await prisma.user.findUnique({ where: { username: to } });
      if (!receiver) {
        set.status = 404;
        return { error: 'Alıcı bulunamadı' };
      }
      const message = await Auth.saveMessage(user.id, receiver.id, text);
      const messageData: MessageData = {
        type: 'message',
        from: user.username,
        to,
        text: message.text,
        createdAt: message.createdAt,
      };
      const senderWs = connectedClients.get(user.username);
      const receiverWs = connectedClients.get(to);
      if (senderWs?.readyState === WebSocket.OPEN) {
        senderWs.send(JSON.stringify(messageData));
      }
      if (receiverWs?.readyState === WebSocket.OPEN) {
        receiverWs.send(JSON.stringify(messageData));
      }
      set.status = 201;
      return { success: true, message: messageData };
    },
    { body: t.Object({ to: t.String(), text: t.String() }) }
  )

 
  .post(
    '/call/voice',
    async ({ body, user, set }: Context) => {
      if (!user) {
        set.status = 401;
        return { error: 'Oturum kimliği bulunamadı' };
      }
      const { targetUser, sdp } = body as { targetUser: string; sdp: string };
      const targetWs = connectedClients.get(targetUser);
      if (!targetWs || targetWs.readyState !== WebSocket.OPEN) {
        set.status = 404;
        return { error: 'Kullanıcı çevrimdışı veya bulunamadı' };
      }
      targetWs.send(JSON.stringify({ type: 'call', from: user.username, to: targetUser, callType: 'voice', sdp }));
      set.status = 200;
      return { success: true };
    },
    { body: t.Object({ targetUser: t.String(), sdp: t.String() }) }
  )


  .post(
    '/call/video',
    async ({ body, user, set }: Context) => {
      if (!user) {
        set.status = 401;
        return { error: 'Oturum kimliği bulunamadı' };
      }
      const { targetUser, sdp } = body as { targetUser: string; sdp: string };
      const targetWs = connectedClients.get(targetUser);
      if (!targetWs || targetWs.readyState !== WebSocket.OPEN) {
        set.status = 404;
        return { error: 'Kullanıcı çevrimdışı veya bulunamadı' };
      }
      targetWs.send(JSON.stringify({ type: 'call', from: user.username, to: targetUser, callType: 'video', sdp }));
      set.status = 200;
      return { success: true };
    },
    { body: t.Object({ targetUser: t.String(), sdp: t.String() }) }
  )


  .ws('/ws', {
   
    query: t.Object({
      token: t.String(),
    }),
   
    body: t.Object({
      type: t.Optional(t.Union([t.Literal('call'), t.Literal('call-response'), t.Literal('call-reject'), t.Literal('call-end'), t.Literal('message')])),
      from: t.Optional(t.String()),
      to: t.Optional(t.String()),
      text: t.Optional(t.String()),
      callType: t.Optional(t.Union([t.Literal('voice'), t.Literal('video')])),
      sdp: t.Optional(t.String()),
      candidate: t.Optional(t.Object({
        candidate: t.String(),
        sdpMid: t.String(),
        sdpMLineIndex: t.Number(),
      })),
      createdAt: t.Optional(t.Date()),
    }),
   
    open(ws:any) {
      const { token } = ws.data.query;
      if (!token) {
        ws.close(1008, 'Yetkilendirme gerekli');
        return;
      }
      Auth.me(token).then(user => {
        if (user) {
        
          ws.data = { username: user.username } as WebSocketData;
          connectedClients.set(user.username, ws.raw); 
          console.log(`Kullanıcı bağlandı: ${user.username}, Toplam istemci: ${connectedClients.size}`);
        } else {
          ws.close(1008, 'Geçersiz token');
        }
      }).catch(() => ws.close(1008, 'Token doğrulama hatası'));
    },
  
    message(ws:any, message:any) {
      const wsData = ws.data as WebSocketData | undefined;
      if (!wsData?.username) {
        console.error('WebSocket istemcisi kimliği doğrulanmamış:', message);
        return;
      }

      
      const data = message as MessageData;

      if (data.type === 'call' && data.to && data.callType && data.sdp) {
        const targetWs = connectedClients.get(data.to);
        if (targetWs?.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify({ ...data, from: wsData.username }));
        } else {
          ws.send(JSON.stringify({ type: 'call-error', message: 'Kullanıcı çevrimdışı' }));
        }
      } else if (data.type === 'call-response' && data.to && data.sdp) {
        const targetWs = connectedClients.get(data.to);
        if (targetWs?.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify({ ...data, from: wsData.username }));
        }
      } else if (data.type === 'call-reject' && data.to) {
        const targetWs = connectedClients.get(data.to);
        if (targetWs?.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify({ ...data, from: wsData.username }));
        }
      } else if (data.type === 'call-end' && data.to) {
        const targetWs = connectedClients.get(data.to);
        if (targetWs?.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify({ ...data, from: wsData.username }));
        }
      } else if (data.type === 'message' && data.to && data.text) {
        const targetWs = connectedClients.get(data.to);
        if (targetWs?.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify({ ...data, from: wsData.username }));
        }
        if (ws.raw.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ ...data, from: wsData.username }));
        }
      } else if (data.type === 'call' && data.candidate && data.to) {
        const targetWs = connectedClients.get(data.to);
        if (targetWs?.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify({ ...data, from: wsData.username }));
        }
      }
    },
   
    close(ws:any) {
      const wsData = ws.data as WebSocketData | undefined;
      if (wsData?.username) {
        connectedClients.delete(wsData.username);
        console.log(`Kullanıcı ayrıldı: ${wsData.username}, Toplam istemci: ${connectedClients.size}`);
      }
    },
  });