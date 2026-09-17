-- CreateEnum
CREATE TYPE "TrackingMethod" AS ENUM ('HOURS', 'PRESENCE', 'DELIVERY');

-- CreateEnum
CREATE TYPE "LeaveBucket" AS ENUM ('EMERGENCY', 'ANNUAL', 'UNPAID', 'BUSINESS_MISSION', 'NONE');

-- CreateEnum
CREATE TYPE "ApplyStatus" AS ENUM ('APPLIED', 'FAILED');

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
CREATE TABLE "RosterEmployee" (
    "employmentNumber" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "tracking" "TrackingMethod" NOT NULL,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "daysOff" INTEGER[] DEFAULT ARRAY[5, 6]::INTEGER[],
    "zenhrEmployeeId" INTEGER,
    "zenhrBranchId" INTEGER,
    "bricksAlias" TEXT,
    "bricksOwnerId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RosterEmployee_pkey" PRIMARY KEY ("employmentNumber")
);

-- CreateTable
CREATE TABLE "Reason" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "defaultBucket" "LeaveBucket" NOT NULL DEFAULT 'NONE',
    "allowsToggle" BOOLEAN NOT NULL DEFAULT false,
    "defaultDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hoursEditable" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Reason_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "LeaveTypeMap" (
    "bucket" "LeaveBucket" NOT NULL,
    "zenhrTimeoffId" INTEGER,
    "zenhrName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveTypeMap_pkey" PRIMARY KEY ("bucket")
);

-- CreateTable
CREATE TABLE "AppliedDeduction" (
    "id" TEXT NOT NULL,
    "employmentNumber" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "bucket" "LeaveBucket" NOT NULL,
    "days" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "status" "ApplyStatus" NOT NULL DEFAULT 'APPLIED',
    "zenhrTransactionId" INTEGER,
    "errorMessage" TEXT,
    "appliedBy" TEXT,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppliedDeduction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RosterEmployee_zenhrEmployeeId_idx" ON "RosterEmployee"("zenhrEmployeeId");

-- CreateIndex
CREATE INDEX "AppliedDeduction_date_idx" ON "AppliedDeduction"("date");

-- CreateIndex
CREATE UNIQUE INDEX "AppliedDeduction_employmentNumber_date_key" ON "AppliedDeduction"("employmentNumber", "date");

