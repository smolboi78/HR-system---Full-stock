import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Bricks name -> ZenHR employment_number, for the employees whose name in
// Bricks (sales visits app) doesn't match their ZenHR name. Used in phase 2
// to link visits back to the right employee. Safe to seed now.
const NAME_OVERRIDES: { employmentNumber: string; bricksDisplayName: string }[] = [
  { employmentNumber: "115", bricksDisplayName: "Kareem Elsobky" }, // ZenHR: Karim Ahmed
  { employmentNumber: "104", bricksDisplayName: "Kareem Sherif" },
  { employmentNumber: "127", bricksDisplayName: "Kareim Helmy" },
  { employmentNumber: "135", bricksDisplayName: "Amgad" },
  { employmentNumber: "119", bricksDisplayName: "Mohamed Abdelrazek" },
  { employmentNumber: "136", bricksDisplayName: "Amr Mostafa" },
  { employmentNumber: "205", bricksDisplayName: "Safaa Sabry" },
  { employmentNumber: "212", bricksDisplayName: "Abdullah Ibrahim Habashi" },
];

// Job role -> dashboard category, seeded from the real job roles seen in
// the business's ZenHR attendance export (Management & Warehouse block vs.
// Sales, collectors & Logistics block). Add a row here whenever a new job
// role shows up as OTHER on the dashboard.
const JOB_ROLE_CATEGORIES: { jobRole: string; category: "MANAGEMENT" | "SALES_COLLECTOR" | "DELIVERY_AGENT" }[] = [
  // Management & Warehouse - measured by hours worked
  { jobRole: "Managing Director", category: "MANAGEMENT" },
  { jobRole: "Supply  chain Manager", category: "MANAGEMENT" },
  { jobRole: "Finance Manager", category: "MANAGEMENT" },
  { jobRole: "Warehouse Supervisor", category: "MANAGEMENT" },
  { jobRole: "Logistics Supervisor", category: "MANAGEMENT" },
  { jobRole: "Accountant", category: "MANAGEMENT" },
  { jobRole: "Purchasing Manager", category: "MANAGEMENT" },
  { jobRole: "Commercial Director", category: "MANAGEMENT" },
  { jobRole: "HR Executive", category: "MANAGEMENT" },
  { jobRole: "office boy/girl", category: "MANAGEMENT" },
  // Sales & Collectors - measured by Bricks visit count
  { jobRole: "Key Account Manager", category: "SALES_COLLECTOR" },
  { jobRole: "Collector", category: "SALES_COLLECTOR" },
  { jobRole: "Senior Account Manager", category: "SALES_COLLECTOR" },
  { jobRole: "Account Manager", category: "SALES_COLLECTOR" },
  { jobRole: "Head of sales", category: "SALES_COLLECTOR" },
  // Delivery Agents - tracked in ZenHR, own pending section (attendance only)
  { jobRole: "Delivery agent", category: "DELIVERY_AGENT" },
];

async function main() {
  for (const override of NAME_OVERRIDES) {
    await prisma.employeeNameOverride.upsert({
      where: { employmentNumber: override.employmentNumber },
      create: override,
      update: override,
    });
  }
  console.log(`Seeded ${NAME_OVERRIDES.length} employee name overrides.`);

  for (const rule of JOB_ROLE_CATEGORIES) {
    await prisma.jobRoleCategoryRule.upsert({
      where: { jobRole: rule.jobRole },
      create: rule,
      update: rule,
    });
  }
  console.log(`Seeded ${JOB_ROLE_CATEGORIES.length} job role category rules.`);

  // Single-admin shortcut, handy for local dev.
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    await prisma.managerUser.upsert({
      where: { email: adminEmail.toLowerCase() },
      create: {
        email: adminEmail.toLowerCase(),
        passwordHash,
        name: "Admin",
        role: "ADMIN",
      },
      update: { passwordHash, role: "ADMIN" },
    });
    console.log(`Seeded admin user ${adminEmail}.`);
  }

  // Multi-manager form for production: SEED_MANAGERS is a JSON array of
  // { email, password, name, role? } - role defaults to "ADMIN". Passwords
  // never live in source; they're only ever passed in as an env var.
  const managersJson = process.env.SEED_MANAGERS;
  if (managersJson) {
    let managers: { email: string; password: string; name: string; role?: "ADMIN" | "MANAGER" }[];
    try {
      managers = JSON.parse(managersJson);
    } catch (err) {
      throw new Error(`SEED_MANAGERS is not valid JSON: ${err instanceof Error ? err.message : err}`);
    }
    for (const m of managers) {
      const passwordHash = await bcrypt.hash(m.password, 10);
      await prisma.managerUser.upsert({
        where: { email: m.email.toLowerCase() },
        create: {
          email: m.email.toLowerCase(),
          passwordHash,
          name: m.name,
          role: m.role ?? "ADMIN",
        },
        update: { passwordHash, name: m.name, role: m.role ?? "ADMIN" },
      });
      console.log(`Seeded manager user ${m.email}.`);
    }
  }

  if (!adminEmail && !managersJson) {
    console.log("No SEED_ADMIN_EMAIL or SEED_MANAGERS set - skipped creating any login.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
