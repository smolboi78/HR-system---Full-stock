-- CreateEnum
CREATE TYPE "ManagerRole" AS ENUM ('ADMIN', 'MANAGER');

-- CreateEnum
CREATE TYPE "SyncSource" AS ENUM ('ZENHR', 'BRICKS');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "ManagerUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "ManagerRole" NOT NULL DEFAULT 'MANAGER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagerUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZenhrOAuthToken" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "scope" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZenhrOAuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" INTEGER NOT NULL,
    "nameEn" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "workingHours" DOUBLE PRECISION NOT NULL,
    "daysOff" INTEGER[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "zenhrEmployeeId" INTEGER NOT NULL,
    "zenhrBranchId" INTEGER NOT NULL,
    "employmentNumber" TEXT NOT NULL,
    "firstNameEn" TEXT NOT NULL,
    "lastNameEn" TEXT NOT NULL,
    "displayNameEn" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "hiringDate" DATE,
    "terminationDate" DATE,
    "bricksUserId" TEXT,
    "bricksDisplayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeNameOverride" (
    "id" TEXT NOT NULL,
    "employmentNumber" TEXT NOT NULL,
    "bricksDisplayName" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeNameOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "zenhrRecordId" INTEGER NOT NULL,
    "attendanceDate" DATE NOT NULL,
    "entryTime" TIMESTAMP(3),
    "exitTime" TIMESTAMP(3),
    "missingStatus" TEXT NOT NULL,
    "numberOfMissings" INTEGER NOT NULL DEFAULT 0,
    "suspicious" BOOLEAN NOT NULL DEFAULT false,
    "workedMinutes" INTEGER,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visit" (
    "id" TEXT NOT NULL,
    "bricksVisitId" TEXT NOT NULL,
    "employeeId" TEXT,
    "ownerBricksId" TEXT NOT NULL,
    "ownerNameRaw" TEXT NOT NULL,
    "contactId" TEXT,
    "contactName" TEXT,
    "isSuccessful" BOOLEAN,
    "isPlanned" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL,
    "visitTime" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "source" "SyncSource" NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "recordsSynced" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ManagerUser_email_key" ON "ManagerUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_zenhrEmployeeId_key" ON "Employee"("zenhrEmployeeId");

-- CreateIndex
CREATE INDEX "Employee_zenhrBranchId_idx" ON "Employee"("zenhrBranchId");

-- CreateIndex
CREATE INDEX "Employee_employmentNumber_idx" ON "Employee"("employmentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeNameOverride_employmentNumber_key" ON "EmployeeNameOverride"("employmentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_zenhrRecordId_key" ON "AttendanceRecord"("zenhrRecordId");

-- CreateIndex
CREATE INDEX "AttendanceRecord_employeeId_attendanceDate_idx" ON "AttendanceRecord"("employeeId", "attendanceDate");

-- CreateIndex
CREATE INDEX "AttendanceRecord_attendanceDate_idx" ON "AttendanceRecord"("attendanceDate");

-- CreateIndex
CREATE UNIQUE INDEX "Visit_bricksVisitId_key" ON "Visit"("bricksVisitId");

-- CreateIndex
CREATE INDEX "Visit_employeeId_visitTime_idx" ON "Visit"("employeeId", "visitTime");

-- CreateIndex
CREATE INDEX "Visit_ownerBricksId_idx" ON "Visit"("ownerBricksId");

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
