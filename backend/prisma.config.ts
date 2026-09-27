generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum JobStatus {
  SCHEDULED
  PENDING
  SENT
  FAILED
}

model User {
  id        String     @id @default(uuid())
  email     String     @unique
  name      String?
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt
  jobs      EmailJob[]
}

model Sender {
  id           String     @id @default(uuid())
  email        String     @unique
  smtpHost     String
  smtpPort     Int
  smtpUser     String
  smtpPass     String
  maxPerMin    Int        @default(10)
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
  jobs         EmailJob[]
}

model EmailJob {
  id          String    @id @default(uuid())
  userId      String
  senderId    String?
  recipient   String
  subject     String
  body        String
  scheduledAt DateTime
  sentAt      DateTime?
  status      JobStatus @default(SCHEDULED)
  errorReason String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  user   User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  sender Sender? @relation(fields: [senderId], references: [id], onDelete: SetNull)
}
