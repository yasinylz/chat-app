import { PrismaClient, Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';

class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface UserResponse {
  id: string;
  username: string;
  profilePic?: string;
  status?: string;
}

interface JwtPayload {
  id: string;
}

interface PrismaUser {
  id: string;
  username: string;
  password?: string;
  profilePic?: string | null;
  status?: string | null;
}

const JWT_SECRET = process.env.JWT_SECRET || 'your-secure-secret-key';
const prisma = new PrismaClient();

const formatUser = (user: PrismaUser): UserResponse => ({
  id: user.id,
  username: user.username,
  profilePic: user.profilePic ?? undefined,
  status: user.status ?? undefined,
});

const hashPassword = async (password: string): Promise<string> => await bcrypt.hash(password, 10);
const comparePassword = async (password: string, hash: string): Promise<boolean> => await bcrypt.compare(password, hash);

export const register = async (username: string, password: string): Promise<UserResponse> => {
  const existingUser = await prisma.user.findUnique({ where: { username } });
  if (existingUser) throw new AuthError('Bu kullanıcı adı zaten alınmış');
  const hashedPassword = await hashPassword(password);
  const user = await prisma.user.create({ 
    data: { username, password: hashedPassword },
    select: { id: true, username: true, profilePic: true, status: true }
  });
  return formatUser(user);
};

export const login = async (username: string, password: string): Promise<{ user: UserResponse; token: string }> => {
  const user = await prisma.user.findUnique({ 
    where: { username },
    select: { id: true, username: true, password: true, profilePic: true, status: true }
  });
  if (!user || !(await comparePassword(password, user.password))) throw new AuthError('Geçersiz kullanıcı adı veya şifre');
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '1h' });
  return { user: formatUser(user), token };
};

export const me = async (token: string): Promise<UserResponse | null> => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, username: true, profilePic: true, status: true },
    });
    return user ? formatUser(user) : null;
  } catch {
    return null;
  }
};

export const logout = async (): Promise<{ ok: boolean }> => ({ ok: true });

export const getUsers = async (
  currentUserId: string,
  page: number,
  limit: number,
  search: string
): Promise<{ users: UserResponse[]; total: number }> => {
  try {
    const skip = (page - 1) * limit;
    const where: Prisma.UserWhereInput = search ? { username: { contains: search, mode: 'insensitive' } } : {};
    const [users, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        select: { id: true, username: true, profilePic: true, status: true },
      }),
      prisma.user.count({ where }),
    ]);
    return { users: users.map(formatUser), total };
  } catch (err) {
    console.error('Kullanıcılar yüklenirken hata:', err);
    throw new Error('Kullanıcılar yüklenemedi');
  }
};

export const saveMessage = async (senderId: string, receiverId: string, text: string) => {
  return await prisma.message.create({
    data: { senderId, receiverId, text },
    include: { sender: true, receiver: true },
  });
};

export const getMessages = async (userId: string, to: string) => {
  const receiver = await prisma.user.findUnique({ where: { username: to } });
  if (!receiver) throw new Error('Alıcı bulunamadı');
  return await prisma.message.findMany({
    where: {
      OR: [
        { senderId: userId, receiverId: receiver.id },
        { senderId: receiver.id, receiverId: userId },
      ],
    },
    include: { sender: true, receiver: true },
    orderBy: { createdAt: 'asc' },
  });
};