-- CreateEnum
CREATE TYPE "EmployeeCategory" AS ENUM ('MANAGEMENT', 'SALES_COLLECTOR', 'DELIVERY_AGENT', 'OTHER');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "category" "EmployeeCategory" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "jobRole" TEXT;

-- CreateTable
CREATE TABLE "JobRoleCategoryRule" (
    "jobRole" TEXT NOT NULL,
    "category" "EmployeeCategory" NOT NULL,

    CONSTRAINT "JobRoleCategoryRule_pkey" PRIMARY KEY ("jobRole")
);
