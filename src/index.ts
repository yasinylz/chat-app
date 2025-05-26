import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { cookie } from '@elysiajs/cookie';
import { authRouter } from './routes/auth.route';
import { PrismaClient } from '@prisma/client';
import { existsSync } from 'fs';
import Bun from 'bun';


const prisma = new PrismaClient();


setInterval(async () => {
  console.log('Cron: 60 saniyede bir eski mesajlar temizleniyor...');
  const twentySecondsAgo = new Date(Date.now() - 60 * 1000);
  try {
    const deleted = await prisma.message.deleteMany({
      where: {
        createdAt: {
          lt: twentySecondsAgo,
        },
      },
    });
    console.log(`${deleted.count} eski mesaj silindi.`);
  } catch (error) {
    console.error('Mesaj silme hatası:', error);
  }
}, 60 * 1000);


const INDEX_PATH = './src/views/index.html';

const app = new Elysia()
  .use(cors({
    origin: 'https://chat-app-p5lx.onrender.com', 
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'OPTIONS'],
    exposeHeaders: ['*'],
  }))
  .use(cookie())
  .onError(({ code, error, set }) => {
    console.error(`Hata: ${code} - ${error}`);
    switch (code) {
      case 'VALIDATION':
        set.status = 400;
        return { error: 'Geçersiz veri: ' + error.message };
      case 'NOT_FOUND':
        set.status = 404;
        return { error: 'Rota bulunamadı' };
      default:
        set.status = 500;
        return { error: 'Sunucu hatası: ' + error };
    }
  })
  .get('/', () => {
    if (!existsSync(INDEX_PATH)) {
      return new Response('<h1>404 - Sayfa bulunamadı</h1>', { status: 404, headers: { 'Content-Type': 'text/html' } });
    }
    return Bun.file(INDEX_PATH);
  })
  .use(authRouter);


app.listen(process.env.PORT || 4000, () => {
  console.log(`🟢 Sunucu çalışıyor: https://chat-app-p5lx.onrender.com - ${new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}`);
});


process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
